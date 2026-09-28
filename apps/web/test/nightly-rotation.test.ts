import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import {
  DEFAULT_QUERY_BUDGET,
  MAX_QUERIES_PER_PAYOUT_ROW,
  MAX_QUERIES_PER_SUBSCRIPTION,
  NIGHTLY_PHASES,
  QUERIES_PER_TURN,
  ROTATING_PHASES,
  everyPhaseBuysAnItem,
  DELETION_TURN,
  deletionReserveFor,
  itemsFor,
  nightSharesFor,
  nightSharesWithDeletion,
  planNight,
  splitSurvivesDeletion,
  parkedFloorFitsFor,
  parkedReserveFor,
  payoutBatchFor,
  payoutReserveFor,
  reconcileBatchFor,
  reconcileReserveFor,
  replayBudgetFor,
  replayEventsFor,
  replayStripeEvents,
  retryBatchFor,
  splitSharesFor,
  takeNightlyTurn,
} from '../worker/billing-replay.ts';
import type {
  NightPlan,
  NightTurn,
  NightlyPhase,
} from '../worker/billing-replay.ts';
import { MIN_DELETION_SHARE } from '../worker/account-deletion.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Which phases of the nightly billing pass get to run, and on how much (internal issue 176).
 *
 * The pass split its D1 allowance a flat quarter four ways, and at the
 * default of 40 a quarter bought no payout, no subscription and no page of
 * events. The split recurred every night, so three phases never ran and
 * every night reported success. Nothing noticed, because nothing asked
 * whether a share bought anything: the per-item costs were measured upward
 * (internal PR 174) and the default was never recomputed against them. These tests are
 * the thing that notices next time.
 */
const SCHEMA = schemaSql();

/**
 * A D1 that counts what it is asked to run, because the allowance counts
 * statements and a rotation that quietly spends queries of its own is the
 * overrun this is guarding against, from a new direction.
 */
