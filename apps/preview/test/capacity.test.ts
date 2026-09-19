import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { readFileSync as read } from 'node:fs';

import {
  ACCOUNT_MAX_IN_FLIGHT,
  BUILD_CONTAINER_HEADROOM,
  BUILD_FLEET_NAME,
  CONTAINER_MAX_INSTANCES,
} from '../worker/capacity.ts';

/**
 * That the fleet's cap and the platform's cannot disagree (#196 review).
 *
 * `wrangler.jsonc`'s own comment used to be able to say they never could,
 * because every container was a preview and the fleet counted every one.
 * Builds broke that quietly in both directions: the fleet would admit a
 * preview the platform had no slot for, and a deployment at its preview cap
 * had nothing left to verify or publish with. Neither shows up as an error
 * in the code that causes it.
 */
describe('who gets a container', () => {
  it('keeps the fleet cap below the platform limit', () => {
    assert.ok(
      ACCOUNT_MAX_IN_FLIGHT < CONTAINER_MAX_INSTANCES,
      'previews alone may fill every container the platform allows',
    );
  });

  it('leaves exactly the headroom it claims to', () => {
    // Arithmetic rather than two numbers that happen to agree: this is the
    // property, and it is the one a well-meaning bump of either constant
    // would break.
    assert.equal(
      ACCOUNT_MAX_IN_FLIGHT + BUILD_CONTAINER_HEADROOM,
      CONTAINER_MAX_INSTANCES,
    );
  });

  it('keeps enough back for a repair to build twice', () => {
    // The smallest thing the headroom has to survive: one repair is two
    // builds, and it is not the only caller.
    assert.ok(BUILD_CONTAINER_HEADROOM >= 2);
  });

  it('matches what wrangler.jsonc actually gives the class', () => {
    // The number that can drift without anything noticing, because it lives
    // in configuration this code never reads. A deployment whose real cap
    // is lower than this file believes has no headroom at all.
    const config = readFileSync(
      join(import.meta.dirname, '..', 'wrangler.jsonc'),
      'utf8',
    );
    const declared = config.match(/"max_instances":\s*(\d+)/);
    assert.ok(declared, 'max_instances is no longer declared for the class');
    assert.equal(
      Number(declared[1]),
      CONTAINER_MAX_INSTANCES,
      'the platform limit and this file have drifted apart',
    );
  });
});

/**
 * That the build half of the split is counted, not merely subtracted
 * (#196 review).
 *
 * Reserving five slots said nothing about how many builds may run: six
 * overlapping builds and nineteen previews filled all twenty-five platform
 * slots while the fleet still believed it had room for a twentieth preview.
 * A partition only one side observes is not a partition.
 *
 * `preview-sandbox.ts` imports `@cloudflare/sandbox` and cannot be loaded
 * here, so this reads it as source.
 */
/**
 * Where the teardown gives the fleet ticket back.
 *
 * A helper rather than an `indexOf` at each site, because the arguments to
 * that call have changed twice and every assertion written against them
 * broke with it -- one of them silently, by slicing on an `indexOf` of -1
 * and then passing for the wrong reason. The call is the anchor; what it
 * is passed is not.
 */
function releaseAt(tail: string): number {
  const at = tail.indexOf('.release(');
  assert.ok(at > 0, 'the teardown no longer releases the fleet ticket');
  return at;
}

