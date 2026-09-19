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
describe('counting the builds too', () => {
  const source = read(
    join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
    'utf8',
  );
  const body = source.slice(
    source.indexOf('async buildProject('),
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
    const finallyAt = body.lastIndexOf('} finally {');
    assert.ok(finallyAt > 0);
    assert.match(
      body.slice(finallyAt),
      /\.release\(slot\.id, BUILD_CONTAINER_HEADROOM\)/,
      'a finished build keeps its slot until the fleet reclaims it',
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
    const tail = body.slice(body.lastIndexOf('} finally {'));
    const guard = tail.slice(0, tail.indexOf('.release(slot.id'));
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
    const tail = body.slice(body.lastIndexOf('} finally {'));
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
    const tail = body.slice(body.lastIndexOf('} finally {'));
    // Both arms, in order: a destroy that resolved means gone, a destroy
    // that rejected means *not* gone. Asserting only that `gone` is
    // computed let a mutation flip the rejection arm to `true` and survive,
    // which is precisely the claim this whole case rests on.
    assert.match(
      tail,
      /const gone = ours[\s\S]{0,80}?destroy\(\)[\s\S]{0,80}?\(\) => true,[\s\S]{0,40}?\(\) => false,/,
      'a destroy that rejected is not treated as a container that went away',
    );
    assert.match(
      tail,
      /if \(ours && gone\) \{[\s\S]{0,120}?storage\.delete\(BUILD_LOCK_KEY\)/,
      'the lock is given back without confirming the container is gone',
    );
    assert.match(
      tail,
      /if \(slot && \(!ours \|\| gone\)\)/,
      'the slot is given back without confirming the container is gone',
    );
  });

  it('gives it back only after the container is gone', () => {
    // #196 review. The slot is what authorises somebody else to start a
    // container, so releasing it while this one still exists lets the
    // fleet admit a build the platform has no room for: the same
    // over-admission the counter was added to prevent, moved from previews
    // to builds.
    const tail = body.slice(body.lastIndexOf('} finally {'));
    const destroyed = tail.indexOf('this.destroy()');
    const released = tail.indexOf('.release(slot.id');
    assert.ok(destroyed > 0 && released > 0, 'the finally lost a step');
    assert.ok(
      destroyed < released,
      'the slot is freed while its container is still running',
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
