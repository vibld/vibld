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
});
