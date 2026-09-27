import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUILD_FAILURE_REASONS } from '../worker/publish-client.ts';
import { BUILD_FAILURE_REASONS as SENT } from '../../preview/worker/build-failure.ts';
import { worthRepairing } from '../worker/generation-run.ts';

/**
 * That the two deployments still mean the same thing by a build failure
 * (#196 review).
 *
 * `apps/web` keeps its own copy of the reason list on purpose: the two
 * Workers are separate deployments that talk over a service binding and
 * share no build, so importing across them at runtime is not on offer.
 * What was missing is the thing that makes a copy safe, which is a check.
 *
 * `parseBuildResult` already guards one direction: a value the other side
 * never sends is rejected. It cannot guard the other. A reason added to
 * `apps/preview` and not to the copy here is dropped at the boundary as
 * unrecognised, so a failure the build service named exactly arrives as no
 * evidence at all, and the repair turn this whole feature exists for
 * silently does not fire for it.
 *
 * Imported directly rather than read as source, the same way
 * `repair-timeout.test.ts` imports the build bounds: `build-failure.ts`
 * holds no Cloudflare imports, which is why the list lives there rather
 * than in `preview-sandbox.ts`.
 */
describe('the reasons a build can give', () => {
  it('are the same list on both sides of the service binding', () => {
    assert.deepEqual(
      [...BUILD_FAILURE_REASONS].sort(),
      [...SENT].sort(),
      'one deployment names a build failure the other cannot read',
    );
  });

  it('are each either the project or the service, never neither', () => {
    // The decision is a record over the whole union, so a new member does
    // not compile until it is classified. This is the runtime half of the
    // same claim: every reason that exists gets an answer, and exactly the
    // two that are evidence about the project buy a repair.
    const funded = { monthlyAllowance: 1_000_000, topupCeiling: 0 };
    const repairable = BUILD_FAILURE_REASONS.filter((reason) =>
      worthRepairing({ ok: false, reason }, funded),
    );
    assert.deepEqual([...repairable].sort(), ['build', 'install']);
  });
});
