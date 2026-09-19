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

/**
 * A ledger that answers however the test says, and records what it was
 * asked. A key staged as `'reject'` rather than a verdict stands for the
 * Durable Object being unreachable: it throws instead of denying, which is
 * a different thing and costs the same hold.
 */
function ledgerThat(
  answers: Record<string, Reservation | 'reject'>,
  nextId = 100,
  /** How many settle calls reject before one is allowed through. */
  settleRejects = 0,
  /** Settle calls that never answer at all, as against rejecting. */
  settleStalls = 0,
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
            if (answer === 'reject') {
              throw new Error(`${key} is unreachable`);
            }
            return answer.verdict.allow ? { ...answer, id: (id += 1) } : answer;
          },
          async settle(reservationId: number, actual: number) {
            settles.push({ key, id: reservationId, actual });
            if (settles.length <= settleStalls) {
              // A Durable Object that is restarting: the call is accepted
              // and never answered, which is what a rejection is not.
              return new Promise<void>(() => {});
            }
            if (settles.length <= settleRejects + settleStalls) {
              throw new Error(`${key} could not settle`);
            }
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

/**
 * Passed wherever a release can be retried, so the suite does not spend the
 * real back-off. The delays themselves are `retry.test.ts`'s subject.
 */
const noWait = async () => {};

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

/**
 * That an account hold is never left behind (#196 review).
 *
 * The account layer's ceiling is the deployment's, not one caller's (L29),
 * so a hold abandoned here is not that caller's problem: the reclaim
 * charges it in full against the day everybody shares. A user ledger that
 * keeps rejecting would spend the whole deployment's daily ceiling on runs
 * that never went out, and refuse everybody else.
 */
describe('when a later layer cannot answer at all', () => {
  it('releases the account hold before the error escapes', async () => {
    const { env, settles } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: 'reject',
    });
    await assert.rejects(() =>
      reserveBudget(env, 'user_1', 1_000, 5_000, 0, NOW, noWait),
    );
    assert.deepEqual(
      settles.map((call) => ({ key: call.key, actual: call.actual })),
      [{ key: ACCOUNT_BUDGET_KEY, actual: 0 }],
      'the account hold was left for the reclaim to charge in full',
    );
  });

  it('releases it when the top-up ledger is the one that cannot answer', async () => {
    // The second place this can happen, and it was the one with no release
    // at all on any path: by here the account layer has allowed and the
    // monthly allowance is exhausted.
    const { env, settles } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: OVER,
      [topupKeyFor('user_1')]: 'reject',
    });
    await assert.rejects(() =>
      reserveBudget(env, 'user_1', 1_000, 5_000, 900, NOW, noWait),
    );
    assert.deepEqual(
      settles.map((call) => call.key),
      [ACCOUNT_BUDGET_KEY],
    );
  });

  it('still reports the ledger failure rather than a release failure', async () => {
    // The release goes to the same ledger that just rejected. If its own
    // failure replaced the original, the error would name the cleanup
    // instead of the cause, and nothing would say which ledger was down.
    const { env } = ledgerThat({
      [ACCOUNT_BUDGET_KEY]: ALLOW,
      user_1: 'reject',
    });
    const settleless = {
      USER_BUDGET: {
        getByName(key: string) {
          const real = env.USER_BUDGET!.getByName(key);
          return {
            reserve: real.reserve.bind(real),
            settle: async () => {
              throw new Error('the release failed too');
            },
          };
        },
      } as unknown as ReserveEnv['USER_BUDGET'],
    };
    await assert.rejects(
      () => reserveBudget(settleless, 'user_1', 1_000, 5_000, 0, NOW, noWait),
      /user_1 is unreachable/,
    );
  });
});

/**
 * That the release is asked for more than once (#196 review).
 *
 * The first version of this fix protected the shared ceiling only when the
 * cleanup worked first time, which is the case it was least needed in: what
 * takes the user ledger down is a Durable Object restarting, and the
 * account object can be restarting alongside it.
 */
