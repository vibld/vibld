import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RUN_ABANDONED_AFTER_MS } from '@vibld/ai';

import { UserBudget } from '../worker/budget.ts';
import {
  DEFAULT_FREE_DAILY_MICRO_USD,
  FREE_POOL,
  refusalFor,
  reserveBudget,
  topupKeyFor,
  type ReserveEnv,
} from '../worker/reserve.ts';
import { allowancePeriodKey } from '../worker/entitlement.ts';
import { ACCOUNT_BUDGET_KEY, dayKey } from '../worker/spend.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * D158 (Chris, 2026-10-05): the Free plan gets its own share of the
 * deployment's day, about $10 of the $80, so free use can never pause a
 * paying account. Asserted against real ledgers rather than staged answers:
 * the property is about what the rows add up to.
 */

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const DAY = dayKey(NOW);
const allowanceKey = allowancePeriodKey(NOW);
const noWait = async () => {};

/** One real `UserBudget` per key, the way `getByName` gives them out. */
function ledgers(env: Partial<ReserveEnv> = {}) {
  const objects = new Map<string, UserBudget>();
  const of = (key: string) => {
    let object = objects.get(key);
    if (!object) {
      object = new UserBudget(fakeDurableObjectCtx(), {});
      objects.set(key, object);
    }
    return object;
  };
  return {
    of,
    env: {
      ...env,
      USER_BUDGET: { getByName: of } as unknown as ReserveEnv['USER_BUDGET'],
    } as ReserveEnv,
  };
}

const reserve = (
  env: ReserveEnv,
  userId: string,
  amount: number,
  freePool: boolean,
  topup = 0,
) =>
  reserveBudget(
    env,
    userId,
    amount,
    100_000_000,
    topup,
    NOW,
    noWait,
    undefined,
    { freePool },
  );

