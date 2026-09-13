/**
 * The one-time credit a new account starts with.
 *
 * Granted lazily rather than from a Clerk `user.created` webhook: that would
 * be a second endpoint, a second signing secret, and a new way for a signup
 * to silently not get its credit if the webhook is misconfigured. The first
 * authenticated request a user makes is just as good a signal that the
 * account exists, and it cannot arrive late.
 *
 * What makes that safe is the id. `billing_admin_credits` has
 * `ON CONFLICT(id) DO NOTHING`, so a deterministic id per user means the
 * grant lands exactly once no matter how many requests race it or how many
 * call sites invoke it. This is deliberately not a "have they got one
 * already?" read followed by a write, which is the version with a race in it.
 *
 * This is separate money from the free monthly allowance
 * (`DEFAULT_FREE_INCLUDED_MICRO_USD`, also $1). The allowance resets every
 * month; this does not, and it is spent from the top-up bucket alongside
 * Stripe purchases and admin grants.
 */

import type { BillingStore } from './billing-store.ts';

/** $1.00, as `grantAdminCredit` counts it. */
export const DEFAULT_SIGNUP_CREDIT_USD_CENTS = 100;

/**
 * Recorded as the granting actor. The column is an email because every other
 * row in this table was granted by a person; this one names the system that
 * granted it so an audit view can tell the two apart at a glance.
 */
export const SIGNUP_GRANT_ACTOR = 'system@vibld.com';

export const SIGNUP_GRANT_NOTE = 'Welcome credit on account creation';

export interface SignupCreditEnv {
  /**
   * Cents. Defaults to 100. Set it to "0" to stop granting entirely, which
   * is the switch to reach for if new accounts ever start being created
   * faster than people are creating them.
   */
  VIBLD_SIGNUP_CREDIT_USD_CENTS?: string | undefined;
}

/**
 * How much a new account gets, in cents.
 *
 * An unreadable value falls back to the default rather than to zero. Getting
 * this wrong in the generous direction costs a dollar per account; getting it
 * wrong in the other direction silently stops every new user receiving what
 * they were promised, and nothing would report it.
 */
export function signupCreditCents(env: SignupCreditEnv): number {
  const raw = env.VIBLD_SIGNUP_CREDIT_USD_CENTS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_SIGNUP_CREDIT_USD_CENTS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_SIGNUP_CREDIT_USD_CENTS;
  }
  return parsed;
}

/** One id per user, forever. The whole idempotency of this rests on it. */
export function signupGrantId(userId: string): string {
  return `signup:${userId}`;
}

/**
 * Grant the welcome credit if this user has never had it.
 *
 * Never throws: a failed grant must not fail the request it rode in on. A
 * user who does not get their dollar on this request gets it on the next one,
 * because the id makes retrying free.
 *
 * Returns whether a grant was attempted, which is what the tests assert on.
 * It is deliberately not "was one inserted": the insert is a no-op on a
 * repeat by design, and distinguishing the two would need the extra read this
 * exists to avoid.
 */
export async function grantSignupCreditOnce(
  billing: Pick<BillingStore, 'grantAdminCredit'>,
  userId: string,
  env: SignupCreditEnv,
): Promise<boolean> {
  const cents = signupCreditCents(env);
  if (cents <= 0) return false;
  try {
    await billing.grantAdminCredit(
      signupGrantId(userId),
      userId,
      cents,
      SIGNUP_GRANT_ACTOR,
      SIGNUP_GRANT_NOTE,
    );
    return true;
  } catch {
    return false;
  }
}
