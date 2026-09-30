import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GROUP_MAX_TOKENS,
  OUTLINE_MAX_TOKENS,
  callCeilingFor,
} from '@vibld/ai';

import { UserBudget } from '../worker/budget.ts';
import { DEFAULT_FREE_INCLUDED_MICRO_USD } from '../worker/entitlement.ts';
import { refusalFor, reserveBudget } from '../worker/reserve.ts';
import type { ReserveEnv } from '../worker/reserve.ts';
import {
  BOUNDED_BUILD_INPUT_CHARS,
  BUILD_INPUT_CHARS,
  buildFloorSize,
  fitBuildToCaller,
  fittedBuildSize,
  runCeilingFor,
  sizedReservation,
} from '../worker/run-ceiling.ts';
import type { BuildSize } from '../worker/run-ceiling.ts';
import { ACCOUNT_BUDGET_KEY, worstCaseMicroUsd } from '../worker/spend.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * A build sized to what the caller has left (docs/decisions.md, "Resolved
 * 2026-09-29", D59).
 *
 * Internal PR 292 made a build reserve for every call it may make, about $3.20 on
 * GPT-6 Sol, the default model. A Free account has a dollar a month, so it
 * was refused the default model with its whole dollar unspent, and told
 * its budget was used up. These run the real ledger, the real layering and
 * the real sizing `handlePlan` uses, end to end, in the order `handlePlan`
 * calls them.
 */

const SOL = 'gpt-6-sol';
const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);

/** `USER_BUDGET` as real `UserBudget` objects over SQLite, one per key. */
function ledgers() {
  const objects = new Map<string, UserBudget>();
  const namespace = {
    getByName(key: string) {
      let object = objects.get(key);
      if (!object) {
        object = new UserBudget(fakeDurableObjectCtx(), {});
        objects.set(key, object);
      }
      return object;
    },
  };
  return {
    objects,
    env: {
      USER_BUDGET: namespace as unknown as ReserveEnv['USER_BUDGET'],
    } satisfies ReserveEnv,
  };
}

/** `handlePlan`'s own `sizeFor`, for a first build. */
const sizeFor = (): BuildSize => {
  const ceiling = runCeilingFor({}, SOL, 'build');
  return {
    ceiling,
    inputChars: BOUNDED_BUILD_INPUT_CHARS,
    worstCase: worstCaseMicroUsd(
      ceiling.prices,
      ceiling.maxTokens,
      BOUNDED_BUILD_INPUT_CHARS,
    ),
  };
};

/** Reserve as `handlePlan` does, for a caller with `allowance` a month. */
async function reserveAsHandlePlan(
  env: ReserveEnv,
  allowance: number,
  topup = 0,
) {
  const asked: number[] = [];
  const sized = await sizedReservation(
    0,
    sizeFor,
    (amount) => {
      asked.push(amount);
      return reserveBudget(env, 'user_free', amount, allowance, topup, NOW);
    },
    fitBuildToCaller(SOL),
  );
  return { sized, asked };
}