describe('releasing an account hold that does not want to be released', () => {
  it('asks again when the release itself rejects', async () => {
    const { env, settles } = ledgerThat(
      { [ACCOUNT_BUDGET_KEY]: ALLOW, user_1: 'reject' },
      100,
      1,
    );
    await assert.rejects(() =>
      reserveBudget(env, 'user_1', 1_000, 5_000, 0, NOW, noWait),
    );
    assert.equal(
      settles.length,
      2,
      'one refused release left the hold for the reclaim to charge',
    );
    assert.deepEqual(
      settles.map((call) => call.key),
      [ACCOUNT_BUDGET_KEY, ACCOUNT_BUDGET_KEY],
    );
  });

  it('asks again when the release never answers at all', async () => {
    // #196 review. `retrying` runs one attempt and then the next, so a
    // release that stays pending is the end of the sequence rather than a
    // slow start to it: `guard` never rethrows, and `handlePlan` calls
    // this with no deadline of its own, so the request hangs instead of
    // answering 503 while the hold it is trying to give back is still
    // held against a ceiling the whole deployment shares.
    //
    // Pending, not rejecting, because that is the case the retry exists
    // for: what takes a Durable Object down is usually a restart, and a
    // restarting object accepts the call and never answers it.
    const { env, settles } = ledgerThat(
      { [ACCOUNT_BUDGET_KEY]: ALLOW, user_1: 'reject' },
      100,
      0,
      1,
    );
    const started = Date.now();
    await assert.rejects(
      () => reserveBudget(env, 'user_1', 1_000, 5_000, 0, NOW, noWait, 20),
      /user_1 is unreachable/,
      'the release replaced the error that started all this',
    );
    assert.equal(settles.length, 2, 'a pending release ended the sequence');
    assert.ok(
      Date.now() - started < 5_000,
      'the caller waited out an attempt that was never going to answer',
    );
  });

  it('gives up rather than failing, and still reports the ledger', async () => {
    // Bounded on purpose. A release that will not happen is money the
    // reclaim charges either way, and the error worth reading is the one
    // that started it.
    const { env, settles } = ledgerThat(
      { [ACCOUNT_BUDGET_KEY]: ALLOW, user_1: 'reject' },
      100,
      99,
    );
    await assert.rejects(
      () => reserveBudget(env, 'user_1', 1_000, 5_000, 0, NOW, noWait),
      /user_1 is unreachable/,
    );
    assert.ok(settles.length > 1, 'the release was not retried at all');
  });
});

/**
 * That a denial gives the account hold back too (#196 review).
 *
 * A denial is the commonest way this function ends and it leaves exactly
 * the same hold behind as a rejection does, so the retry belonged on both
 * paths. The bare release was also worse here in a way it never was on the
 * rejection path: a cleanup failure turned a clean "over your allowance"
 * into a thrown exception, so the caller got an error instead of the answer
 * the ledger had already given.
 */
describe('releasing the account hold when a later layer says no', () => {
  it('asks again when the release rejects on a denial', async () => {
    const { env, settles } = ledgerThat(
      { [ACCOUNT_BUDGET_KEY]: ALLOW, user_1: BUSY },
      100,
      1,
    );
    const outcome = await reserveBudget(
      env,
      'user_1',
      1_000,
      5_000,
      0,
      NOW,
      noWait,
    );
    assert.equal(outcome.ok, false);
    assert.equal(
      settles.length,
      2,
      'one refused release left the hold for the reclaim to charge',
    );
  });

  it('still answers with the denial when the release cannot happen', async () => {
    // The caller asked whether they may spend. The ledger said no, and that
    // is the answer, however badly the cleanup after it went.
    const { env } = ledgerThat(
      { [ACCOUNT_BUDGET_KEY]: ALLOW, user_1: BUSY },
      100,
      99,
    );
    const outcome = await reserveBudget(
      env,
      'user_1',
      1_000,
      5_000,
      0,
      NOW,
      noWait,
    );
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.verdict.reason, 'too-many-in-flight');
  });

  it('does the same after a top-up denial', async () => {
    // The second denial path, which had its own bare release.
    const { env, settles } = ledgerThat(
      {
        [ACCOUNT_BUDGET_KEY]: ALLOW,
        user_1: OVER,
        [topupKeyFor('user_1')]: OVER,
      },
      100,
      1,
    );
    const outcome = await reserveBudget(
      env,
      'user_1',
      1_000,
      5_000,
      900,
      NOW,
      noWait,
    );
    assert.equal(outcome.ok, false);
    assert.equal(settles.length, 2, 'the top-up denial released only once');
  });
});
