/**
 * The one-time credit a new account starts with.
 *
 * Two separate questions, and conflating them was the bug in the first
 * version of this file: "has this user already been granted it" and "is this
 * user a new account at all". The deterministic id answers the first
 * perfectly and says nothing about the second, so a grant keyed only on the
 * id would pay every pre-existing user the moment it shipped -- a credit
 * advertised for new accounts arriving instead as a retroactive payout to
 * everybody who came back.
 *
 * So eligibility is a cohort, defined by an explicit cutoff:
 * `VIBLD_SIGNUP_CREDIT_FROM`. Accounts created on or after it are new;
 * everyone else is not. Unset means nothing is granted, because a rollout
 * that pays out cannot have a default.
 *
 * Granted lazily on the first authenticated request rather than from a Clerk
 * `user.created` webhook: that would be a second endpoint, a second signing
 * secret, and a new way for a signup to silently not get its credit.
 *
 * The write stays idempotent through `ON CONFLICT(id) DO NOTHING`, so
 * correctness never rests on the read below. That read exists only to avoid
 * asking Clerk the same question on every request forever.
 */

import { fetchClerkUserCreatedAt } from './clerk-lookup.ts';
import type { ClerkLookupEnv } from './clerk-lookup.ts';
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

export interface SignupCreditEnv extends ClerkLookupEnv {
  /**
   * Cents. Defaults to 100. "0" stops the grant, which is the switch to reach
   * for if accounts ever start being created faster than people are creating
   * them.
   */
  VIBLD_SIGNUP_CREDIT_USD_CENTS?: string | undefined;
  /**
   * ISO 8601. Only accounts created at or after this instant are granted the
   * credit. Set it to the moment the offer starts.
   *
   * **Unset means no grants at all.** There is no safe default: any value
   * early enough to catch genuinely new accounts also catches every account
   * that already exists, and this is money. An operator naming the date is
   * the only way this can be both correct and deliberate.
   */
  VIBLD_SIGNUP_CREDIT_FROM?: string | undefined;
}

/**
 * Why a request did or did not result in a grant. Returned rather than logged
 * so the tests can assert on it, and so a caller can say something useful
 * instead of failing silently.
 */
export type SignupGrantOutcome =
  | 'granted'
  | 'already-granted'
  | 'disabled'
  | 'no-cohort-configured'
  | 'not-in-cohort'
  | 'age-unknown'
  | 'error';

/**
 * How much a new account gets, in cents.
 *
 * An unreadable value falls back to the default rather than to zero. Getting
 * this wrong in the generous direction costs a dollar per account in the
 * cohort; the other direction silently stops every new user receiving what
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

/**
 * The instant the offer starts, or null when none is configured or the value
 * cannot be read.
 *
 * An unparseable cutoff resolves to null, which grants nobody anything. That
 * is the opposite of the amount's fallback above, and deliberately so: a
 * typo in an amount overpays one cohort by a known factor, while a typo in a
 * date could silently widen the cohort to every account ever created.
 */
export function signupCohortStart(env: SignupCreditEnv): number | null {
  const raw = env.VIBLD_SIGNUP_CREDIT_FROM?.trim();
  if (raw === undefined || raw === '') return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One id per user, forever. The idempotency of the write rests on it. */
export function signupGrantId(userId: string): string {
  return `signup:${userId}`;
}

/**
 * Grant the welcome credit to a new account that has not had it.
 *
 * Never throws: a failed grant must not fail the request it rode in on. A
 * user who misses it on one request gets it on the next, because the id makes
 * retrying free.
 */
export async function grantSignupCreditOnce(
  billing: Pick<BillingStore, 'grantAdminCredit' | 'findAdminCredit'>,
  userId: string,
  env: SignupCreditEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<SignupGrantOutcome> {
  const cents = signupCreditCents(env);
  if (cents <= 0) return 'disabled';

  const cohortStart = signupCohortStart(env);
  if (cohortStart === null) return 'no-cohort-configured';

  try {
    // Cheapest question first. Once a user has their grant this is the only
    // work any later request does, so the Clerk lookup below happens at most
    // once per account rather than on every request forever.
    if (await billing.findAdminCredit(signupGrantId(userId))) {
      return 'already-granted';
    }

    const createdAt = await fetchClerkUserCreatedAt(env, userId, fetchImpl);
    // An account whose age cannot be established is not a new account. The
    // safe direction here is the stingy one: a genuinely new user gets their
    // credit on a later request once Clerk answers, while the other choice
    // pays out to everyone during any Clerk outage.
    if (createdAt === null) return 'age-unknown';
    if (createdAt < cohortStart) return 'not-in-cohort';

    await billing.grantAdminCredit(
      signupGrantId(userId),
      userId,
      cents,
      SIGNUP_GRANT_ACTOR,
      SIGNUP_GRANT_NOTE,
    );
    return 'granted';
  } catch {
    return 'error';
  }
}
