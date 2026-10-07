import { ACCOUNT_BUDGET_KEY, dayKey } from './spend.ts';
import type { SpendVerdict } from './spend.ts';
import { TRIAL_PERIOD_KEY, allowancePeriodKey } from './entitlement.ts';
import type { Pool, Reservation, UserBudget } from './budget.ts';
import { retryingWithin, sleep, withinDeadline } from '@vibld/core';

/**
 * How long one call to a budget Durable Object may stay pending
 * (internal PR 196 review).
 *
 * The same hazard as the build call and the model call, on the last two
 * awaits in this step that did not have it: a ledger that *rejects* is
 * caught and reported, and a ledger that simply never answers is not,
 * because a pending promise reaches no catch. The step then runs out and
 * fails a Workflow whose project was already accepted, promoted, settled
 * and billed.
 *
 * Seconds rather than minutes, because these are same-colocation object
 * calls and `retrying` already waits a second between attempts, which is a
 * pace that assumes sub-second answers. Generous against that, and small
 * enough that the whole settlement, retries included, still fits inside
 * `REPAIR_BUILD_ALLOWANCE_MS` beside two builds. `repair-timeout.test.ts`
 * adds it up.
 */
export const LEDGER_CALL_TIMEOUT_MS = 15_000;

/**
 * Holding a run's worst case against every ceiling, in one place.
 *
 * Lifted out of `index.ts` rather than written fresh (internal issue 194). Two callers
 * need it now: `handlePlan`, which holds a reservation before a run may
 * start, and the generate step, which has to hold one again before a repair
 * turn goes out. A ceiling the Worker spells twice is a ceiling that can be
 * enforced two different ways, which is the reasoning `reserveAccount`
 * already carried for the account layer alone (internal PR 191 review); this extends it
 * to all three layers.
 *
 * There is a second reason, and it is not a side benefit. `index.ts` imports
 * `cloudflare:workers` and cannot be loaded under `node --test`, so the
 * spend ceilings have never had a direct test: every assertion about them
 * has been made one layer away, against `spend.ts`'s pure `decide` or
 * against a source read. Nothing here imports that module, so the order
 * these layers are asked in, and what happens when a later one refuses
 * after an earlier one allowed, can be asserted against real fakes.
 */

/** The bindings and knobs a reservation needs, and nothing else. */
export interface ReserveEnv {
  USER_BUDGET?: DurableObjectNamespace<
    Pick<UserBudget, 'reserve' | 'settle' | 'leavePool' | 'inFlightFor'>
  >;
  /** Micro-USD this whole deployment may spend in one UTC day (L29). */
  VIBLD_ACCOUNT_DAILY_MICRO_USD?: string;
  /**
   * Micro-USD of that day the Free plan may spend between all its accounts
   * (D158), so free use can never pause paying ones.
   */
  VIBLD_FREE_DAILY_MICRO_USD?: string;
  /** How many runs one caller may have in flight at once. */
  VIBLD_MAX_IN_FLIGHT?: string;
}

export const DEFAULT_MAX_IN_FLIGHT = 2;
export const DEFAULT_ACCOUNT_DAILY_MICRO_USD = 80_000_000;
/** D158 (Chris, 2026-10-05): about $10 of the $80 day is the Free plan's. */
export const DEFAULT_FREE_DAILY_MICRO_USD = 10_000_000;
/** The pool name Free runs carry in the account ledger. */
export const FREE_POOL = 'free';

/**
 * The Free plan's share of the deployment's day (D158), or none for a run
 * that is not on the Free plan.
 */
export function freePoolFor(
  env: ReserveEnv,
  pooled: boolean,
): Pool | undefined {
  if (!pooled) return undefined;
  return {
    name: FREE_POOL,
    ceilingMicroUsd: positiveInt(
      env.VIBLD_FREE_DAILY_MICRO_USD,
      DEFAULT_FREE_DAILY_MICRO_USD,
    ),
  };
}

