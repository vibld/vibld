import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEASURED_OUTPUT_TOKENS_PER_SECOND,
  MODEL_CATALOGUE,
  RUN_ABANDONED_AFTER_MS,
  RUN_STEP_TIMEOUT_MS,
  RUN_WALL_CLOCK_BUDGET_MS,
  maxTokensFor,
} from '@vibld/ai';

/**
 * A token ceiling is a time budget (#179 follow-up).
 *
 * Tokens are produced at a rate, so raising what a run may emit raises how
 * long it takes, and two constants elsewhere were sized for the old figure:
 * the Workflow's `generate` timeout and `budget.ts`'s reclaim window. The
 * second is the expensive one. Reclaiming a reservation bills it at its full
 * worst case and makes the real settlement a no-op, so a run reclaimed while
 * still alive charges its caller for output it never produced.
 *
 * Nothing in the type system ties these three together. This does.
 */

describe('how long one run is allowed to take', () => {
  it('gives a run longer to finish than the budget it was sized for', () => {
    // A ceiling sized against a measured rate is met by a run at that rate.
    // A real run can be slower, and being slower than average is not a
    // failure, so the timeout leaves room for it.
    assert.ok(
      RUN_STEP_TIMEOUT_MS >= RUN_WALL_CLOCK_BUDGET_MS,
      `a run is sized for ${RUN_WALL_CLOCK_BUDGET_MS}ms but killed at ${RUN_STEP_TIMEOUT_MS}ms`,
    );
  });

  it('never reclaims a reservation the Workflow has not given up on', () => {
    // The one that costs money. `UserBudget.reserve` reclaims anything older
    // than this at `actual = reserved`, and `settle` only writes where
    // `settled IS NULL`, so a live run passing this line is billed its whole
    // worst case no matter what it actually used.
    assert.ok(
      RUN_ABANDONED_AFTER_MS > RUN_STEP_TIMEOUT_MS,
      `a run still running at ${RUN_STEP_TIMEOUT_MS}ms is billed in full at ${RUN_ABANDONED_AFTER_MS}ms`,
    );
  });

  it('asks no model for more than it can produce in the time allowed', () => {
    // Walked over the catalogue, because the way this breaks is a faster or
    // cheaper model arriving whose ceiling the clock, not the money, decides.
    const seconds = RUN_WALL_CLOCK_BUDGET_MS / 1000;
    for (const model of MODEL_CATALOGUE) {
      const ceiling = maxTokensFor(model.id);
      const needed = ceiling / MEASURED_OUTPUT_TOKENS_PER_SECOND;
      assert.ok(
        needed <= seconds,
        `${model.id}: ${ceiling} tokens needs ${Math.round(needed)}s of a ${seconds}s budget`,
      );
    }
  });

  it('still finishes inside the timeout at half the measured rate', () => {
    // The margin stated as the property it buys, rather than left as a
    // factor in the source that a later edit could quietly shrink.
    const halfRate = MEASURED_OUTPUT_TOKENS_PER_SECOND / 2;
    for (const model of MODEL_CATALOGUE) {
      const needed = (maxTokensFor(model.id) / halfRate) * 1000;
      assert.ok(
        needed <= RUN_STEP_TIMEOUT_MS,
        `${model.id}: a run at half speed needs ${Math.round(needed)}ms of ${RUN_STEP_TIMEOUT_MS}ms`,
      );
    }
  });

  it('did not buy the guarantee by making every run tiny', () => {
    // The clamp has to leave production meaningfully better off than the
    // flat 64000 that truncated a real site, or it has undone the fix it is
    // protecting.
    assert.ok(
      maxTokensFor('deepseek-flash') > 64000 * 3,
      `production's ceiling fell back to ${maxTokensFor('deepseek-flash')}`,
    );
  });
});