function countingStore(): { store: BillingStore; statements: () => number } {
  const inner = new SqliteD1Database(SCHEMA);
  let statements = 0;
  const counted = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (key === 'bind') {
          return (...values: unknown[]) => counted(target.bind(...values));
        }
        if (key === 'run' || key === 'first' || key === 'all') {
          return (...args: unknown[]) => {
            statements += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
  const db = {
    prepare: (query: string) => counted(inner.prepare(query)),
  } as unknown as D1Database;
  return { store: new BillingStore(db), statements: () => statements };
}

/** A Stripe that always has another full page of payments nobody delivered. */
function endlessStripe() {
  let next = 0;
  return {
    events: {
      async list(params: Stripe.EventListParams) {
        const data = Array.from({ length: params.limit ?? 1 }, () => {
          next += 1;
          return {
            id: `evt_${next}`,
            created: 1000,
            type: 'checkout.session.completed',
            data: {
              object: {
                id: `cs_${next}`,
                mode: 'payment',
                payment_status: 'paid',
                amount_total: 800,
                customer: `cus_${next}`,
                metadata: {
                  vibld_user_id: `user_${next}`,
                  vibld_credit_usd_cents: '800',
                },
              },
            },
          } as unknown as Stripe.Event;
        });
        return { data, has_more: true };
      },
    },
  };
}

/**
 * The most a phase can spend on a share, which is what the allowance has to
 * cover. The replay is run rather than worked out, because its own
 * reservation is the figure it holds itself to.
 */
async function worstCostFor(
  phase: NightlyPhase,
  share: number,
): Promise<number> {
  switch (phase) {
    case 'parked':
      // Eleven a row: the handler's worst event, the attempt stamp, then
      // the mark and the delete.
      return retryBatchFor(share) * 11;
    case 'payout':
      return 1 + payoutBatchFor(share) * MAX_QUERIES_PER_PAYOUT_ROW;
    case 'reconcile':
      return 3 + reconcileBatchFor(share) * MAX_QUERIES_PER_SUBSCRIPTION;
    case 'replay': {
      const { store } = countingStore();
      const result = await replayStripeEvents(
        endlessStripe(),
        store,
        undefined,
        () => 5000,
        share,
      );
      return result.queriesReserved;
    }
  }
}

/**
 * The most one rotating night can spend: the turn, plus the worst case of
 * every phase that is handed anything. A phase handed nothing is not called.
 */
async function worstNightFor(plan: NightPlan): Promise<number> {
  let total = QUERIES_PER_TURN;
  for (const phase of NIGHTLY_PHASES) {
    if (plan.shares[phase] > 0) {
      total += await worstCostFor(phase, plan.shares[phase]);
    }
  }
  return total;
}

describe('the nightly pass on the default allowance', () => {
  it('retries the parked queue every night', async () => {
    // Chris's choice for internal issue 176. A parked event is a payment already taken and
    // not credited, and its floor exists so that no night passes without
    // one being retried. Rotating it with the others made that one night in
    // four; it keeps its floor every night instead, over two laps so a
    // counter that wraps wrongly is caught too.
    const budget = DEFAULT_QUERY_BUDGET;
    const { store } = countingStore();
    for (let night = 0; night < ROTATING_PHASES.length * 2; night += 1) {
      const plan = await takeNightlyTurn(store, budget);
      assert.notEqual(plan, null, `night ${night} split a budget of ${budget}`);
      assert.ok(
        itemsFor('parked', plan!.shares.parked) >= 1,
        `night ${night}: the parked queue retries nothing`,
      );
    }
  });

  it('gives payout, reconcile and replay an item each within one lap of nights', async () => {
    // The test internal issue 176 asked for. The default has to stay safe on Workers
    // Free, which stops an invocation at 50 queries, so the fix is not a
    // bigger number: it is every phase getting a night on which its share
    // buys something. One lap is as many nights as there are rotating
    // phases, and each of those nights has to stay inside the default on
    // its own, the turn and the parked floor included.
    const budget = DEFAULT_QUERY_BUDGET;
    const { store, statements } = countingStore();
    const bought = new Map<NightlyPhase, number>();

    for (let night = 0; night < ROTATING_PHASES.length; night += 1) {
      const before = statements();
      const plan = await takeNightlyTurn(store, budget);
      assert.equal(statements() - before, QUERIES_PER_TURN);
      assert.notEqual(plan, null, `night ${night} split a budget of ${budget}`);

      for (const phase of NIGHTLY_PHASES) {
        const items = itemsFor(phase, plan!.shares[phase]);
        bought.set(phase, (bought.get(phase) ?? 0) + items);
      }
      const total = await worstNightFor(plan!);
      assert.ok(
        total <= budget,
        `night ${night} (${plan!.turn}) can spend ${total} of ${budget}`,
      );
    }

    for (const phase of ROTATING_PHASES) {
      assert.ok(
        (bought.get(phase) ?? 0) >= 1,
        `${phase} bought nothing in ${ROTATING_PHASES.length} nights at ${budget}`,
      );
    }
  });

  it('keeps rotating after the first lap rather than settling on one phase', async () => {
    const { store } = countingStore();
    const turns: (NightlyPhase | undefined)[] = [];
    for (let night = 0; night < ROTATING_PHASES.length * 3; night += 1) {
      turns.push((await takeNightlyTurn(store, DEFAULT_QUERY_BUDGET))?.turn);
    }
    assert.deepEqual(turns, [
      ...ROTATING_PHASES,
      ...ROTATING_PHASES,
      ...ROTATING_PHASES,
    ]);
  });

  it('counts the replay as buying what it can read, not its page size', async () => {
    // `pageSizeFor` never answers less than one, so a share too small for
    // the page reads as one event while the run reads none. That is how the
    // replay's share at the default went unnoticed: 9, a page of one, and
    // no page ever requested. `replayEventsFor` has to agree with the loop.
    for (const share of [1, 9, 11, 12, 20, 28, 39, 125, 500]) {
      const { store } = countingStore();
      const result = await replayStripeEvents(
        endlessStripe(),
        store,
        undefined,
        () => 5000,
        share,
      );
      assert.equal(result.read, replayEventsFor(share), `share ${share}`);
    }
    assert.equal(replayEventsFor(replayBudgetFor(DEFAULT_QUERY_BUDGET)), 0);
  });
});

describe('the nightly pass below the split', () => {
  it('keeps the parked floor from 35 to 91, and holds both properties there', async () => {
    // 35 is where the allowance less the floor (11) and the turn (1) first
    // covers a subscription's worst case (23). Every allowance from there to
    // the split has to retry a parked row every night, buy each rotating
    // phase an item within a lap, and stay inside itself every night.
    for (let budget = 35; budget < 92; budget += 1) {
      assert.equal(parkedFloorFitsFor(budget), true, `budget ${budget}`);
      const bought = new Map<NightlyPhase, number>();
      for (let night = 0; night < ROTATING_PHASES.length; night += 1) {
        const plan = nightSharesFor(budget, night);
        assert.ok(itemsFor('parked', plan.shares.parked) >= 1, `${budget}`);
        assert.equal(plan.shares.parked, parkedReserveFor(budget));
        bought.set(plan.turn, itemsFor(plan.turn, plan.shares[plan.turn]));
        const total = await worstNightFor(plan);
        assert.ok(total <= budget, `budget ${budget} night ${night}: ${total}`);
      }
      for (const phase of ROTATING_PHASES) {
        assert.ok((bought.get(phase) ?? 0) >= 1, `${budget}: ${phase}`);
      }
    }
  });

  it('rotates all four from 24 to 34 rather than starving the reconcile', async () => {
    // Below 35 the floor leaves less than a subscription on every night, so
    // holding it would stop the reconcile for good: Internal issue 176 again with a
    // different victim. So the parked queue joins the rotation there, and
    // each phase gets the allowance less the turn one night in four. 24 is
    // the least allowance on which that still buys every phase an item.
    for (const budget of [24, 30, 34]) {
      assert.equal(parkedFloorFitsFor(budget), false, `budget ${budget}`);
      const turns: NightlyPhase[] = [];
      for (let night = 0; night < NIGHTLY_PHASES.length; night += 1) {
        const plan = nightSharesFor(budget, night);
        turns.push(plan.turn);
        assert.deepEqual(
          NIGHTLY_PHASES.filter((phase) => plan.shares[phase] > 0),
          [plan.turn],
          `budget ${budget}: more than one phase on a night`,
        );
        assert.ok(
          itemsFor(plan.turn, plan.shares[plan.turn]) >= 1,
          `budget ${budget}: ${plan.turn} buys nothing on its night`,
        );
        const total = await worstNightFor(plan);
        assert.ok(total <= budget, `budget ${budget} night ${night}: ${total}`);
      }
      assert.deepEqual(turns, [...NIGHTLY_PHASES]);
    }
  });

  it('says plainly that below 24 no rotation can buy a subscription', async () => {
    // Stated rather than defended against: the whole allowance less the
    // turn is under a subscription's worst case, so the reconcile's turn is
    // a night off, and nothing else could do better with that allowance.
    const plan = nightSharesFor(23, 2);
    assert.equal(plan.turn, 'reconcile');
    assert.equal(itemsFor('reconcile', plan.shares.reconcile), 0);
    assert.equal(plan.shares.reconcile, 23 - QUERIES_PER_TURN);
  });
});

describe('the nightly pass on the deployed allowance', () => {
  it('splits exactly as it did before rotation existed', async () => {
    // Production sets 500 (`VIBLD_REPLAY_QUERY_BUDGET` in wrangler.jsonc).
    // The figures are literals on purpose, measured before internal issue 176 changed
    // anything, so this fails if the split moves, not only if it stops
    // agreeing with itself.
    const budget = 500;
    assert.equal(everyPhaseBuysAnItem(budget), true);
    assert.deepEqual(splitSharesFor(budget), {
      parked: 125,
      payout: 125,
      reconcile: 125,
      replay: 125,
    });
    assert.deepEqual(splitSharesFor(budget), {
      parked: parkedReserveFor(budget),
      payout: payoutReserveFor(budget),
      reconcile: reconcileReserveFor(budget),
      replay: replayBudgetFor(budget),
    });
    const shares = splitSharesFor(budget);
    assert.deepEqual(
      Object.fromEntries(
        NIGHTLY_PHASES.map((phase) => [phase, itemsFor(phase, shares[phase])]),
      ),
      { parked: 11, payout: 7, reconcile: 6, replay: 13 },
    );
  });

  it('never takes a turn, and spends no query deciding not to', async () => {
    // Unchanged means unchanged: a night on the deployed allowance runs
    // every phase and asks nothing of D1 about rotation.
    const { store, statements } = countingStore();
    for (let night = 0; night < NIGHTLY_PHASES.length; night += 1) {
      assert.equal(await takeNightlyTurn(store, 500), null);
    }
    assert.equal(statements(), 0);
  });

  it('rotates below 92 and splits from 92 up', async () => {
    // 92 is where a quarter first covers a subscription's worst case plus
    // the reconcile's fixed cost. The rest of the pass is already covered
    // there, so it is the one threshold, and it has to be a single step:
    // an allowance above it that rotated again would be a Paid deployment
    // changing behaviour on a number nobody chose for that reason.
    for (let budget = 1; budget <= 1000; budget += 1) {
      assert.equal(everyPhaseBuysAnItem(budget), budget >= 92, `${budget}`);
    }
    // And the step below it, for the same reason: the parked floor holds
    // from 35 up and nowhere under it.
    for (let budget = 1; budget < 92; budget += 1) {
      assert.equal(parkedFloorFitsFor(budget), budget >= 35, `${budget}`);
    }
  });

  it('is how the nightly pass decides', async () => {
    // The properties above are only worth having if `scheduled` uses them.
    // Read as one whitespace-collapsed string, for the reason the replay
    // budget test in billing-replay.test.ts gives.
    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );
    const flat = source.replace(/\s+/g, ' ');

    // `planNight` is `takeNightlyTurn` on a night with no account deletion
    // waiting; the suite below holds it to that.
    assert.match(
      flat,
      /planNight\(billing, afterLookup, lookup\.need\)/,
      'the pass no longer asks whose turn it is',
    );
    assert.match(
      flat,
      /plan\.billing\.kind === 'split' \? everyPhase\(plan\.billing\.budget\) : rotatedNight\(plan\.billing\)/,
      'a night that can split no longer runs every phase',
    );
    for (const call of [
      /replayStripeEvents\( stripe, billing, undefined, undefined, shares\.replay, reversed, readCharge, readCard, \)/,
      /retryUnattributedEvents\( billing, retryBatchFor\(shares\.parked\),/,
      /resumeStrandedPayouts\(\s?payout, payoutBatchFor\(shares\.payout\),?\s?\)/,
      /reconcileSubscriptions\( stripe, billing, cleared, reconcileBatchFor\(shares\.reconcile\), \)/,
    ]) {
      assert.match(
        flat,
        call,
        'a phase on a rotating night is sized from the wrong share',
      );
    }
  });
});

/**
 * Account deletion's share of the same allowance (docs/decisions.md L32).
 *
 * The retries and the purge run in the nightly pass, inside the one D1
 * allowance the invocation has. A night with nothing waiting has to be the
 * night the billing pass always had; a night with something waiting has to
 * buy deletion an item without taking the parked floor away or pushing any
 * night past its allowance.
 */
describe('the nightly pass with account deletions waiting', () => {
  /** The most one rotating night can spend, deletion's share included. */
  async function worstRotatingNight(
    shares: Record<NightlyPhase, number>,
    deletion: number,
  ): Promise<number> {
    let total = QUERIES_PER_TURN + deletion;
    for (const phase of NIGHTLY_PHASES) {
      if (shares[phase] > 0) total += await worstCostFor(phase, shares[phase]);
    }
    return total;
  }

  it('is the ordinary night when nothing is waiting', async () => {
    for (const budget of [24, 30, DEFAULT_QUERY_BUDGET, 91, 92, 121, 500]) {
      const ordinary = countingStore();
      const withDeletion = countingStore();
      for (let night = 0; night < 4; night += 1) {
        const plan = await takeNightlyTurn(ordinary.store, budget);
        const planned = await planNight(withDeletion.store, budget, 0);
        assert.equal(planned.deletion, 0);
        assert.deepEqual(
          planned.billing,
          plan === null
            ? { kind: 'split', budget }
            : { kind: 'rotate', turn: plan.turn, shares: plan.shares },
          `${budget} night ${night}`,
        );
      }
      assert.equal(withDeletion.statements(), ordinary.statements());
    }
  });

  it('rotates deletion in on the default allowance, keeping the parked floor', async () => {
    const budget = DEFAULT_QUERY_BUDGET;
    const { store } = countingStore();
    const turns: NightTurn[] = [];
    const bought = new Map<NightTurn, number>();
    for (let night = 0; night < ROTATING_PHASES.length + 1; night += 1) {
      const plan = await planNight(store, budget, 1000);
      assert.equal(plan.billing.kind, 'rotate');
      if (plan.billing.kind !== 'rotate') continue;
      turns.push(plan.billing.turn);
      assert.ok(itemsFor('parked', plan.billing.shares.parked) >= 1);
      for (const phase of ROTATING_PHASES) {
        bought.set(
          phase,
          (bought.get(phase) ?? 0) +
            itemsFor(phase, plan.billing.shares[phase]),
        );
      }
      if (plan.deletion >= MIN_DELETION_SHARE) bought.set(DELETION_TURN, 1);
      const total = await worstRotatingNight(
        plan.billing.shares,
        plan.deletion,
      );
      assert.ok(total <= budget, `night ${night}: ${total} of ${budget}`);
    }
    assert.deepEqual(turns, [...ROTATING_PHASES, DELETION_TURN]);
    for (const turn of [...ROTATING_PHASES, DELETION_TURN]) {
      assert.ok((bought.get(turn) ?? 0) >= 1, `${turn} bought nothing`);
    }
  });

  it('buys every phase and deletion an item within a lap, from 24 to 121', async () => {
    for (let budget = 24; budget < 122; budget += 1) {
      assert.equal(splitSurvivesDeletion(budget), false, `${budget}`);
      const floor = parkedFloorFitsFor(budget);
      const lap = floor
        ? ROTATING_PHASES.length + 1
        : NIGHTLY_PHASES.length + 1;
      const bought = new Set<NightTurn>();
      for (let night = 0; night < lap; night += 1) {
        const plan = nightSharesWithDeletion(budget, night);
        if (floor) {
          assert.equal(plan.shares.parked, parkedReserveFor(budget));
        }
        if (plan.turn === DELETION_TURN) {
          if (plan.deletion >= MIN_DELETION_SHARE) bought.add(DELETION_TURN);
        } else if (itemsFor(plan.turn, plan.shares[plan.turn]) >= 1) {
          bought.add(plan.turn);
        }
        const total = await worstRotatingNight(plan.shares, plan.deletion);
        assert.ok(total <= budget, `${budget} night ${night}: ${total}`);
      }
      for (const turn of floor
        ? [...ROTATING_PHASES, DELETION_TURN]
        : [...NIGHTLY_PHASES, DELETION_TURN]) {
        assert.ok(bought.has(turn), `${budget}: ${turn} bought nothing`);
      }
    }
  });

  it('keeps the split from 122 up, with a quarter for deletion', async () => {
    for (let budget = 122; budget <= 1000; budget += 1) {
      assert.equal(splitSurvivesDeletion(budget), true, `${budget}`);
      assert.ok(deletionReserveFor(budget) >= MIN_DELETION_SHARE);
    }
    const { store, statements } = countingStore();
    const plan = await planNight(store, 500, 1000);
    assert.deepEqual(plan, {
      deletion: 125,
      billing: { kind: 'split', budget: 375 },
    });
    assert.equal(everyPhaseBuysAnItem(375), true);
    // No turn is taken on a night that splits.
    assert.equal(statements(), 0);
  });

  it('never gives deletion more than it could spend', async () => {
    const { store } = countingStore();
    const plan = await planNight(store, 500, 12);
    assert.deepEqual(plan, {
      deletion: 12,
      billing: { kind: 'split', budget: 488 },
    });
  });
});
