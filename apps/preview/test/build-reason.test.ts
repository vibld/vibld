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
 * One method's body, from its own signature to the next one's.
 *
 * Both ends are named, and the far end is named as the method that really
 * does follow. The first version of this counted `provision`'s refusal as
 * one of `buildProject`'s -- seven errors against six reasons, over a
 * region that was never being measured. The second ran from `buildProject`
 * to `createShare` and went on passing when the teardown was lifted out
 * into `releaseBuild` between the two: the same defect from the other
 * side, a region growing to keep covering assertions that had stopped
 * being about it. The assertions below count and compare positions, so the
 * regions they read have to be exactly the methods they name.
 */
function bodyOf(signature: string, next: string): string {
  const at = source.indexOf(signature);
  assert.ok(at > 0, `${signature} is not where this expected it`);
  const end = source.indexOf(next, at);
  assert.ok(end > at, `${next} is no longer the method after it`);
  return source.slice(at, end);
}

/**
 * The same region with its prose taken out.
 *
 * The comments in these methods discuss the very things some of these
 * assertions look for -- `writeProject`, `node_modules`, the order they
 * happen in -- so a test that searched the raw text would be reading the
 * explanation rather than the code, and would pass or fail on how the
 * comment was worded. Only lines that are not comments count.
 */
