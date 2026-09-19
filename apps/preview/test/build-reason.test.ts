import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * That a build failure says which kind it is (#194).
 *
 * The message alone was enough while publish was the only caller: it shows
 * the text to a person and stops. The generation path now has to *decide*
 * from it, because a failed build is what buys a repair turn, and a repair
 * turn is a second paid model call. Deciding that from wording means
 * matching on wording, and wording changes.
 *
 * Only `install` and `build` are evidence about the project the model
 * wrote. `busy` is the one that would have cost real money for nothing: it
 * is a refusal issued before any work happens, because another build is
 * already running for that project, and nothing about the code is
 * implicated. Since #196 that is all it means -- it used to fire whenever a
 * preview was live, which is most of the time, so the caller read
 * "nothing to do with the project" on the ordinary follow-up edit and the
 * verification never ran (see `build-sandbox.test.ts`).
 *
 * `preview-sandbox.ts` imports `@cloudflare/sandbox` and cannot be loaded
 * under `node --test`, so this reads it as source. Same reasoning as
 * `typecheck.test.ts` beside it.
 */
const source = readFileSync(
  join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
  'utf8',
);

/**
 * The body of `buildProject` and nothing else.
 *
 * `createShare` is the method immediately after it, and naming a boundary
 * further down the file was how the first version of this test came to
 * count `provision`'s own refusal as one of these: seven errors against six
 * reasons, for a region that was never being measured. The assertion below
 * counts, so the region it counts over has to be exact.
 */
function buildProjectBody(): string {
  const at = source.indexOf('async buildProject(');
  assert.ok(at > 0, 'buildProject is not where this expected it');
  const end = source.indexOf('async createShare(', at);
  assert.ok(end > at, 'createShare is no longer the method after it');
  return source.slice(at, end);
}

/**
 * The same region with its prose taken out.
 *
 * The comments in `buildProject` discuss the very things some of these
 * assertions look for -- `writeProject`, `node_modules`, the order they
 * happen in -- so a test that searched the raw text would be reading the
 * explanation rather than the code, and would pass or fail on how the
 * comment was worded. Only lines that are not comments count.
 */
function buildProjectCode(): string {
  return buildProjectBody()
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/*')
      );
    })
    .join('\n');
}

describe('what a failed build says about itself', () => {
  it('gives every refusal a reason', () => {
    // Counted rather than spot-checked: a new early return added without
    // one is exactly how the caller starts reading `undefined` and doing
    // nothing, silently, on a failure that should have bought a repair.
    const body = buildProjectBody();
    const errors = body.match(/\n\s+error:/g)?.length ?? 0;
    const reasons = body.match(/\n\s+reason: '/g)?.length ?? 0;
    assert.ok(errors > 0, 'no refusals found at all');
    assert.equal(
      reasons,
      errors,
      `${errors} refusals but ${reasons} reasons: one of them says nothing a caller can act on`,
    );
  });

  it('refuses a busy sandbox before it does any work', () => {
    // The ordering is the point. If this ran after the install, a "busy"
    // refusal would cost a container start before saying nothing useful.
    const body = buildProjectBody();
    assert.ok(
      body.indexOf("reason: 'busy'") < body.indexOf('npm install'),
      'the busy refusal happens after work has already been done',
    );
  });

  it('separates a busy sandbox from a project that will not build', () => {
    // These two were the same value until #194, and conflating them spends
    // a model call on a project that compiles perfectly well.
    const body = buildProjectBody();
    for (const reason of ['busy', 'install', 'build']) {
      assert.match(body, new RegExp(`reason: '${reason}'`), reason);
    }
  });
});

/**
 * That two builds for the same user cannot write into one /workspace at
 * once (#196 review).
 *
 * This is what the old refusal was really protecting, and moving builds
 * into their own instance did not remove it: a repair's verification build
 * and an auto-publish are both builds, and they can overlap. What changed
 * is what it excludes -- another build, rather than the preview that now
 * lives somewhere else entirely.
 */
describe('one build at a time', () => {
  it('refuses while another build holds the lock', () => {
    const body = buildProjectBody();
    assert.match(body, /BUILD_LOCK_KEY/, 'nothing excludes a second build');
    assert.ok(
      body.indexOf('BUILD_LOCK_KEY') < body.indexOf('npm install'),
      'the lock is taken after the work it is meant to exclude',
    );
  });

  it('does not refuse on account of a running preview', () => {
    // The whole point of the move. A build that still consulted the
    // preview's state would be back to skipping verification for anyone
    // with a preview open, however it was named.
    const body = buildProjectBody();
    assert.doesNotMatch(
      body,
      /readState\(\)/,
      'the build still reads the preview state it no longer shares',
    );
  });

  it('gives the lock back on every path out', () => {
    // Including the refusals that return from inside the `try`. A lock
    // taken and not returned blocks this user's next build until it ages
    // out, which is fifteen minutes of a feature silently not running.
    const body = buildProjectBody();
    assert.match(
      body,
      /finally \{[\s\S]*?storage\.delete\(BUILD_LOCK_KEY\)/,
      'the build lock is released on some paths and not others',
    );
  });
});

/**
 * That a build measures the snapshot it was given, and not what the last
 * one left behind (#196 review).
 *
 * `writeProject` writes the paths it is handed and removes nothing, and the
 * build container is now reused across builds for a user. So the second
 * build of a repair would compile the new files on top of the old ones: a
 * file the repair deleted still satisfying an import, or one it replaced
 * under a different name still failing the build. `built` and `repaired`
 * would then be honest measurements of a tree nobody is going to receive,
 * which is the same defect as reading acceptance as a build, one layer out.
 */
describe('what a build actually compiles', () => {
  it('empties the workspace before it writes the snapshot', () => {
    const body = buildProjectCode();
    const cleared = body.indexOf('rm -rf /workspace');
    assert.ok(cleared > 0, 'the workspace is never emptied');
    assert.ok(
      cleared < body.indexOf('writeProject'),
      'the snapshot is written before the old one is cleared away',
    );
  });

  it('refuses rather than measuring a workspace it could not empty', () => {
    // A build over a tree that is half the last project is worse than no
    // build: it answers the question with something that was never asked.
    const body = buildProjectCode();
    const cleared = body.indexOf('rm -rf /workspace');
    const checked = body.indexOf('cleared.success', cleared);
    assert.ok(checked > cleared, 'the clear result is never checked');
    assert.ok(
      checked < body.indexOf('writeProject'),
      'the snapshot is written before the clear was checked',
    );
  });

  it('clears the whole workspace, node_modules included', () => {
    // Asserted as "the directory itself goes", not as "the word
    // node_modules does not appear". The absence of a word is the weaker
    // claim, and the first version of this test made it: a clear that named
    // a few paths to remove preserved node_modules perfectly well without
    // ever spelling it, and the test passed. What matters is that the root
    // goes, because that is what makes the clear complete whatever the
    // project happens to contain.
    //
    // It costs an install per build, and two on a repair. A package
    // installed for an earlier project would otherwise satisfy a later one
    // that never declared it, so a project missing a dependency from its
    // own package.json would build here and fail everywhere else, which is
    // one of the two production failures this feature exists for.
    assert.match(
      buildProjectCode(),
      /rm -rf \/workspace['"`]/,
      'the clear names paths inside the workspace, so what it does not name survives',
    );
  });
});

/**
 * That a build gives back its own lock and not somebody else's
 * (#196 review).
 *
 * Expiry alone made the lock unsafe in exactly the case it existed for:
 * once a stale lock let a second build in, the first build's `finally`
 * deleted the second's lock on its way out, and a third would then walk
 * into the workspace the second was using. The bounds in
 * `build-limits.test.ts` make that overrun unlikely; ownership makes it
 * harmless.
 */
describe('whose lock a build releases', () => {
  it('takes the lock with a token of its own', () => {
    const body = buildProjectCode();
    assert.match(
      body,
      /crypto\.randomUUID\(\)/,
      'the lock carries no token, so no release can tell whose it is',
    );
  });

  it('releases only while the lock is still its own', () => {
    // Asserted as "every delete is guarded by the ownership answer",
    // rather than by matching the shape the code happened to have. The
    // first version of this test matched adjacent text and broke when the
    // teardown was restructured, while the property it was about never
    // changed -- which is a test measuring the wrong thing, again.
    const body = buildProjectCode();
    assert.match(
      body,
      /const ours = mine\?\.token === token;/,
      "nothing works out whether the lock is still this build's",
    );
    const tail = body.slice(body.lastIndexOf('} finally {'));
    for (const at of [...tail.matchAll(/storage\.delete\(BUILD_LOCK_KEY\)/g)]) {
      const guard = tail.slice(0, at.index);
      assert.match(
        guard.slice(guard.lastIndexOf('if (')),
        /if \([^)]*\bours\b/,
        'a delete of the build lock is not guarded by owning it',
      );
    }
  });

  it('stops a command that reached its bound from reading as a project failure', () => {
    // Being stopped says nothing about the project, so it must not buy a
    // repair: `sandbox`, which `judgedTheProject` reads as unknown, and
    // not `install` or `build`, which it reads as a verdict.
    const body = buildProjectCode();
    for (const bound of [
      'BUILD_INSTALL_TIMEOUT_MS',
      'BUILD_COMPILE_TIMEOUT_MS',
    ]) {
      const at = body.indexOf(`>= ${bound}`);
      assert.ok(at > 0, `${bound} is never compared against the clock`);
      const after = body.slice(at, at + 200);
      assert.match(
        after,
        /reason: 'sandbox'/,
        `a ${bound} timeout is reported as a verdict on the project`,
      );
    }
  });
});

/**
 * That a finished build gives its container back (#196 review).
 *
 * Builds share the platform's container budget with previews now, and a
 * container that has merely stopped working still holds a slot for the
 * class's ten-minute `sleepAfter`. Nothing in it is worth keeping: the next
 * build empties the workspace before it starts, so idling buys a container
 * start and costs a preview somebody else wanted.
 */
describe('what a build leaves behind', () => {
  it('destroys its container on the way out', () => {
    const body = buildProjectCode();
    assert.match(
      body,
      /this\.destroy\(\)/,
      'a finished build holds its container until sleepAfter',
    );
  });

  it('destroys it only while the lock is still its own', () => {
    // The sharper half of the ownership check. A build that overran is
    // running in the same container as whoever now holds the lock, so
    // destroying it there would kill their build rather than free a slot.
    const body = buildProjectCode();
    const owned = body.indexOf('token === token');
    const destroyed = body.indexOf('this.destroy()');
    assert.ok(owned > 0 && destroyed > owned, 'the destroy is unguarded');
  });
});