/** What a reservation needs to know beyond its amounts. */
export interface ReserveOptions {
  /**
   * The run is on the Free plan and counts against the Free plan's share
   * of the day as well as the whole of it (D158). Released again if the
   * run turns out to draw on top-up credit, which is paid money.
   */
  freePool?: boolean;
  /**
   * The ledger period the allowance is spent against, when it is not the
   * month's: a Free account's trial (D159, `TRIAL_PERIOD_KEY`).
   */
  allowancePeriod?: string;
}

export interface BudgetLayers {
  account: Reservation;
  user: Reservation;
  /**
   * Which `USER_BUDGET` instance `user.id` was actually reserved against:
   * `userId` for the caller's own monthly tier allowance, or
   * `"<userId>:topup"` if that allowance was already exhausted and the
   * reservation was drawn from top-up credit instead. Threaded through
   * `WorkflowParams.reservationKey` so settlement targets the same instance.
   */
  userReservationKey: string;
  /**
   * The account row counts against the Free plan's share of the day (D158).
   * Absent when the run is not on the Free plan or is paid from top-up
   * credit, so a later hold for the same run (a mockup retry, a repair
   * turn) asks for the share only when the run itself is in it.
   */
  freePool?: true;
}

/** Only ever constructed from a verdict already known to deny the run. */
export type DeniedVerdict = Extract<SpendVerdict, { allow: false }>;

/**
 * Which ceiling refused a run on money, and what was left under it.
 *
 * `period-ceiling` is one verdict for two different facts, and the copy
 * that answered it said the same thing for both: "this month's generation
 * budget is used up". That was wrong twice over. The deployment's daily
 * ceiling (L29) refuses with the same verdict, and it is not the caller's
 * budget at all; and a caller's own ledger refuses whenever the worst case
 * does not fit in what is left, which is not the same as nothing being
 * left. A Free account with its whole dollar was told it had spent it.
 *
 * The account layer's own headroom is deliberately not reported: what the
 * whole deployment has left today is not the caller's business, and not
 * something they can act on.
 */
export type CeilingRefusal =
  | { layer: 'account' }
  /** The Free plan's share of the day is spent; the deployment has room. */
  | { layer: 'free-pool' }
  | {
      layer: 'user';
      /** What is left of this period's allowance, never below zero. */
      allowanceLeftMicroUsd: number;
      /**
       * What is left of the caller's top-up credit, where they have any and
       * it was asked. Absent when they have none.
       */
      topupLeftMicroUsd?: number;
      /**
       * The allowance is a Free account's trial (D159), which does not
       * reset: the refusal asks for a card rather than the 1st.
       */
      trial?: true;
    };

export type ReserveOutcome =
  | { ok: true; layers: BudgetLayers }
  | {
      ok: false;
      verdict: DeniedVerdict;
      /** Present exactly when `verdict.reason` is `period-ceiling`. */
      ceiling?: CeilingRefusal;
    };

/**
 * The largest single reservation the caller's own ledger could still admit.
 *
 * The larger of the two buckets rather than their sum, because a
 * reservation is drawn from one of them and never split across both
 * (`reserveBudget`). A figure that added them would size a run the ledger
 * then refuses.
 */
export function largestReservable(refusal: CeilingRefusal): number {
  if (refusal.layer !== 'user') return 0;
  return Math.max(
    refusal.allowanceLeftMicroUsd,
    refusal.topupLeftMicroUsd ?? 0,
  );
}

export function topupKeyFor(userId: string): string {
  return `${userId}:topup`;
}

export function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The account-wide daily ceiling, held for one run's worst case.
 *
 * Its own function because a second caller appeared (internal PR 191 review): a
 * mockup run that retries an empty reply asks for this again before the
 * second attempt goes out, and a reservation the Worker spells twice is a
 * ceiling that can be enforced two different ways.
 *
 * Unbounded in-flight on purpose: concurrency is the per-user layer's job.
 * This layer enforces spend only.
 */
