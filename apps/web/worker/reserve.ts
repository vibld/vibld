import { ACCOUNT_BUDGET_KEY, dayKey } from './spend.ts';
import type { SpendVerdict } from './spend.ts';
import { allowancePeriodKey } from './entitlement.ts';
import type { Reservation, UserBudget } from './budget.ts';

/**
 * Holding a run's worst case against every ceiling, in one place.
 *
 * Lifted out of `index.ts` rather than written fresh (#194). Two callers
 * need it now: `handlePlan`, which holds a reservation before a run may
 * start, and the generate step, which has to hold one again before a repair
 * turn goes out. A ceiling the Worker spells twice is a ceiling that can be
 * enforced two different ways, which is the reasoning `reserveAccount`
 * already carried for the account layer alone (#191 review); this extends it
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
  USER_BUDGET?: DurableObjectNamespace<Pick<UserBudget, 'reserve' | 'settle'>>;
  /** Micro-USD this whole deployment may spend in one UTC day (L29). */
  VIBLD_ACCOUNT_DAILY_MICRO_USD?: string;
  /** How many runs one caller may have in flight at once. */
  VIBLD_MAX_IN_FLIGHT?: string;
}

export const DEFAULT_MAX_IN_FLIGHT = 2;
export const DEFAULT_ACCOUNT_DAILY_MICRO_USD = 80_000_000;

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
}

/** Only ever constructed from a verdict already known to deny the run. */
export type DeniedVerdict = Extract<SpendVerdict, { allow: false }>;

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
 * Its own function because a second caller appeared (#191 review): a
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
): Promise<Reservation> {
  const accountCeiling = positiveInt(
    env.VIBLD_ACCOUNT_DAILY_MICRO_USD,
    DEFAULT_ACCOUNT_DAILY_MICRO_USD,
  );
  return env
    .USER_BUDGET!.getByName(ACCOUNT_BUDGET_KEY)
    .reserve(worstCase, accountCeiling, Number.MAX_SAFE_INTEGER, dayKey(now));
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
): Promise<
  { ok: true; layers: BudgetLayers } | { ok: false; verdict: DeniedVerdict }
> {
  const ledger = env.USER_BUDGET!;
  const account = await reserveAccount(env, worstCase, now);
  if (!account.verdict.allow) {
    return { ok: false, verdict: account.verdict };
  }

  const releaseAccount = async () => {
    if (account.id !== undefined) {
      await ledger.getByName(ACCOUNT_BUDGET_KEY).settle(account.id, 0);
    }
  };

  /**
   * The account hold is released when a later layer *refuses*, and it has
   * to be released when a later layer *rejects* too (#196 review).
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
   * The release itself is allowed to fail without saying so: it is the
   * same ledger that just rejected, and replacing the original error with
   * its second failure would hide why any of this happened.
   *
   * Takes a thunk rather than a promise so that a `getByName` throwing
   * synchronously is caught too: passing the promise would build it before
   * this was ever entered.
   */
  const guard = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      await releaseAccount().catch(() => {});
      throw error;
    }
  };

  const maxInFlight = positiveInt(
    env.VIBLD_MAX_IN_FLIGHT,
    DEFAULT_MAX_IN_FLIGHT,
  );
  const primary = await guard(() =>
    ledger
      .getByName(userId)
      .reserve(
        worstCase,
        monthlyAllowance,
        maxInFlight,
        allowancePeriodKey(now),
      ),
  );
  if (primary.verdict.allow) {
    return {
      ok: true,
      layers: { account, user: primary, userReservationKey: userId },
    };
  }

  // A top-up buys more spend, not more in-flight runs: concurrency is only
  // ever gated by the primary bucket, so this denial is final regardless of
  // top-up balance.
  if (primary.verdict.reason === 'too-many-in-flight' || topupCeiling <= 0) {
    await releaseAccount();
    return { ok: false, verdict: primary.verdict };
  }

  // The monthly allowance is exhausted -- try the caller's top-up balance
  // next, automatically. "lifetime" as the period key on purpose: unlike the
  // allowance above, a top-up does not reset month to month, it is drawn
  // down until spent (or, approximately, until it is 12 months old -- see
  // `BillingStore.totalTopupCreditMicroUsd`).
  const topupKey = topupKeyFor(userId);
  const topup = await guard(() =>
    ledger
      .getByName(topupKey)
      .reserve(worstCase, topupCeiling, Number.MAX_SAFE_INTEGER, 'lifetime'),
  );
  if (topup.verdict.allow) {
    return {
      ok: true,
      layers: { account, user: topup, userReservationKey: topupKey },
    };
  }

  await releaseAccount();
  // The monthly-allowance denial is the one worth reporting: it is what a
  // top-up would have fixed, whereas the top-up bucket's own denial is just
  // "also not enough" and says nothing new.
  return { ok: false, verdict: primary.verdict };
}