function codeOf(body: string): string {
  return body
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

/** What the build itself does, up to where it hands off the teardown. */
function buildProjectBody(): string {
  return bodyOf('async buildProject(', 'private async releaseBuild(');
}

function buildProjectCode(): string {
  return codeOf(buildProjectBody());
}

/**
 * What the teardown does, which is no longer on the caller's clock: the
 * build's `finally` starts it and does not wait for it (#196 review).
 */
function releaseBuildCode(): string {
  return codeOf(bodyOf('private async releaseBuild(', 'async createShare('));
}

describe('what a failed build says about itself', () => {
  it('gives every refusal a reason', () => {
    // Counted rather than spot-checked: a new early return added without
    // one is exactly how the caller starts reading `undefined` and doing
    // nothing, silently, on a failure that should have bought a repair.
    const body = buildProjectBody();
    // A reason may be worked out rather than written down: the install
    // failure asks `networkFailure` whether the registry or the project is
    // at fault. What the count is about is that no refusal lacks one, so
    // it counts assignments rather than literals.
    const errors = body.match(/\n\s+error:/g)?.length ?? 0;
    const reasons = body.match(/\n\s+reason: /g)?.length ?? 0;
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

  it('asks whether a failed install was the registry before blaming the project', () => {
    // `build-failure.test.ts` proves the classifier is right; this proves
    // it is consulted. A mutation that dropped the call survived the
    // classifier's own tests perfectly happily, because they never look at
    // this file -- and an install failure that is not asked about buys a
    // second paid model call to repair a project that compiles.
    const body = buildProjectCode();
    const at = body.indexOf("reason: 'install'");
    const computed = body.indexOf('networkFailure(');
    assert.ok(
      computed > 0,
      'the install failure never asks whether the registry was at fault',
    );
    assert.ok(
      at === -1 || computed < at,
      'the install reason is fixed before the classifier is consulted',
    );
  });

  it('separates a busy sandbox from a project that will not build', () => {
    // These two were the same value until #194, and conflating them spends
    // a model call on a project that compiles perfectly well.
    const body = buildProjectBody();
    for (const reason of ['busy', 'install', 'build']) {
      assert.match(body, new RegExp(`'${reason}'`), reason);
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
    //
    // Two halves since the teardown became its own method: every exit has
    // to reach it, and it has to give the lock back. Asserting only the
    // second would pass on a build that never called it.
    assert.match(
      buildProjectBody(),
      /finally \{[\s\S]*?this\.releaseBuild\(/,
      'a path out of the build never reaches the teardown',
    );
    assert.match(
      releaseBuildCode(),
      /storage\.delete\(BUILD_LOCK_KEY\)/,
      'the teardown never gives the build lock back',
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
    const teardown = releaseBuildCode();
    assert.match(
      teardown,
      /const ours = mine\?\.token === token;/,
      "nothing works out whether the lock is still this build's",
    );
    for (const at of [
      ...teardown.matchAll(/storage\.delete\(BUILD_LOCK_KEY\)/g),
    ]) {
      const guard = teardown.slice(0, at.index);
      assert.match(
        guard.slice(guard.lastIndexOf('if (')),
        /if \([^)]*(\bours\b|\?\.token === token)/,
        'a delete of the build lock is not guarded by owning it',
      );
    }
  });

  it('stops a command that reached its bound from reading as a project failure', () => {
    // Being stopped says nothing about the project, so it must not buy a
    // repair: `sandbox`, which `judgedTheProject` reads as unknown, and
    // not `install` or `build`, which it reads as a verdict.
    const body = buildProjectCode();
    for (const bound of ['installTimeout', 'compileTimeout']) {
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
    assert.match(
      releaseBuildCode(),
      /destroyHoldingLock\(token\)/,
      'a finished build holds its container until sleepAfter',
    );
  });

  it('does not keep the caller waiting while it does', () => {
    // #196 review. The teardown waits up to MAX_DESTROY_WAIT_MS for a
    // container to die, and awaiting that put ten minutes of somebody
    // else's problem onto the clock of a paid Workflow that already had
    // its answer: `REPAIR_BUILD_ALLOWANCE_MS` budgets two builds
    // (`apps/web/test/repair-timeout.test.ts`) and a build had quietly
    // grown a teardown, so two of them could take forty minutes against a
    // twenty-five minute allowance.
    //
    // Both halves, because either alone passes on the wrong code: dropping
    // the call entirely satisfies "nothing is awaited", and an await
    // sitting beside a `waitUntil` satisfies "the teardown is handed off".
    const tail = buildProjectCode().slice(
      buildProjectCode().lastIndexOf('} finally {'),
    );
    assert.match(
      tail,
      /ctx\.waitUntil\(this\.releaseBuild\(/,
      'the teardown is not handed to the runtime to finish',
    );
    assert.doesNotMatch(
      tail,
      /await this\.releaseBuild\(/,
      'the build waits out a teardown its caller has no use for',
    );
  });

  it('destroys it only while the lock is still its own', () => {
    // The sharper half of the ownership check. A build that overran is
    // running in the same container as whoever now holds the lock, so
    // destroying it there would kill their build rather than free a slot.
    const teardown = releaseBuildCode();
    const owned = teardown.indexOf('token === token');
    const destroyed = teardown.indexOf('destroyHoldingLock(token)');
    assert.ok(owned > 0 && destroyed > owned, 'the destroy is unguarded');
  });
});

/**
 * That a lock expires on silence rather than on project size
 * (#196 review).
 *
 * The TTL exists so a crashed build stops blocking the next one, and it was
 * being compared against work that is only partly bounded: the two commands
 * have timeouts, but writing the project in and reading the output back are
 * one RPC per file. A build that outran the TTL had its workspace emptied
 * underneath it and then went on to destroy the container the thief was
 * using, because its own ownership answer predated the destroy it awaited.
 */
describe('keeping the lock alive while the build is', () => {
  it('asks at every boundary between bounded and unbounded work', () => {
    const body = buildProjectCode();
    const asked = body.match(/keepAlive\(\)/g)?.length ?? 0;
    assert.ok(
      asked >= 3,
      `only ${asked} checks: the TTL still measures project size`,
    );
    assert.ok(
      body.indexOf('keepAlive') < body.indexOf('npm install'),
      'the first check comes after the project has been written in',
    );
  });

  it('starts its clock before it awaits anything, including the lock', () => {
    // #196 review. The deadline used to be created after the lock had been
    // read and written, on the reasoning that those are this object's own
    // storage. Local is not the same as inside the bound: a storage call
    // that stalled left the method with no deadline running at all, so the
    // whole-build guarantee did not cover its own first two lines, and an
    // invocation whose caller had long given up could still take a ticket
    // and run a full build for nobody.
    const body = buildProjectCode();
    const clock = body.indexOf('const deadline =');
    assert.ok(clock > 0, 'the build has no wall clock');
    for (const first of ['storage.get<BuildLock>', 'storage.put<BuildLock>']) {
      const at = body.indexOf(first);
      assert.ok(at > 0, `${first} is no longer where this expected it`);
      assert.ok(
        clock < at,
        `${first} is awaited before the build's clock starts`,
      );
      assert.match(
        body.slice(Math.max(0, at - 120), at),
        /bounded\(\s*$|bounded\([^)]*$/,
        `${first} can outlast the whole build's budget`,
      );
    }
  });

  it('is built from the clock as well as the lock', () => {
    // Two different ways to stop being entitled to the workspace, and the
    // second one is what three rounds of heartbeats kept missing: a build
    // with no bound of its own can outlive the lock's TTL and the fleet's
    // hard lifetime, so every protection around it had to cover every
    // single await. `build-limits.test.ts` holds the arithmetic.
    const body = buildProjectCode();
    const built = body.slice(body.indexOf('const keepAlive'));
    const definition = built.slice(0, built.indexOf(';'));
    assert.match(definition, /deadline/, 'a slow build never runs out of time');
    // The renewal and the bound it is given, in one match. A renewal with
    // no deadline of its own is the third way to stop being entitled to
    // the workspace and the one that survives both checks above: its own
    // two storage calls can stay pending, and then neither the clock nor
    // the lock is ever consulted again (#196 review).
    assert.match(
      definition,
      /keepLock\(token, deadline\)/,
      'a superseded or timed-out build never finds out',
    );
  });

  it('stops rather than carrying on when the answer is no', () => {
    // The half that renewing alone could never do. `renewLock` was already
    // conditional on ownership, so a superseded build renewed nothing,
    // learned nothing, and went on writing into the workspace its
    // successor had just emptied. Every check must act on the answer, so
    // this counts the checks that are acted on against the checks there
    // are, rather than trusting that they look the same.
    const body = buildProjectCode();
    const guarded =
      body.match(
        /if \(!\(await (this\.)?(writeProject|keepAlive)\([^)]*\)\)\)\s*return/g,
      )?.length ?? 0;
    const asked = body.match(/await keepAlive\(\)/g)?.length ?? 0;
    assert.ok(asked > 0, 'nothing checks whether the build may carry on');
    assert.equal(
      guarded,
      asked + 1,
      'a check happens and its answer is thrown away, or the write loop no longer reports',
    );
  });

  it('hands the heartbeat to the loop that writes the project in', () => {
    // The other end of the same hazard, and the one that had no protection
    // at all until the twenty-second review round: the loop is one or two
    // RPCs per file and the renewal sat after it, so a big enough project
    // outran the lock while holding it. `build-files.test.ts` counts the
    // heartbeats by calling the loop; what a source read can say is that
    // this build gives it a real one rather than the preview's always-true.
    const body = buildProjectCode();
    const call = body.slice(body.indexOf('writeProject('));
    assert.ok(call.length > 0, 'the project is no longer written by that loop');
    assert.match(
      call.slice(0, call.indexOf(');')),
      /keepAlive/,
      'the write loop is given no way to find out it should stop',
    );
  });

  it('hands the heartbeat to the loop that reads the output back', () => {
    // The longest unbounded stretch a build has, and the one most likely to
    // outrun a TTL on a project with many files. It lives in
    // `build-files.ts` now, where `build-files.test.ts` calls it with fakes
    // (#196 review), so what is left to assert here is the wiring.
    //
    // Which is the whole argument for the extraction. The defect that
    // prompted it was a renewal counting the files the loop kept rather
    // than the files it read, and the test that used to stand here matched
    // `renewLock(token)` inside the loop and passed throughout.
    const body = buildProjectCode();
    const call = body.slice(body.indexOf('collectOutput('));
    assert.ok(call.length > 0, 'the output is no longer read by that loop');
    assert.match(
      call.slice(0, call.indexOf(');')),
      /keepAlive/,
      'the read loop is given no way to find out it should stop',
    );
  });

  it('bounds every call that has no bound of its own', () => {
    // The deadline between operations does nothing for a build stuck
    // inside one of them (#196 review). `build-files.test.ts` proves the
    // race itself by calling it; what a source read can say is which calls
    // are run through it. `exec` is absent on purpose: both commands carry
    // their own timeout, which is what `build-limits.ts` is for.
    const body = buildProjectCode();
    // The clear and the root mkdir are named as well as the two reads,
    // because a mutation that unbounded the clear survived a version of
    // this test that only looked at the reads: it asserted the call sites
    // the last finding happened to name rather than the property, which is
    // the mistake this pull request keeps finding in its own tests.
    for (const rpc of [
      "exec('rm -rf /workspace'",
      "mkdir('/workspace'",
      'listFiles(',
      'readFile(',
    ]) {
      const at = body.indexOf(rpc);
      assert.ok(at > 0, `${rpc} is no longer where this expected it`);
      assert.match(
        body.slice(Math.max(0, at - 120), at),
        /bounded\(\s*(this\.)?$|bounded\([^)]*$/,
        `${rpc} can outlast the whole build's budget`,
      );
    }
  });

  it('knows the lock is still its own before it empties the workspace', () => {
    // #196 review. The clear is the first destructive thing a build does
    // and everything before it can take time, the fleet admission most of
    // all. Checking only between the steps that follow it let a build that
    // had already been superseded empty its successor's workspace.
    const body = buildProjectCode();
    const check = body.lastIndexOf('keepAlive()', body.indexOf('rm -rf'));
    assert.ok(
      check > 0 && check < body.indexOf('rm -rf'),
      'the workspace is emptied without knowing whose it is',
    );
  });

  it('cuts each command cap down to what is left of the build', () => {
    // A wall clock that the two slowest things in the build ignore is not
    // a wall clock. `build-files.test.ts` proves the arithmetic by calling
    // it; this is that both commands go through it.
    const body = buildProjectCode();
    for (const cap of [
      'BUILD_INSTALL_TIMEOUT_MS',
      'BUILD_COMPILE_TIMEOUT_MS',
    ]) {
      assert.match(
        body,
        new RegExp(`within\\(${cap}\\)`),
        `${cap} is spent in full however late the build already is`,
      );
    }
  });

  it('measures a stopped command against the bound it was actually given', () => {
    // Otherwise a command cut short by the remaining budget reads as a
    // failure of the project, which buys a repair for a build that was
    // stopped rather than one that failed.
    const body = buildProjectCode();
    for (const [started, bound] of [
      ['installStartedAt', 'installTimeout'],
      ['buildStartedAt', 'compileTimeout'],
    ]) {
      assert.match(
        body,
        new RegExp(`Date\\.now\\(\\) - ${started} >= ${bound}`),
        `a truncated command is reported as a verdict on the project`,
      );
    }
  });

  it('bounds the calls that write the project in too', () => {
    // A separate region, because they live in `writeProject` rather than
    // in the build itself, and the last round's lesson is that a region
    // which quietly grows to cover a method is worse than no region.
    const method = bodyOf('private writeProject(', 'private isExpired(');
    for (const rpc of ['this.mkdir(', 'this.writeFile(']) {
      const at = method.indexOf(rpc);
      assert.ok(at > 0, `${rpc} is no longer where this expected it`);
      assert.match(
        method.slice(Math.max(0, at - 40), at),
        /bounded\(/,
        `${rpc} can outlast the whole build's budget`,
      );
    }
  });

  it('refuses a half-read output tree rather than reporting it', () => {
    // A loop that stopped has read some of the files and not others, and
    // publishing or verifying against that would be a claim about files
    // nobody read.
    const body = buildProjectCode();
    assert.match(
      body,
      /if \(!complete\) return/,
      'a build that was stopped mid-read hands back what it happened to get',
    );
  });

  it('keeps renewing while the container is being torn down', () => {
    // The renewals around the build stopped at the edge of teardown, and
    // `destroy()` has no deadline of its own: one that blocked past the TTL
    // let another build take the lock and start in this same sandbox, which
    // the first destroy then killed. Holding the lock across the destroy is
    // the fix, and the renewal inside that wait is the whole of it -- a
    // mutation that removed it survived every other test here, because they
    // all count renewals in `buildProject` and this one is a method along.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
      'utf8',
    );
    const at = source.indexOf('private async destroyHoldingLock(');
    assert.ok(at > 0, 'destroyHoldingLock is not where this expected it');
    const method = source.slice(at, source.indexOf('\n  private ', at + 10));
    assert.match(
      method,
      /renewLock\(token, until\)/,
      'the teardown waits out the destroy without holding the lock',
    );
    // That the renewal happens *inside* the wait, repeatedly, rather than
    // once before it, is `teardown.test.ts`, which calls `destroyWithin`
    // and counts the renewals. This end of it is the wiring that test
    // cannot see: that the teardown hands over a renewal at all, and hands
    // it the same cap it is waiting under, so the renewal cannot outlast
    // the wait it is renewing through (#196 review).
    //
    // The assertion here used to compare the position of the renewal
    // against the position of `Promise.race`. Both moved into
    // `destroyWithin` in another module, so both `indexOf` calls returned
    // -1 and the comparison went on being evaluated against nothing.
    assert.match(
      method,
      /destroyWithin\(/,
      'the teardown no longer waits through a bounded loop at all',
    );
    assert.ok(
      method.indexOf('renewLock(token, until)') > method.indexOf('until ='),
      'the renewal is handed a cap before one has been worked out',
    );
  });

  it('renews only while the lock is still its own', () => {
    // An unconditional renew would let a build that had already been
    // superseded take its lock back, which starts the same problem from
    // the other side.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
      'utf8',
    );
    const at = source.indexOf('private async renewLock(');
    assert.ok(at > 0, 'renewLock is not where this expected it');
    const method = source.slice(at, source.indexOf('\n  private ', at + 10));
    assert.match(
      method,
      /token !== token\)? ?return|mine\?\.token !== token/,
      'the renewal writes without checking whose lock it is',
    );
  });

  it('re-reads the lock after the destroy it awaited', () => {
    // The ownership answer used for the delete was computed before an
    // await. A build that overran could delete the lock somebody else took
    // during that await.
    // Scoped to what happens after the destroy. The branch for a build
    // that never started reads and deletes the lock before any of this,
    // and it has no container to wait for, so its read is not the one this
    // is about (#196 review).
    const teardown = releaseBuildCode();
    const destroyed = teardown.indexOf('destroyHoldingLock(token)');
    assert.ok(destroyed > 0, 'the teardown no longer destroys the container');
    const reread = teardown.indexOf('storage.get<BuildLock>', destroyed);
    const deleted = teardown.indexOf('storage.delete(BUILD_LOCK_KEY)', reread);
    assert.ok(reread > destroyed, 'the teardown lost its re-read');
    assert.ok(
      deleted > reread,
      'the delete trusts an ownership answer from before the destroy',
    );
  });
});

/**
 * That every storage call in the teardown and the renewal is bounded
 * (#196 review).
 *
 * Counted rather than located. Six rounds of this file asserted that some
 * named call was wrapped, and each time the next round found the one that
 * was not: the finding is never "this call is unbounded", it is "one of
 * these calls is unbounded and nothing says which". Counting both sides
 * turns that into arithmetic, and a bound that is added without its
 * wrapper fails here rather than in the round after next.
 *
 * `preview-sandbox.ts` cannot be loaded under `node --test`, so this is a
 * source read. It is the property rather than the text around it: the
 * number of storage calls and the number of bounded ones.
 */
describe('what the teardown and the renewal await', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
    'utf8',
  );

  /** One method, from its signature to the next one. */
  function methodOf(name: string): string {
    const at = source.indexOf(name);
    assert.ok(at > 0, `${name} is not where this expected it`);
    const end = source.indexOf('\n  private ', at + 10);
    assert.ok(end > at, `${name} runs to the end of the file`);
    return source.slice(at, end);
  }

  /**
   * Every `this.ctx.storage.` call, and every one of them inside a
   * `bounded(` call. A storage call is one or the other, so the two counts
   * have to match.
   */
  function unbounded(method: string): number {
    const all = method.match(/this\.ctx\.storage\./g)?.length ?? 0;
    const wrapped =
      method.match(/bounded\(\s*\n?\s*this\.ctx\.storage\./g)?.length ?? 0;
    assert.ok(all > 0, 'the method no longer touches storage at all');
    return all - wrapped;
  }

  it('bounds both halves of a renewal', () => {
    // The read that decides whether the lock is still ours and the write
    // that pushes it forward. Either one pending means `keepAlive` never
    // answers, and then neither the wall clock nor the lock is consulted
    // again: the build outlives its budget without reaching its teardown.
    assert.equal(
      unbounded(methodOf('private async renewLock(')),
      0,
      'a renewal can stay pending past the build it is renewing for',
    );
  });

  it('bounds every storage call in the teardown', () => {
    // The teardown runs on `ctx.waitUntil` now, so it has no caller
    // waiting to time out and no clock but its own. A stalled read here is
    // a teardown that never reaches its release.
    assert.equal(
      unbounded(methodOf('private async releaseBuild(')),
      0,
      'a teardown can stay pending with a ticket still held',
    );
  });

  it('gives the teardown a clock of its own to bound them against', () => {
    // Its own, not one borrowed from something inside it. The teardown
    // contains `MAX_DESTROY_WAIT_MS`, so measuring itself against that
    // would stop it before the destroy it exists to wait for, and
    // `build-limits.test.ts` holds that arithmetic on the constants.
    //
    // There was a second assertion here, that the clock is created before
    // the calls it bounds, which is the shape of the finding two rounds
    // ago. It cannot fail: `bounded` is a `const` every one of those calls
    // reads, so moving its declaration below them is a compile error
    // rather than a test failure. A mutation proved it and the assertion
    // is gone, because one that cannot fail is worse than none.
    assert.match(
      methodOf('private async releaseBuild('),
      /TEARDOWN_WALL_CLOCK_MS/,
      'the teardown measures itself against something other than its own cap',
    );
  });
});