export async function reserveAccount(
  env: ReserveEnv,
  worstCase: number,
  now: number,
  options: ReserveOptions = {},
): Promise<Reservation> {
  const accountCeiling = positiveInt(
    env.VIBLD_ACCOUNT_DAILY_MICRO_USD,
    DEFAULT_ACCOUNT_DAILY_MICRO_USD,
  );
  const pool = freePoolFor(env, options.freePool === true);
  // Without the argument when there is no pool, so a ledger that predates
  // pools is asked exactly what it always was.
  return env
    .USER_BUDGET!.getByName(ACCOUNT_BUDGET_KEY)
    .reserve(
      worstCase,
      accountCeiling,
      Number.MAX_SAFE_INTEGER,
      dayKey(now),
      ...(pool ? [pool] : []),
    );
}

/** The refusal an account-layer denial stands for. */
function accountRefusal(account: Reservation): CeilingRefusal | undefined {
  if (account.verdict.allow || account.verdict.reason !== 'period-ceiling') {
    return undefined;
  }
  return account.poolRefused ? { layer: 'free-pool' } : { layer: 'account' };
}

/**
 * Reserves against every ceiling before a run may start: the account-wide
 * one first (cheaper to check, and failing it means nothing else needs
 * touching), then the caller's own monthly tier allowance (L35-L39), then --
 * only if that allowance is exhausted, not merely low -- their top-up
 * credit balance (L37). If an earlier layer allows but a later one refuses
 * or is unreachable, the earlier hold is released at once: a run that never
 * starts must never leave a phantom charge sitting against a ceiling
 * waiting on the abandoned-reservation reclaim.
 *
 * `monthlyAllowance` and `topupCeiling` are the caller's to compute
 * (`handlePlan` reads them from `BillingStore`) -- this function only knows
 * how to spend them, not where they come from.
 */
