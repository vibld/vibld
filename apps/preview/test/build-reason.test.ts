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
