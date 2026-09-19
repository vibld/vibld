import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOCK_RENEWAL_EVERY,
  OUT_OF_TIME,
  collectOutput,
  withinDeadline,
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
        return true;
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
        return true;
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
        return true;
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
      async () => true,
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
      async () => true,
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
        return true;
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
        return true;
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
      async () => true,
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
        return true;
      },
    );
    assert.equal(renewals, 0);
  });
});

/**
 * That a loop which has lost the workspace stops using it (#196 review).
 *
 * The half renewing could never do. `renewLock` has always been
 * conditional on still owning the lock, so a build that had been
 * superseded renewed nothing, learned nothing, and carried on writing into
 * the workspace its successor had just emptied. Answering the heartbeat is
 * only useful if a "no" stops the work.
 */
describe('a build that is no longer entitled to the workspace', () => {
  const files = (count: number) =>
    Array.from({ length: count }, (_, at) => ({
      path: `src/file-${at}.tsx`,
      content: 'x',
    }));

  it('writes nothing once it has been told to stop', async () => {
    const written: string[] = [];
    const complete = await writeFiles(
      files(200),
      async (file) => {
        written.push(file.path);
      },
      async () => written.length < LOCK_RENEWAL_EVERY,
    );
    assert.equal(complete, false, 'a stopped write reported success');
    assert.equal(
      written.length,
      LOCK_RENEWAL_EVERY,
      'the loop kept writing after it had been told to stop',
    );
  });

  it('says so rather than reporting a short project as a whole one', async () => {
    // The return value is the whole point. A caller that cannot tell a
    // finished write from an abandoned one goes on to install and compile
    // whatever happens to be on disk, and reports the result as a verdict
    // on the project.
    assert.equal(
      await writeFiles(
        files(1),
        async () => {},
        async () => false,
      ),
      false,
    );
    assert.equal(
      await writeFiles(
        files(1),
        async () => {},
        async () => true,
      ),
      true,
    );
  });

  it('reads nothing once it has been told to stop, and says the tree is partial', async () => {
    const asked: string[] = [];
    const read = await collectOutput(
      Array.from({ length: 200 }, (_, at) => ({
        type: 'file',
        relativePath: `page-${at}.html`,
      })),
      async (path: string) => {
        asked.push(path);
        return TEXT;
      },
      async () => asked.length < LOCK_RENEWAL_EVERY,
    );
    assert.equal(read.complete, false, 'a stopped read reported a whole tree');
    assert.equal(
      asked.length,
      LOCK_RENEWAL_EVERY,
      'the loop kept reading after it had been told to stop',
    );
    assert.equal(
      read.output.length,
      LOCK_RENEWAL_EVERY,
      'what it did read before stopping was thrown away',
    );
  });

  it('reports a whole tree as whole', async () => {
    const read = await collectOutput(
      [{ type: 'file', relativePath: 'index.html' }],
      async () => TEXT,
      async () => true,
    );
    assert.equal(read.complete, true);
  });
});

/**
 * That one stuck call cannot outlast a build's whole budget
 * (#196 review).
 *
 * The deadline was checked between operations, which bounds a build made
 * of many quick calls and does nothing about a build stuck inside one slow
 * one. I answered that finding by saying the ownership check on resume
 * covered it. It does not, and the order is the whole of why: the stalled
 * write lands first and the check happens after, so a zombie build writes
 * a file into its successor's workspace and only then discovers it had
 * been superseded.
 */
describe('one operation against what is left of the clock', () => {
  it('gives back what the work returned, when the work is first', async () => {
    assert.equal(await withinDeadline(Promise.resolve('done'), 10_000), 'done');
  });

  it('gives up on work that outlasts the budget', async () => {
    const stuck = new Promise<string>(() => {});
    await assert.rejects(withinDeadline(stuck, 1), {
      message: OUT_OF_TIME,
    });
  });

  it('gives up at once on a budget already spent', async () => {
    // `deadline - Date.now()` is negative for a build that is already out
    // of time, and a negative delay must mean "now" rather than "never".
    await assert.rejects(
      withinDeadline(new Promise<string>(() => {}), -5_000),
      {
        message: OUT_OF_TIME,
      },
    );
  });

  it('lets a real failure through rather than masking it', async () => {
    await assert.rejects(
      withinDeadline(Promise.reject(new Error('the sandbox is gone')), 10_000),
      { message: 'the sandbox is gone' },
    );
  });

  it('leaves no timer running behind the work it watched', async () => {
    // A pending timer per file would outlive the work it was watching,
    // which in a Durable Object holds it awake for the rest of the
    // build's budget.
    //
    // Counted rather than waited for. The first version of this test
    // awaited the call and then asserted `true`, on the reasoning that a
    // leaked timer would hang the run instead of failing it. A mutation
    // that removed the `clearTimeout` walked straight through it: an
    // assertion that cannot fail is not a test, which is the eighth time
    // on this pull request I have written one and the first time I caught
    // it with a mutation rather than a reviewer.
    const timers = () =>
      process
        .getActiveResourcesInfo()
        .filter((resource) => resource === 'Timeout').length;
    const before = timers();
    await withinDeadline(Promise.resolve(1), 60_000);
    assert.equal(
      timers(),
      before,
      'the timer outlived the work it was watching',
    );
  });
});
