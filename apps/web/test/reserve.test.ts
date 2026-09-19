import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  reserveBudget,
  topupKeyFor,
  type ReserveEnv,
} from '../worker/reserve.ts';
import { ACCOUNT_BUDGET_KEY } from '../worker/spend.ts';
import type { Reservation } from '../worker/budget.ts';

/**
 * The spend ceilings, asserted against the code that enforces them.
 *
 * They never have been. `reserveBudget` lived in `index.ts`, which imports
 * `cloudflare:workers` and cannot be loaded under `node --test`, so every
 * assertion about these three layers has been made one layer away: against
 * `spend.ts`'s pure `decide`, which knows nothing about layering, or against
 * a source read. The ordering between the layers, and what happens when a
 * later one refuses after an earlier one has already allowed, were the parts
 * no test could reach, and they are the parts where money leaks.
 *
 * Extracted for #194, which needs a second caller: a repair turn has to hold
 * a reservation of its own before it goes out.
 */

interface Call {
  key: string;
  worstCase: number;
  ceiling: number;
  maxInFlight: number;
  period: string;
}

/** A ledger that answers however the test says, and records what it was asked. */
function ledgerThat(
  answers: Record<string, Reservation>,
  nextId = 100,
): {
  env: ReserveEnv;
  reserves: Call[];
  settles: { key: string; id: number; actual: number }[];
} {
  const reserves: Call[] = [];
  const settles: { key: string; id: number; actual: number }[] = [];
  let id = nextId;
  const env: ReserveEnv = {
    USER_BUDGET: {
      getByName(key: string) {
        return {
          async reserve(
            worstCase: number,
            ceiling: number,
            maxInFlight: number,
            period: string,
          ): Promise<Reservation> {
            reserves.push({ key, worstCase, ceiling, maxInFlight, period });
            const answer = answers[key];
            assert.ok(answer, `no answer staged for ${key}`);
            return answer.verdict.allow ? { ...answer, id: (id += 1) } : answer;
          },
          async settle(reservationId: number, actual: number) {
            settles.push({ key, id: reservationId, actual });
          },
        };
      },
      // The rest of DurableObjectNamespace is not reached by this function.
    } as unknown as ReserveEnv['USER_BUDGET'],
  };
  return { env, reserves, settles };
}

const ALLOW: Reservation = { verdict: { allow: true }, spentMicroUsd: 0 };
const OVER: Reservation = {
  verdict: { allow: false, reason: 'period-ceiling' },
  spentMicroUsd: 0,
};
const BUSY: Reservation = {
  verdict: { allow: false, reason: 'too-many-in-flight' },
  spentMicroUsd: 0,
};

const NOW = Date.UTC(2026, 8, 19, 4, 0, 0);

describe('what a run has to get past before it may start', () => {
  it('asks the account ceiling before touching anything else', () => {
    // Cheapest to check, and failing it means nothing else needs asking.
    const { env, reserves } = ledgerThat({ [ACCOUNT_BUDGET_KEY]: OVER });
    return reserveBudget(env, 'user_1', 1_000, 5_000, 0, NOW).then(
      (outcome) => {
        assert.equal(outcome.ok, false);
        assert.deepEqual(
          reserves.map((call) => call.key),
          [ACCOUNT_BUDGET_KEY],
          'a refused account ceiling still went on to spend the user ledger',
        );
      },
    );
  });

  it('releases the account hold when the user layer refuses', async () => {
    // The case that leaks money silently. An allowed account hold followed
    // by a refused user layer leaves a phantom charge sitting against the
    // deployment's daily ceiling for as long as the abandoned-reservation
    // reclaim takes, for a run that never started.
    const { env, settles } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: BUSY,
    });
    const outcome = await reserveBudget(env, 'user_1', 1_000, 5_000, 0, NOW);
    assert.equal(outcome.ok, false);
    assert.deepEqual(settles, [
      { key: ACCOUNT_BUDGET_KEY, id: 101, actual: 0 },
    ]);
  });

  it('falls through to top-up credit only once the allowance is spent', async () => {
    const { env, reserves } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: OVER,
      [topupKeyFor('user_1')]: ALLOW,
    });
    const outcome = await reserveBudget(env, 'user_1', 1_000, 5_000, 900, NOW);
    assert.equal(outcome.ok, true);
    assert.equal(
      outcome.ok && outcome.layers.userReservationKey,
      topupKeyFor('user_1'),
      'settlement would target the wrong ledger instance',
    );
    assert.deepEqual(
      reserves.map((call) => call.key),
      [ACCOUNT_BUDGET_KEY, 'user_1', topupKeyFor('user_1')],
    );
  });

  it('never buys more in-flight runs with top-up credit', async () => {
    // A top-up buys spend, not concurrency. Reaching for it here would let
    // somebody with credit run as many at once as they liked.
    const { env, reserves, settles } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: BUSY,
    });
    const outcome = await reserveBudget(
      env,
      'user_1',
      1_000,
      5_000,
      1_000_000,
      NOW,
    );
    assert.equal(outcome.ok, false);
    assert.equal(
      reserves.some((call) => call.key === topupKeyFor('user_1')),
      false,
      'a concurrency refusal was answered with top-up credit',
    );
    assert.equal(settles.length, 1, 'the account hold was not released');
  });

  it('reports the allowance refusal rather than the top-up one', async () => {
    // The allowance denial is what a top-up would have fixed. The top-up
    // bucket's own denial only says "also not enough", which tells the
    // caller nothing they can act on.
    const { env } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: OVER,
      [topupKeyFor('user_1')]: OVER,
    });
    const outcome = await reserveBudget(env, 'user_1', 1_000, 5_000, 900, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.verdict.reason, 'period-ceiling');
  });

  it('holds the same worst case at every layer', async () => {
    // Three ceilings asked for three different amounts would be three
    // different runs as far as the ledger is concerned.
    const { env, reserves } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: OVER,
      [topupKeyFor('user_1')]: ALLOW,
    });
    await reserveBudget(env, 'user_1', 1_610_000, 5_000, 900, NOW);
    for (const call of reserves) {
      assert.equal(call.worstCase, 1_610_000, call.key);
    }
  });
});
