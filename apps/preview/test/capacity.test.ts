import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  ACCOUNT_MAX_IN_FLIGHT,
  BUILD_CONTAINER_HEADROOM,
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
