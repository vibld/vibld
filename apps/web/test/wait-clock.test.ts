import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

/**
 * The elapsed figure `/api/plan` streams has to mean the caller's wait.
 *
 * It was read where the poll loop begins, which looks like the right place
 * and is not: everything before that line is wait too. A request naming a
 * reference URL spends up to twelve seconds fetching that page and its
 * stylesheets (`reference-fetch.ts`) before a Workflow exists to poll, and
 * identity, rate limits, accounting and creation each cost their own moment.
 * A clock started afterwards opens at 0:00 for somebody who has already
 * waited a quarter of a minute, and holds back the 45-second reassurance by
 * exactly the wait that earned it.
 *
 * Where a value is read is not a value, so no assertion about constants can
 * hold this. The arrangement of the function is the invariant, so the
 * arrangement is what is read -- the same reason `browser-boundary.test.ts`
 * reads its sources rather than importing them.
 */

/** The preprocessing a caller sits through before the run even starts. */
const BEFORE_THE_RUN = [
  'env.IP_BURST.limit',
  'resolvePrincipal(',
  'fetchReferenceContext(',
  'reserveBudget(',
  'GENERATION_WORKFLOW!.create(',
];

async function handlePlanBody(): Promise<string> {
  const source = await readFile(
    new URL('../worker/index.ts', import.meta.url).pathname,
    'utf8',
  );
  const start = source.indexOf('async function handlePlan(');
  assert.notEqual(start, -1, 'handlePlan must still be findable by name');
  // To the first brace back in column one, which is where a top-level
  // function ends and the next one has not begun.
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, 'handlePlan must have an end');
  return source.slice(start, end);
}

describe('the clock a waiting caller is shown', () => {
  it('starts before every step the caller waits through', async () => {
    const body = await handlePlanBody();
    const clock = body.indexOf('const waitingSince = Date.now()');
    assert.notEqual(
      clock,
      -1,
      'handlePlan must read the time it reports elapsed against, once, into a const -- a rebindable clock is what lets a later line restart it',
    );

    for (const step of BEFORE_THE_RUN) {
      const at = body.indexOf(step);
      assert.notEqual(at, -1, `${step} must still be part of handlePlan`);
      assert.ok(
        clock < at,
        `the elapsed clock is read after ${step}, so the time that step costs is not counted as the wait it is`,
      );
    }
  });

  it('reads the time once, so nothing later can restart it', async () => {
    const body = await handlePlanBody();
    const assignments = body.match(/waitingSince\s*=/g) ?? [];
    assert.equal(
      assignments.length,
      1,
      "a second assignment would reset the caller's clock mid-wait, which is the bug this file exists for",
    );
  });
});