describe('counting the builds too', () => {
  const source = read(
    join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
    'utf8',
  );
  const body = source.slice(
    source.indexOf('async buildProject('),
    source.indexOf('private async releaseBuild('),
  );
  /**
   * The same region with its prose taken out.
   *
   * Because a window measured in characters is measuring the comments too:
   * the assertion that `started` is set at the first `exec` broke when
   * four lines of explanation were added between them, while the property
   * it is about never changed. That is the ninth time on this file that a
   * test has measured the text around a property rather than the property.
   */
  const code = body
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
  /**
   * The teardown, read as the method it now is.
   *
   * It used to sit inside `buildProject`'s `finally` and this region ran
   * to `createShare`, so when it was lifted out into the method between
   * the two, every assertion below went on reading it without one of them
   * changing. That is a region measuring where the code happens to sit
   * rather than what it does, and it is the seventh time a test on this
   * file has done it. Naming both ends, and naming the method rather than
   * a landmark past it, is what keeps the two regions honest.
   */
  const teardown = source.slice(
    source.indexOf('private async releaseBuild('),
    source.indexOf('async createShare('),
  );

  it('takes a slot before it does any work', () => {
    const taken = body.indexOf('.enqueue(');
    assert.ok(taken > 0, 'a build takes no slot at all');
    assert.ok(
      taken < body.indexOf('npm install'),
      'the slot is taken after the container is already working',
    );
  });

  it('counts builds against their own cap, not the preview one', () => {
    // Mixing them into the preview queue would make L9's cap mean
    // something else again, which is the mistake one level up.
    assert.match(body, /BUILD_CONTAINER_HEADROOM/);
    assert.doesNotMatch(
      body.slice(0, body.indexOf('npm install')),
      /ACCOUNT_MAX_IN_FLIGHT/,
      'a build is counted against the preview cap',
    );
  });

  it('counts them in an instance of their own', () => {
    assert.notEqual(BUILD_FLEET_NAME, 'fleet');
    assert.match(body, /getByName\(BUILD_FLEET_NAME\)/);
  });

  it('refuses rather than queueing when the slots are full', () => {
    // A paid Workflow is waiting on the answer, so waiting behind other
    // builds spends its timeout. `busy` says nothing about the project,
    // which is what makes refusing safe.
    const at = body.indexOf('!slot.active');
    assert.ok(at > 0, 'a build that was queued rather than admitted proceeds');
    assert.match(body.slice(at, at + 400), /reason: 'busy'/);
  });

  it('gives the slot back on every path out', () => {
    // Two halves, because the teardown is a method away now: every exit
    // from the build has to reach it, and it has to release.
    const finallyAt = body.lastIndexOf('} finally {');
    assert.ok(finallyAt > 0, 'the build no longer tears down on every path');
    assert.match(
      body.slice(finallyAt),
      /this\.releaseBuild\(/,
      'a path out of the build never reaches the teardown',
    );
    assert.ok(
      releaseAt(teardown) > 0,
      'a finished build keeps its slot until the fleet reclaims it',
    );
    assert.match(
      teardown.slice(releaseAt(teardown)),
      /BUILD_CONTAINER_HEADROOM/,
      'the release is counted against some other cap',
    );
  });

  it('asks again when the release itself rejects', () => {
    // #196 review. A suppressed release is not a delayed one here:
    // `PreviewFleet.reclaimStale` only reclaims rows it has activated, so
    // an abandoned queued ticket never expires. It waits for a slot, is
    // promoted with nobody to use it, and only then begins its hard
    // lifetime, which turns one dropped release into a build slot lost to
    // whoever is next in the queue.
    const tail = teardown;
    assert.match(
      tail,
      /retrying\(\(\) =>[\s\S]{0,240}?\.release\(/,
      'one refused release abandons the ticket for good',
    );
    assert.doesNotMatch(
      tail,
      /\.release\([\s\S]{0,120}?\.catch\(\(\) => \{\}\)/,
      'the release still swallows its own failure after one try',
    );
  });

  it('gives back a queued ticket as well as an active one', () => {
    // Guarded by the ticket existing, not by its state. A waiting row
    // holds no slot today and is promoted later, so abandoning one hands
    // a build slot to nobody until the fleet's stale reclaim notices --
    // which is the leak this release exists to prevent, arriving late.
    // Asserted as "the guard does not consult the ticket's state", not as
    // the exact guard the code happens to have: the property is what
    // matters and the shape has already changed once under it.
    const tail = teardown;
    const guard = tail.slice(0, releaseAt(tail));
    const condition = guard.slice(guard.lastIndexOf('if ('));
    assert.match(condition, /\bslot\b/, 'the release is not guarded at all');
    assert.doesNotMatch(
      condition,
      /\.active\b/,
      'only an active ticket is released, so a queued one is abandoned',
    );
  });

  it('never returns from the teardown', () => {
    // A `return` in a `finally` replaces whatever the build had already
    // decided to answer. Worth pinning because the three cases below read
    // like early returns and are the obvious way to write them.
    const tail = teardown;
    assert.doesNotMatch(
      tail.replace(/\/\/[^\n]*/g, ''),
      /\breturn\b/,
      'the teardown can discard the build outcome',
    );
  });

  it('holds both the lock and the slot when the container will not die', () => {
    // #196 review. Releasing either after a failed destroy hands somebody
    // a container the platform says does not exist: the lock starts this
    // user's next build inside it, the slot lets the fleet authorise a
    // twenty-sixth container the platform then refuses to start. Holding
    // costs one build slot for as long as the fleet's stale reclaim takes,
    // which is bounded, and refuses safely in the meantime.
    const tail = teardown;
    // Both arms, in order: a destroy that resolved means gone, a destroy
    // that rejected means *not* gone. Asserting only that `gone` is
    // computed let a mutation flip the rejection arm to `true` and survive,
    // which is precisely the claim this whole case rests on.
    // Sliced to the statement that computes it, so this says nothing about
    // the shape of the rest of the expression: the property is that within
    // it, the destroy's resolve arm means gone and its reject arm does not.
    const at = tail.indexOf('const gone =');
    assert.ok(at > 0, 'nothing works out whether the container went away');
    const computed = tail.slice(at, tail.indexOf(';', at));
    // The two arms moved into `destroyHoldingLock`, which is where the
    // destroy now lives; what the teardown reads is its answer.
    assert.match(
      computed,
      /destroyHoldingLock\(token\)/,
      'the teardown no longer asks whether the container went away',
    );
    const source = read(
      join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
      'utf8',
    );
    const helperAt = source.indexOf('private async destroyHoldingLock(');
    assert.ok(helperAt > 0, 'destroyHoldingLock is not where this expected it');
    assert.match(
      source.slice(helperAt, source.indexOf('\n  private ', helperAt + 10)),
      /destroy\(\)[\s\S]*?\(\) => true,[\s\S]*?\(\) => false,/,
      'a destroy that rejected is not treated as a container that went away',
    );
    // Widened deliberately: a re-read of the lock now sits between the
    // guard and the delete, because the ownership answer the guard used
    // predates the destroy it awaited. The property is that the delete is
    // inside the `ours && gone` branch, not how close it sits to it.
    assert.match(
      tail,
      /if \(ours && gone\) \{[\s\S]*?storage\.delete\(BUILD_LOCK_KEY\)/,
      'the lock is given back without confirming the container is gone',
    );
    assert.match(
      tail,
      /if \(slot && \(!ours \|\| gone\)\)/,
      'the slot is given back without confirming the container is gone',
    );
  });

  it('gives back a ticket for a refusal it issued before anything ran', () => {
    // #196 review. A full fleet is refused before the first `exec`, so
    // there is no container: holding that ticket holds it against nothing.
    // Worse than a delay, because `PreviewFleet.reclaimStale` only reclaims
    // rows it has activated -- a queued row is never reclaimed, so an
    // abandoned one waits for a slot, is promoted with nobody to use it,
    // and only then starts its thirty-minute hard lifetime.
    assert.match(
      body,
      /let started = false;/,
      'nothing records whether the container was ever put to work',
    );
    assert.match(
      code,
      /started = true;[\s\S]{0,120}?this\.exec\(/,
      'the flag is not set at the first thing that starts a container',
    );
    const tail = teardown;
    assert.match(
      tail,
      /const gone = !started\s*\?\s*true/,
      'a refusal that ran nothing still has to prove its container is gone',
    );
  });

  it('gives it back only after the container is gone', () => {
    // #196 review. The slot is what authorises somebody else to start a
    // container, so releasing it while this one still exists lets the
    // fleet admit a build the platform has no room for: the same
    // over-admission the counter was added to prevent, moved from previews
    // to builds.
    const tail = teardown;
    const destroyed = tail.indexOf('destroyHoldingLock(token)');
    const released = releaseAt(tail);
    assert.ok(destroyed > 0, 'the finally no longer destroys the container');
    assert.ok(
      destroyed < released,
      'the slot is freed while its container is still running',
    );
  });

  it('waits for a slot no longer than the build itself may take', () => {
    // #196 review. Awaited directly, a stalled `enqueue` kept the build
    // alive past its own deadline: the lock expired, a successor took the
    // sandbox, and when this finally returned the next thing it did was
    // empty that successor's workspace.
    //
    // Asserted as "the admission goes through `admit`, and `admit` is
    // given the deadline and the release", because what `admit` then does
    // with them is `admission-late.test.ts`'s business, called rather than
    // read. The first version of this test matched the shape of the inline
    // code and passed against an implementation that released the ticket
    // of every build on the ordinary path.
    const call = code.slice(code.indexOf('slot = await admit('));
    assert.ok(call.length > 0, 'the admission no longer goes through admit');
    const args = call.slice(0, call.indexOf('\n      );'));
    assert.match(args, /\.enqueue\(/, 'admit is not given the admission');
    assert.match(args, /bounded/, 'the wait for a slot is unbounded');
    assert.match(
      args,
      /releaseTicket\(/,
      'a ticket that lands after the build gave up is held for good',
    );
  });

  it('takes the slot where the cleanup can still reach it', () => {
    // `enqueue` is a call to another Durable Object and can reject. Outside
    // the try that rejection skipped every piece of cleanup and left the
    // build lock in storage, so the next fifteen minutes of that user's
    // verifications and publishes were refused as `busy` over a failure
    // that had nothing to do with them.
    const tryAt = body.indexOf('try {');
    const enqueued = body.indexOf('.enqueue(');
    assert.ok(tryAt > 0 && enqueued > 0);
    assert.ok(
      enqueued > tryAt,
      'a rejected enqueue leaves the build lock behind',
    );
  });
});
