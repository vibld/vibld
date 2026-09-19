import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOCK_RENEWAL_EVERY,
  collectOutput,
  writeFiles,
} from '../worker/build-files.ts';
import type { OutputEntry, ReadFileResult } from '../worker/build-files.ts';

/**
 * The two per-file loops a build runs, tested by calling them
 * (#196 review).
 *
 * This loop lived inside `buildProject`, which cannot be loaded under
 * `node --test`, so everything ever asserted about it was a regex over
 * source. Seven of those have now measured the text around a property
 * rather than the property, and the eighth was this: the renewal counted
 * the files the loop *kept* rather than the files it *read*, and no regex
 * was going to see the difference. Two entries below would have caught it
 * in a second.
 */
function entries(count: number): OutputEntry[] {
  return Array.from({ length: count }, (_, at) => ({
    type: 'file',
    relativePath: `asset-${at}.png`,
  }));
}

const BINARY: ReadFileResult = { encoding: 'base64', content: 'AAAA' };
const TEXT: ReadFileResult = { content: 'hello' };

describe('what reading a build output costs the lock', () => {
  it('renews by files read, not by files kept', async () => {
    // The defect. A Vite build's `assets/` is mostly images, so a real
    // output can be one HTML file and five hundred binaries. Counting the
    // kept files left `output.length` stuck at one, which is not a multiple
    // of the interval, so the lock was never pushed forward across five
    // hundred RPCs and the build's own TTL could expire underneath it.
    let renewals = 0;
    const read = await collectOutput(
      [{ type: 'file', relativePath: 'index.html' }, ...entries(99)],
      async (path: string) => (path.endsWith('.png') ? BINARY : TEXT),
      async () => {
        renewals += 1;
      },
    );
    assert.equal(read.output.length, 1);
    assert.equal(read.skipped.length, 99);
    assert.equal(
      renewals,
      4,
      'the lock was renewed by what the loop kept rather than by what it did',
    );
  });

  it('renews once before it reads anything at all', async () => {
    // The first read is the one furthest from the last renewal the caller
    // made, so the interval has to start before it rather than after.
    const seen: string[] = [];
    await collectOutput(
      entries(1),
      async (path: string) => {
        seen.push(`read:${path}`);
        return BINARY;
      },
      async () => {
        seen.push('renew');
      },
    );
    assert.deepEqual(seen, ['renew', 'read:asset-0.png']);
  });

  it('does not renew for entries it never reads', async () => {
    // Directories cost no RPC, so they must not advance the counter
    // either: a listing of four hundred directories and one file would
    // otherwise renew the lock repeatedly for no work done.
    let renewals = 0;
    await collectOutput(
      [
        { type: 'directory', relativePath: 'assets' },
        { type: 'directory', relativePath: 'chunks' },
      ],
      async () => TEXT,
      async () => {
        renewals += 1;
      },
    );
    assert.equal(renewals, 0, 'a listing of directories renewed the lock');
  });

  it('keeps the text and names the binaries rather than mangling them', async () => {
    const read = await collectOutput(
      [
        { type: 'file', relativePath: 'index.html' },
        { type: 'file', relativePath: 'logo.png' },
      ],
      async (path: string) => (path.endsWith('.png') ? BINARY : TEXT),
      async () => {},
    );
    assert.deepEqual(read.output, [{ path: 'index.html', content: 'hello' }]);
    assert.deepEqual(read.skipped, ['logo.png']);
  });

  it('asks for every file once, in the order it was listed', async () => {
    const asked: string[] = [];
    await collectOutput(
      entries(LOCK_RENEWAL_EVERY + 3),
      async (path: string) => {
        asked.push(path);
        return TEXT;
      },
      async () => {},
    );
    assert.equal(asked.length, LOCK_RENEWAL_EVERY + 3);
    assert.equal(new Set(asked).size, asked.length, 'a file was read twice');
    assert.equal(asked[0], 'asset-0.png');
  });
});

describe('what writing a project in costs the lock', () => {
  const files = (count: number) =>
    Array.from({ length: count }, (_, at) => ({
      path: `src/file-${at}.tsx`,
      content: 'x',
    }));

  it('renews as it writes, not only once it has finished', async () => {
    // The same hazard as the read loop and, until this, without the same
    // protection: one or two RPCs per file, no bound of its own, and a lock
    // with a fifteen-minute TTL. The renewal sat *after* the loop, so a big
    // enough project outran its own claim on the workspace while holding
    // it, and a later build could clear `/workspace` underneath this one.
    let renewals = 0;
    await writeFiles(
      files(100),
      async () => {},
      async () => {
        renewals += 1;
      },
    );
    assert.equal(renewals, 4, 'the lock is only pushed forward at the ends');
  });

  it('renews once before it writes anything at all', async () => {
    const seen: string[] = [];
    await writeFiles(
      files(1),
      async (file) => {
        seen.push(`write:${file.path}`);
      },
      async () => {
        seen.push('renew');
      },
    );
    assert.deepEqual(seen, ['renew', 'write:src/file-0.tsx']);
  });

  it('writes every file once, in the order it was given', async () => {
    const written: string[] = [];
    await writeFiles(
      files(LOCK_RENEWAL_EVERY + 3),
      async (file) => {
        written.push(file.path);
      },
      async () => {},
    );
    assert.equal(written.length, LOCK_RENEWAL_EVERY + 3);
    assert.equal(
      new Set(written).size,
      written.length,
      'a file was written twice',
    );
    assert.equal(written[0], 'src/file-0.tsx');
  });

  it('renews nothing for a project with no files', async () => {
    let renewals = 0;
    await writeFiles(
      [],
      async () => {},
      async () => {
        renewals += 1;
      },
    );
    assert.equal(renewals, 0);
  });
});