describe('a Free account on the default model', () => {
  it('is refused the whole run and admitted to a smaller one', async () => {
    const full = sizeFor();
    assert.ok(
      full.worstCase > DEFAULT_FREE_INCLUDED_MICRO_USD,
      'the whole run fits in a dollar now; this test proves nothing',
    );

    const { env, objects } = ledgers();
    const { sized, asked } = await reserveAsHandlePlan(
      env,
      DEFAULT_FREE_INCLUDED_MICRO_USD,
    );

    assert.equal(sized.reserved.ok, true, 'a dollar still cannot build');
    assert.deepEqual(asked, [full.worstCase, sized.worstCase]);
    assert.ok(sized.worstCase <= DEFAULT_FREE_INCLUDED_MICRO_USD);
    // What was actually held is what the run was sized at, and nothing is
    // left open from the refused attempt at the whole run.
    assert.equal(
      objects.get('user_free')!.usageFor('2026-09').spentMicroUsd,
      sized.worstCase,
    );
    assert.equal(
      objects.get(ACCOUNT_BUDGET_KEY)!.usageFor('2026-09-29').spentMicroUsd,
      sized.worstCase,
      'the refused whole-run hold was left on the daily ceiling',
    );
  });

  it('runs on the smaller budgets it was reserved for, never the full ones', async () => {
    const full = sizeFor();
    const { env } = ledgers();
    const { sized } = await reserveAsHandlePlan(
      env,
      DEFAULT_FREE_INCLUDED_MICRO_USD,
    );

    // These are the two figures `handlePlan` hands the Workflow
    // (`maxTokens` and `maxInputChars`), and the run refuses any call that
    // would pass either.
    assert.ok(sized.ceiling.maxTokens < full.ceiling.maxTokens);
    assert.ok(sized.inputChars < full.inputChars);
    assert.equal(
      worstCaseMicroUsd(
        sized.ceiling.prices,
        sized.ceiling.maxTokens,
        sized.inputChars,
      ),
      sized.worstCase,
      'the budgets the run is told cost more than was reserved',
    );
    // Room for the outline and one group of files, at least.
    assert.ok(
      sized.ceiling.maxTokens >=
        callCeilingFor(SOL, OUTLINE_MAX_TOKENS) +
          callCeilingFor(SOL, GROUP_MAX_TOKENS),
    );
    assert.ok(sized.inputChars >= 2 * BUILD_INPUT_CHARS);
  });

  it('is refused below the floor, and told how much is left and needed', async () => {
    const full = sizeFor();
    const floor = buildFloorSize(full, SOL);
    const { env, objects } = ledgers();
    // Earlier runs this month leave one micro-dollar less than the floor.
    const spent = DEFAULT_FREE_INCLUDED_MICRO_USD - (floor.worstCase - 1);
    const own = env.USER_BUDGET!.getByName('user_free');
    const { id } = await own.reserve(spent, 10_000_000, 4, '2026-09');
    await own.settle(id!, spent);
    assert.ok(objects.has('user_free'));

    const { sized, asked } = await reserveAsHandlePlan(
      env,
      DEFAULT_FREE_INCLUDED_MICRO_USD,
    );
    assert.equal(sized.reserved.ok, false);
    assert.deepEqual(asked, [full.worstCase], 'asked for less than the floor');
    assert.ok(!sized.reserved.ok);

    const refusal = refusalFor(
      sized.reserved,
      'A build on this model',
      floor.worstCase,
    );
    assert.equal(refusal.reason, 'account-ceiling');
    assert.doesNotMatch(refusal.error, /used up/);
    assert.match(refusal.error, /this month's allowance has \$0\.85 left/);
    assert.match(refusal.error, /needs at least \$0\.86 set aside/);
    assert.match(refusal.error, /cheaper model/);
    assert.match(refusal.error, /top-up/);
  });

  it('is fitted to top-up credit when that is the larger of the two', async () => {
    const { env, objects } = ledgers();
    const { sized } = await reserveAsHandlePlan(env, 0, 2_000_000);
    assert.equal(sized.reserved.ok, true);
    assert.ok(sized.reserved.ok);
    assert.equal(sized.reserved.layers.userReservationKey, 'user_free:topup');
    assert.ok(sized.worstCase <= 2_000_000);
    assert.equal(
      objects.get('user_free:topup')!.usageFor('lifetime').spentMicroUsd,
      sized.worstCase,
    );
  });
});

describe('the daily ceiling of the whole deployment', () => {
  it('is not squeezed under, and is not described as the caller running out', async () => {
    const { env } = ledgers();
    const { sized, asked } = await reserveAsHandlePlan(
      { ...env, VIBLD_ACCOUNT_DAILY_MICRO_USD: '1500000' },
      50_000_000,
    );
    assert.equal(sized.reserved.ok, false);
    assert.equal(asked.length, 1, 'fitted a smaller run under the platform');
    assert.ok(!sized.reserved.ok);
    assert.deepEqual(sized.reserved.ceiling, { layer: 'account' });

    const refusal = refusalFor(sized.reserved, 'A build on this model', 1);
    assert.equal(refusal.reason, 'account-ceiling');
    assert.match(refusal.error, /spending limit for today/);
    assert.match(refusal.error, /midnight UTC/);
    assert.doesNotMatch(refusal.error, /allowance has/);
  });
});

describe('the size a build is fitted to', () => {
  it('never reserves more than the caller has left', () => {
    const full = sizeFor();
    const floor = buildFloorSize(full, SOL);
    for (
      let available = floor.worstCase;
      available < full.worstCase;
      available += 37_931
    ) {
      const fitted = fittedBuildSize(full, SOL, available);
      assert.ok(fitted, `refused ${available}, above the floor`);
      assert.ok(fitted.worstCase <= available, `${available} overspent`);
      assert.ok(fitted.ceiling.maxTokens >= floor.ceiling.maxTokens);
      assert.ok(fitted.inputChars >= floor.inputChars);
      assert.ok(fitted.ceiling.maxTokens <= full.ceiling.maxTokens);
      assert.ok(fitted.inputChars <= full.inputChars);
    }
  });

  it('is nothing below the floor, and the whole run with enough', () => {
    const full = sizeFor();
    const floor = buildFloorSize(full, SOL);
    assert.equal(fittedBuildSize(full, SOL, floor.worstCase - 1), undefined);
    assert.equal(fittedBuildSize(full, SOL, full.worstCase), full);
  });

  it('has a floor of one outline and one group, from the ceilings each call is held to', () => {
    const full = sizeFor();
    const floor = buildFloorSize(full, SOL);
    assert.equal(
      floor.ceiling.maxTokens,
      callCeilingFor(SOL, OUTLINE_MAX_TOKENS) +
        callCeilingFor(SOL, GROUP_MAX_TOKENS),
    );
    assert.equal(floor.inputChars, 2 * BUILD_INPUT_CHARS);
    // Under a Free account's dollar on the default model, or the fallback
    // helps nobody it was written for.
    assert.ok(floor.worstCase < DEFAULT_FREE_INCLUDED_MICRO_USD);
  });
});