describe('the Free share of the day (D158)', () => {
  it('defaults to $10 of the $80', () => {
    assert.equal(DEFAULT_FREE_DAILY_MICRO_USD, 10_000_000);
  });

  it('refuses a Free run once the Free share is spent', async () => {
    const { env } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    const first = await reserve(env, 'free_a', 600, true);
    assert.equal(first.ok, true);
    const second = await reserve(env, 'free_b', 600, true);
    assert.equal(second.ok, false);
    assert.deepEqual(!second.ok && second.ceiling, { layer: 'free-pool' });
  });

  it('still admits a paid run when the Free share is spent', async () => {
    const { env } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    assert.equal((await reserve(env, 'free_a', 1000, true)).ok, true);
    assert.equal((await reserve(env, 'paid_a', 5000, false)).ok, true);
  });

  it('counts Free runs against the whole day too', async () => {
    const { env } = ledgers({
      VIBLD_ACCOUNT_DAILY_MICRO_USD: '2000',
      VIBLD_FREE_DAILY_MICRO_USD: '1500',
    });
    assert.equal((await reserve(env, 'paid_a', 1500, false)).ok, true);
    const free = await reserve(env, 'free_a', 1000, true);
    assert.equal(free.ok, false);
    assert.deepEqual(!free.ok && free.ceiling, { layer: 'account' });
  });

  it('settles a Free run down to what it cost, freeing the share', async () => {
    const { env, of } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    const first = await reserve(env, 'free_a', 1000, true);
    assert.ok(first.ok && first.layers.account.id !== undefined);
    of(ACCOUNT_BUDGET_KEY).settle(first.layers.account.id, 100);
    assert.equal((await reserve(env, 'free_b', 900, true)).ok, true);
  });

  it('takes a run paid from top-up credit out of the Free share', async () => {
    const { env } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    // An allowance already spent, so the run draws on its top-up.
    const spentAllowance = await reserveBudget(
      env,
      'free_a',
      1000,
      0,
      5000,
      NOW,
      noWait,
      undefined,
      { freePool: true },
    );
    assert.ok(spentAllowance.ok);
    assert.equal(
      spentAllowance.layers.userReservationKey,
      topupKeyFor('free_a'),
    );
    assert.equal((await reserve(env, 'free_b', 1000, true)).ok, true);
  });

  it('lets a Free account with top-up credit past a spent share, on that credit', async () => {
    const { env, of } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    assert.equal((await reserve(env, 'free_a', 1000, true)).ok, true);
    const paid = await reserve(env, 'free_b', 500, true, 5000);
    assert.ok(paid.ok);
    assert.equal(paid.layers.userReservationKey, topupKeyFor('free_b'));
    // Its monthly allowance is the Free plan's and stays untouched.
    assert.equal(of('free_b').usageFor(allowanceKey).spentMicroUsd, 0);
    // And it is outside the share, which still refuses a Free run.
    assert.equal((await reserve(env, 'free_c', 1, true)).ok, false);
  });

  it('holds top-up runs past a spent share to the in-flight limit', async () => {
    const { env } = ledgers({
      VIBLD_FREE_DAILY_MICRO_USD: '1000',
      VIBLD_MAX_IN_FLIGHT: '2',
    });
    await reserve(env, 'free_a', 1000, true);
    assert.equal((await reserve(env, 'free_b', 10, true, 5000)).ok, true);
    assert.equal((await reserve(env, 'free_b', 10, true, 5000)).ok, true);
    const third = await reserve(env, 'free_b', 10, true, 5000);
    assert.equal(third.ok, false);
    assert.equal(
      !third.ok && !third.verdict.allow && third.verdict.reason,
      'too-many-in-flight',
    );
  });

  it('says whether the run itself is in the Free share', async () => {
    const { env } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    const inShare = await reserve(env, 'free_a', 500, true);
    assert.ok(inShare.ok);
    assert.equal(inShare.layers.freePool, true);
    const onCredit = await reserveBudget(
      env,
      'free_b',
      500,
      0,
      5000,
      NOW,
      noWait,
      undefined,
      { freePool: true },
    );
    assert.ok(onCredit.ok);
    assert.equal(onCredit.layers.freePool, undefined);
    const paid = await reserve(env, 'paid_a', 500, false);
    assert.ok(paid.ok);
    assert.equal(paid.layers.freePool, undefined);
  });

  it('still refuses a Free account whose top-up credit is too small', async () => {
    const { env } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    await reserve(env, 'free_a', 1000, true);
    const denied = await reserve(env, 'free_b', 500, true, 100);
    assert.ok(!denied.ok);
    assert.deepEqual(!denied.ok && denied.ceiling, {
      layer: 'user',
      allowanceLeftMicroUsd: 0,
      topupLeftMicroUsd: 100,
    });
  });

  it('a refused Free run leaves nothing held against the day', async () => {
    const { env, of } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    await reserve(env, 'free_a', 1000, true);
    await reserve(env, 'free_b', 500, true);
    assert.equal(of(ACCOUNT_BUDGET_KEY).usageFor(DAY).spentMicroUsd, 1000);
  });

  it('says which share refused, and that paid plans are not paused', async () => {
    const { env } = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    await reserve(env, 'free_a', 1000, true);
    const denied = await reserve(env, 'free_b', 1, true);
    assert.ok(!denied.ok);
    const { error } = refusalFor(denied, 'This build', 1);
    assert.match(error, /Free builds have reached their limit for today/);
    assert.match(error, /paid plan or a top-up/);
  });
});