export async function reserveBudget(
  env: ReserveEnv,
  userId: string,
  worstCase: number,
  monthlyAllowance: number,
  topupCeiling: number,
  now: number,
  /** Only so a test does not spend the release retry delay. */
  wait: (ms: number) => Promise<void> = sleep,
  /**
   * Only so a test does not spend a real ledger timeout, for the same
   * reason `wait` is injected: the attempt that has to be bounded is one
   * that never answers, and waiting fifteen real seconds for it in a unit
   * test is not a bound anybody would keep.
   */
  within: number = LEDGER_CALL_TIMEOUT_MS,
  options: ReserveOptions = {},
): Promise<ReserveOutcome> {
  const ledger = env.USER_BUDGET!;
  const allowancePeriod = options.allowancePeriod ?? allowancePeriodKey(now);
  const onTrial = allowancePeriod === TRIAL_PERIOD_KEY;
  // Bounded, as every other ledger call here is (internal PR 374 review): an account
  // ledger that accepts the call and never answers must end the request
  // as "accounting unavailable", not leave it pending. Not retried, since
  // an attempt that went unanswered may have written its row; that row is
  // reclaimed like any other run that never came back.
  const reserveDay = (freePool: boolean) =>
    withinDeadline(reserveAccount(env, worstCase, now, { freePool }), within);
  let account = await reserveDay(options.freePool === true);
  // The Free share of the day is spent, but this account holds top-up
  // credit (D158). That is money it paid, so the run may still go, outside
  // the share and drawing on top-up credit alone: the monthly allowance is
  // the Free plan's, and spending it here would be free use the share no
  // longer has room for.
  let topupOnly = false;
  if (!account.verdict.allow && account.poolRefused && topupCeiling > 0) {
    account = await reserveDay(false);
    topupOnly = true;
  }
  if (!account.verdict.allow) {
    const ceiling = accountRefusal(account);
    return {
      ok: false,
      verdict: account.verdict,
      ...(ceiling ? { ceiling } : {}),
    };
  }

  const releaseAccount = async () => {
    if (account.id !== undefined) {
      await ledger.getByName(ACCOUNT_BUDGET_KEY).settle(account.id, 0);
    }
  };

  /**
   * The release, asked for more than once and never allowed to escape.
   *
   * Used on the denial paths as well as the rejection ones (internal PR 196 review).
   * A denial is the commonest way this function ends and it leaves exactly
   * the same hold behind, so a release that failed there was the same lost
   * money for the same shared ceiling. It was also worse in one way the
   * rejection path never was: `await releaseAccount()` bare turned a clean
   * "no, you are over your allowance" into a thrown exception when the
   * cleanup failed, so the caller got an error instead of the answer the
   * ledger had already given.
   */
  // Each attempt bounded, not just the sequence (internal PR 196 review). `retrying`
  // never reaches its second attempt if the first never settles, and
  // `handlePlan` calls this with no deadline of its own: a ledger that
  // stays pending would hang the request instead of answering 503, while
  // the account hold it is trying to give back is still held.
  const giveBackAccount = () => retryingWithin(releaseAccount, within, wait);

  /**
   * The account hold is released when a later layer *refuses*, and it has
   * to be released when a later layer *rejects* too (internal PR 196 review).
   *
   * The two look nothing alike from here and cost the same thing. Once the
   * account layer has allowed, this function holds a worst case against the
   * deployment-wide daily ceiling (L29); a user-ledger Durable Object that
   * is unreachable throws straight past every `releaseAccount` below, and
   * the reclaim charges that hold in full thirty-five minutes later for a
   * run that never went out. That ceiling is shared, so a caller whose own
   * ledger keeps blinking would spend the whole deployment's day and refuse
   * everybody else.
   *
   * The release is asked for more than once before it is given up on
   * (internal PR 196 review). What takes the user ledger down is usually a Durable
   * Object restarting, and the account object can be restarting for the
   * same reason at the same moment; a single attempt suppressed on failure
   * leaves exactly the hold this exists to release, so the first version of
   * this fix protected the shared ceiling only when the cleanup happened to
   * work first time.
   *
   * It still never replaces the original error. The release goes to the
   * same ledger that just rejected, so its own failure is the likeliest
   * outcome of all, and reporting that one would name the cleanup instead
   * of the cause and lose which ledger was down.
   *
   * Takes a thunk rather than a promise so that a `getByName` throwing
   * synchronously is caught too: passing the promise would build it before
   * this was ever entered.
   */
  const guard = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      await giveBackAccount();
      throw error;
    }
  };

  const maxInFlight = positiveInt(
    env.VIBLD_MAX_IN_FLIGHT,
    DEFAULT_MAX_IN_FLIGHT,
  );
  /**
   * In flight across both of this caller's ledgers (internal PR 374 review).
   *
   * Each ledger serializes its own rows and not the other's, so a run
   * admitted by one reads the other after its own row is written, and
   * gives its place back if the two together are over the limit. Two runs
   * racing across the ledgers each write before they read, so at least one
   * of them sees the other: this can refuse one run too many, never admit
   * one too many.
   *
   * Asked only where the caller holds top-up credit; without it there are
   * no top-up runs to count.
   */
  const overLimit = async (
    own: { key: string; reservation: Reservation },
    other: { key: string; period: string },
  ): Promise<boolean> => {
    const giveBackOwn = () =>
      retryingWithin(
        async () => {
          if (own.reservation.id !== undefined) {
            await ledger.getByName(own.key).settle(own.reservation.id, 0);
          }
        },
        within,
        wait,
      );
    // Bounded like every other ledger call here: a ledger that never
    // answers must not hang the request with both holds written.
    const read = await retryingWithin(
      async () => ledger.getByName(other.key).inFlightFor(other.period),
      within,
      wait,
    );
    if (!read.ok) {
      await giveBackOwn();
      await giveBackAccount();
      throw read.error;
    }
    const elsewhere = read.value;
    if ((own.reservation.inFlight ?? 0) + 1 + elsewhere <= maxInFlight) {
      return false;
    }
    await giveBackOwn();
    await giveBackAccount();
    return true;
  };
  // A ledger's verdict, the same one either ledger gives on its own count.
  // Named rather than written inline: an inline `reason:` literal here reads
  // as a refusal identifier to `run-refusal-wire.test.ts`, which it is not.
  const inFlightReason = 'too-many-in-flight' as const;
  const tooManyInFlight = {
    ok: false,
    verdict: { allow: false, reason: inFlightReason },
  } as const;

  const primary = await guard(() =>
    ledger.getByName(userId).reserve(
      worstCase,
      // Zero still asks the in-flight question, which comes first.
      topupOnly ? 0 : monthlyAllowance,
      maxInFlight,
      allowancePeriod,
    ),
  );
  if (primary.verdict.allow) {
    if (
      topupCeiling > 0 &&
      (await overLimit(
        { key: userId, reservation: primary },
        { key: topupKeyFor(userId), period: 'lifetime' },
      ))
    ) {
      return tooManyInFlight;
    }
    return {
      ok: true,
      layers: {
        account,
        user: primary,
        userReservationKey: userId,
        ...(options.freePool && !topupOnly ? { freePool: true as const } : {}),
      },
    };
  }

  // A top-up buys more spend, not more in-flight runs: concurrency is only
  // ever gated by the primary bucket, so this denial is final regardless of
  // top-up balance.
  if (primary.verdict.reason === 'too-many-in-flight') {
    await giveBackAccount();
    return { ok: false, verdict: primary.verdict };
  }
  // What was left under the allowance when it refused. `spentMicroUsd` on a
  // refusal is what the period holds, runs still in flight included, which
  // is exactly what a smaller reservation would have to fit beside.
  const allowanceLeftMicroUsd = topupOnly
    ? 0
    : Math.max(0, monthlyAllowance - primary.spentMicroUsd);
  if (topupCeiling <= 0) {
    await giveBackAccount();
    return {
      ok: false,
      verdict: primary.verdict,
      ceiling: {
        layer: 'user',
        allowanceLeftMicroUsd,
        ...(onTrial ? { trial: true as const } : {}),
      },
    };
  }

  // The monthly allowance is exhausted -- try the caller's top-up balance
  // next, automatically. "lifetime" as the period key on purpose: unlike the
  // allowance above, a top-up does not reset month to month, it is drawn
  // down until spent (or, approximately, until it is 12 months old -- see
  // `BillingStore.totalTopupCreditMicroUsd`).
  const topupKey = topupKeyFor(userId);
  // The allowance refused on money, so it wrote no row and this run would
  // not count in flight there. Its in-flight limit is applied here instead,
  // net of what the allowance ledger already has running, or parallel
  // top-up runs would each see the same unchanged count (internal PR 374 review).
  const topupMaxInFlight = Math.max(0, maxInFlight - (primary.inFlight ?? 0));
  const topup = await guard(() =>
    ledger
      .getByName(topupKey)
      .reserve(worstCase, topupCeiling, topupMaxInFlight, 'lifetime'),
  );
  if (!topup.verdict.allow && topup.verdict.reason === 'too-many-in-flight') {
    await giveBackAccount();
    return { ok: false, verdict: topup.verdict };
  }
  if (
    topup.verdict.allow &&
    (await overLimit(
      { key: topupKey, reservation: topup },
      { key: userId, period: allowancePeriod },
    ))
  ) {
    return tooManyInFlight;
  }
  if (topup.verdict.allow) {
    // Top-up credit is money the caller paid, not the Free plan's share of
    // the day (D158). Best effort: failing leaves the row counted against
    // the pool, which refuses more Free runs, never fewer.
    if (options.freePool && !topupOnly && account.id !== undefined) {
      const id = account.id;
      const left = await retryingWithin(
        async () => ledger.getByName(ACCOUNT_BUDGET_KEY).leavePool(id),
        within,
        wait,
      );
      if (!left.ok) console.error('free pool release failed', left.error);
    }
    return {
      ok: true,
      layers: { account, user: topup, userReservationKey: topupKey },
    };
  }

  await giveBackAccount();
  // The monthly-allowance denial is the one worth reporting: it is what a
  // top-up would have fixed, whereas the top-up bucket's own denial is just
  // "also not enough" and says nothing new. What is left in both is
  // reported, since either could hold a smaller run.
  return {
    ok: false,
    verdict: primary.verdict,
    ceiling: {
      layer: 'user',
      allowanceLeftMicroUsd,
      topupLeftMicroUsd: Math.max(0, topupCeiling - topup.spentMicroUsd),
      ...(onTrial ? { trial: true as const } : {}),
    },
  };
}

