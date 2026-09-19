import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LOCK_RENEWAL_EVERY, collectOutput } from '../worker/build-output.ts';
import type { OutputEntry, ReadFileResult } from '../worker/build-output.ts';

/**
 * Reading a build's output back, tested by calling it (#196 review).
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
      async (path) => (path.endsWith('.png') ? BINARY : TEXT),
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
      async (path) => {
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
      async (path) => (path.endsWith('.png') ? BINARY : TEXT),
      async () => {},
    );
    assert.deepEqual(read.output, [{ path: 'index.html', content: 'hello' }]);
    assert.deepEqual(read.skipped, ['logo.png']);
  });

  it('asks for every file once, in the order it was listed', async () => {
    const asked: string[] = [];
    await collectOutput(
      entries(LOCK_RENEWAL_EVERY + 3),
      async (path) => {
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