describe('runs paid from top-up credit', () => {
  it('are held to the in-flight limit, as allowance runs are', async () => {
    const { env } = ledgers({ VIBLD_MAX_IN_FLIGHT: '2' });
    const topupRun = () =>
      reserveBudget(env, 'paid_a', 10, 0, 5000, NOW, noWait, undefined);
    assert.equal((await topupRun()).ok, true);
    assert.equal((await topupRun()).ok, true);
    assert.equal((await topupRun()).ok, false);
  });

  it('count against the same limit as allowance runs, across both ledgers', async () => {
    const { env } = ledgers({ VIBLD_MAX_IN_FLIGHT: '2' });
    const run = (allowance: number) =>
      reserveBudget(env, 'paid_a', 10, allowance, 5000, NOW, noWait, undefined);
    // One run on top-up credit, one on the allowance: the limit is reached.
    assert.equal((await run(0)).ok, true);
    assert.equal((await run(1000)).ok, true);
    // A third, by either route, is one too many.
    assert.equal((await run(1000)).ok, false);
    assert.equal((await run(0)).ok, false);
  });

  it('stops counting a dead top-up run once the reclaim window passes', async () => {
    const { env } = ledgers({ VIBLD_MAX_IN_FLIGHT: '1' });
    const run = (allowance: number) =>
      reserveBudget(env, 'paid_a', 10, allowance, 5000, NOW, noWait, undefined);
    // A top-up run that never comes back to settle.
    assert.equal((await run(0)).ok, true);
    assert.equal((await run(1000)).ok, false);
    const clock = Date.now;
    Date.now = () => clock() + RUN_ABANDONED_AFTER_MS + 1000;
    try {
      // Nothing has reserved in the top-up ledger since; reading its count
      // reclaims the dead row all the same.
      assert.equal((await run(1000)).ok, true);
    } finally {
      Date.now = clock;
    }
  });

  it('gives both holds back when the other ledger never answers', async () => {
    const real = ledgers({ VIBLD_MAX_IN_FLIGHT: '2' });
    const stalled = {
      ...real.env,
      USER_BUDGET: {
        getByName: (key: string) => {
          const object = real.of(key);
          if (key !== topupKeyFor('paid_a')) return object;
          return new Proxy(object, {
            get: (target, name) =>
              name === 'inFlightFor'
                ? () => new Promise(() => {})
                : Reflect.get(target, name, target),
          });
        },
      } as unknown as ReserveEnv['USER_BUDGET'],
    } as ReserveEnv;
    await assert.rejects(
      reserveBudget(stalled, 'paid_a', 10, 1000, 5000, NOW, noWait, 5),
    );
    assert.equal(real.of('paid_a').usageFor(allowanceKey).inFlight, 0);
    assert.equal(real.of(ACCOUNT_BUDGET_KEY).usageFor(DAY).inFlight, 0);
  });

  it('ends the request when the account ledger never answers', async () => {
    const real = ledgers({ VIBLD_FREE_DAILY_MICRO_USD: '1000' });
    await reserve(real.env, 'free_a', 1000, true);
    let calls = 0;
    const stalled = {
      ...real.env,
      USER_BUDGET: {
        getByName: (key: string) => {
          const object = real.of(key);
          if (key !== ACCOUNT_BUDGET_KEY) return object;
          return new Proxy(object, {
            get: (target, name) =>
              name === 'reserve'
                ? (...args: Parameters<UserBudget['reserve']>) => {
                    calls += 1;
                    // The pool-bypass reservation, the second ask, stalls.
                    return calls === 1
                      ? target.reserve(...args)
                      : new Promise(() => {});
                  }
                : Reflect.get(target, name, target),
          });
        },
      } as unknown as ReserveEnv['USER_BUDGET'],
    } as ReserveEnv;
    await assert.rejects(
      reserveBudget(stalled, 'free_b', 500, 0, 5000, NOW, noWait, 5, {
        freePool: true,
      }),
    );
    assert.equal(calls, 2);
  });

  it('never admits more than the limit when the two routes race', async () => {
    const { env, of } = ledgers({ VIBLD_MAX_IN_FLIGHT: '2' });
    const run = (allowance: number) =>
      reserveBudget(env, 'paid_a', 10, allowance, 5000, NOW, noWait, undefined);
    const outcomes = await Promise.all([run(0), run(1000), run(0), run(1000)]);
    assert.ok(outcomes.filter((o) => o.ok).length <= 2);
    const running =
      of('paid_a').usageFor(allowanceKey).inFlight +
      of(topupKeyFor('paid_a')).usageFor('lifetime').inFlight;
    assert.ok(running <= 2, `${running} runs in flight`);
  });
});

describe('the ledger the Free share lives in', () => {
  it('adds the pool column to a ledger made before it', () => {
    const ctx = fakeDurableObjectCtx();
    ctx.storage.sql.exec(`
      CREATE TABLE runs (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        day      TEXT    NOT NULL,
        started  INTEGER NOT NULL,
        settled  INTEGER,
        reserved INTEGER NOT NULL,
        actual   INTEGER
      )
    `);
    ctx.storage.sql.exec(
      `INSERT INTO runs (day, started, reserved) VALUES (?, ?, ?)`,
      DAY,
      Date.now(),
      700,
    );
    const budget = new UserBudget(ctx, {});
    // An old row counts against the day and belongs to no pool.
    const pool = { name: FREE_POOL, ceilingMicroUsd: 1000 };
    assert.equal(budget.reserve(1000, 1700, 10, DAY, pool).verdict.allow, true);
    assert.equal(budget.reserve(1, 1700, 10, DAY).verdict.allow, false);
  });

  it('asks a ledger with no pool exactly what it always did', () => {
    const budget = new UserBudget(fakeDurableObjectCtx(), {});
    assert.equal(budget.reserve(500, 1000, 10, DAY).verdict.allow, true);
    assert.equal(budget.reserve(500, 1000, 10, DAY).verdict.allow, true);
    assert.equal(budget.reserve(1, 1000, 10, DAY).verdict.allow, false);
  });
});