/** Dollars and cents, rounded the way `direction` says. */
function dollars(microUsd: number, direction: 'up' | 'down'): string {
  const cents =
    direction === 'up'
      ? Math.ceil(microUsd / 10_000)
      : Math.floor(microUsd / 10_000);
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/**
 * The refusal a caller is shown when a reservation was not admitted, as the
 * `reason` code the client already reads and the sentence it displays.
 *
 * The codes are unchanged: both money refusals are still `account-ceiling`,
 * because the client does nothing different for them but show the
 * sentence, and the sentence is what was wrong. It now says which ceiling
 * refused and, for the caller's own, how much is left against how much
 * `what` needs set aside. The figure needed is rounded up and the figure
 * left rounded down, so the two can never read as equal when one did not
 * fit in the other.
 *
 * Shared by every route that reserves, so the build, the mockups and the
 * chat turn cannot come to describe the same ledger three different ways.
 */
export function refusalFor(
  denied: Extract<ReserveOutcome, { ok: false }>,
  /** What was being paid for, as the subject of a sentence. */
  what: string,
  /** The least that would have been admitted, in micro-USD. */
  neededMicroUsd: number,
): { reason: 'account-ceiling' | 'already-running'; error: string } {
  if (denied.verdict.reason === 'too-many-in-flight') {
    return {
      reason: 'already-running',
      error: 'A generation is already running. Wait for it to finish.',
    };
  }
  const ceiling = denied.ceiling;
  if (ceiling?.layer === 'free-pool') {
    return {
      reason: 'account-ceiling',
      error:
        'Free builds have reached their limit for today, so new free generations are paused until midnight UTC. A paid plan or a top-up keeps you building now.',
    };
  }
  if (ceiling?.layer === 'account') {
    return {
      reason: 'account-ceiling',
      error:
        'Vibld has reached its spending limit for today, so new generations are paused until midnight UTC. Your own allowance was not touched.',
    };
  }
  const needed = dollars(neededMicroUsd, 'up');
  if (!ceiling) {
    // Not reachable from `reserveBudget`, which always says which layer
    // refused on money. Worded so it is true whichever it was.
    return {
      reason: 'account-ceiling',
      error: `${what} needs ${needed} set aside, and there is not that much left to spend right now. Choose a cheaper model, or buy a top-up.`,
    };
  }
  const allowance = dollars(ceiling.allowanceLeftMicroUsd, 'down');
  if (ceiling.trial) {
    // D159: the trial does not reset, and a card is what comes next.
    const trialLeft =
      ceiling.topupLeftMicroUsd === undefined
        ? `the free trial has ${allowance} left`
        : `the free trial has ${allowance} left and your top-up credit ${dollars(ceiling.topupLeftMicroUsd, 'down')}`;
    return {
      reason: 'account-ceiling',
      error: `${what} needs at least ${needed} set aside, and ${trialLeft}. Add a card to get free builds every month (you won't be charged), or choose a paid plan or a top-up.`,
    };
  }
  const left =
    ceiling.topupLeftMicroUsd === undefined
      ? `this month's allowance has ${allowance} left`
      : `this month's allowance has ${allowance} left and your top-up credit ${dollars(ceiling.topupLeftMicroUsd, 'down')}`;
  return {
    reason: 'account-ceiling',
    error: `${what} needs at least ${needed} set aside, and ${left}. Choose a cheaper model or buy a top-up; the allowance resets on the 1st (UTC).`,
  };
}
