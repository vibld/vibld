/**
 * The one-time welcome credit, and who may claim it.
 *
 * **Card first** (Chris, 2026-09-27). The credit used to arrive on the first
 * authenticated request of a new account. With sign-up open to anybody, that
 * is a dollar of model spend for every email address somebody can create,
 * so it is now granted only once the account has a card on file: a Stripe
 * Checkout Session in `setup` mode, which saves the card and charges
 * nothing. The grant happens on the Stripe webhook that reports the card
 * saved (`billing-events.ts`), and it is limited twice over: once per
 * account, by the deterministic `signup:<user id>` id, and once per card, by
 * the card's Stripe fingerprint (0029_card_first_signup_credit.sql).
 *
 * Accounts that already received their dollar on creation keep it. Their
 * row carries the same id, so they are "already granted" to the new path and
 * are never offered or paid a second one.
 *
 * Two separate questions remain, and conflating them was the bug in the
 * first version of this file: "has this user already been granted it" and
 * "is this user a new account at all". The deterministic id answers the
 * first perfectly and says nothing about the second, so an offer keyed only
 * on the id would open to every pre-existing user the moment it shipped.
 *
 * So eligibility is still a cohort, defined by an explicit cutoff:
 * `VIBLD_SIGNUP_CREDIT_FROM`. Accounts created on or after it are new;
 * everyone else is not. Unset means nothing is offered, because a rollout
 * that pays out cannot have a default.
 *
 * The cohort is decided on an authenticated request, where Clerk can be
 * asked, and remembered: as an offer row for an account inside it, and as a
 * zero-cent marker for one outside it. The webhook runs as Stripe, with no
 * session, and reads the offer row rather than asking Clerk itself.
 */

import { fetchClerkUserCreatedAt } from './clerk-lookup.ts';
import type { ClerkLookupEnv } from './clerk-lookup.ts';
import type { BillingStore } from './billing-store.ts';
import { SIGNUP_GRANT_ACTOR, signupGrantId } from './signup-grant.ts';
import { decideAccessFor } from './access-handlers.ts';
import type { AccessEnv } from './access-handlers.ts';
import type { Principal } from './principal.ts';

// The grant's id and ledger labels live in `signup-grant.ts`, which the
// Stripe webhook path imports without pulling in the Clerk and access
// modules this one needs. Re-exported so there is one place to import the
// welcome credit from.
export {
  SIGNUP_GRANT_ACTOR,
  SIGNUP_GRANT_NOTE,
  grantSignupCreditForCard,
  signupGrantId,
} from './signup-grant.ts';

/** $1.00, as `grantAdminCredit` counts it. */
export const DEFAULT_SIGNUP_CREDIT_USD_CENTS = 100;

/**
 * Whether the credit waits for a card on file. Not a switch: nothing in this
 * Worker reads it. It is here, beside the amount, because the pricing page on
 * vibld.com reads this file's text (`apps/marketing/app/plans.ts`) to state
 * the offer, and a test there fails if the page stops mentioning the card
 * while this says one is required. Change the grant path and this together.
 */
export const SIGNUP_CREDIT_REQUIRES_CARD = true;

/**
 * Written, at zero cents, against an account that is not in the cohort.
 *
 * Without it every pre-offer account asks Clerk the same question on every
 * `/api/billing/status` request forever: an external call on a hot path, for
 * a decision that can never change, that during a Clerk outage costs each of
 * those requests the full 8-second timeout. The offer row does the same job
 * for an account inside the cohort.
 *
 * Zero cents, so it sums to nothing wherever credit is totalled, and a note
 * that says what it is, so the admin audit view is not left showing a
 * mysterious empty grant.
 *
 * The consequence worth knowing: moving VIBLD_SIGNUP_CREDIT_FROM earlier
 * later on will not retroactively pay someone already marked. That is
 * deliberate. Widening a cohort backwards is the dangerous direction, and
 * an admin grant is the right tool for paying a specific person.
 */
export const SIGNUP_DECLINED_NOTE = 'Not in the welcome-credit cohort';

export interface SignupCreditEnv extends ClerkLookupEnv, AccessEnv {
  /**
   * Cents. Defaults to 100. "0" stops new offers, which is the switch to
   * reach for if cards ever start being saved faster than people are saving
   * them. An offer already open keeps the amount it was opened at.
   */
  VIBLD_SIGNUP_CREDIT_USD_CENTS?: string | undefined;
  /**
   * ISO 8601. Only accounts created at or after this instant are offered the
   * credit. Set it to the moment the offer starts.
   *
   * **Unset means no offers and no grants at all.** There is no safe default: any value
   * early enough to catch genuinely new accounts also catches every account
   * that already exists, and this is money. An operator naming the date is
   * the only way this can be both correct and deliberate.
   */
  VIBLD_SIGNUP_CREDIT_FROM?: string | undefined;
}

/**
 * Why an account is not being offered the credit. Returned rather than
 * logged so the tests can assert on it, and so a caller can say something
 * useful instead of failing silently.
 */
export type SignupOfferRefusal =
  | 'no-access'
  | 'disabled'
  | 'no-cohort-configured'
  | 'not-in-cohort'
  | 'age-unknown'
  | 'error';

/**
 * Where an account stands with the welcome credit, as the builder shows it.
 *
 * - `granted`: it has the credit, however it came by it.
 * - `needs-card`: it is offered the credit and has not claimed it. The
 *   builder offers to save a card. `cardAlreadyUsed` says the last card it
 *   saved had already claimed the credit on another account.
 * - `none`: it is not offered the credit, for `reason`.
 */
export type SignupCreditStatus =
  | { state: 'granted'; cents: number }
  | { state: 'needs-card'; cents: number; cardAlreadyUsed: boolean }
  | { state: 'none'; reason: SignupOfferRefusal };

/**
 * A full ISO 8601 instant: calendar date, time, and an explicit zone.
 *
 * Validated before `Date.parse` rather than trusting it, because `Date.parse`
 * is far more permissive than "ISO instant" and permissive in the worst
 * possible direction here. `Date.parse("0")` is 2000-01-01 and
 * `Date.parse("99")` is 1999-01-01, both perfectly finite, so a cutoff
 * mistyped as a bare number would silently admit every account created this
 * century: exactly the retroactive payout the cohort exists to prevent.
 *
 * "0" is a likely typo rather than an exotic one: it is what disables
 * VIBLD_SIGNUP_CREDIT_USD_CENTS, so reaching for it here is an easy mistake
 * to make.
 *
 * An explicit zone is required for the same reason: "2026-09-13T00:00:00"
 * with no zone is read in the runtime's local time, which makes the cohort
 * boundary depend on where the Worker happens to run.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

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
  if (!ISO_INSTANT.test(raw)) return null;

  // The shape can be right and the day still not exist. "2026-02-30" matches
  // the pattern and does not throw: it rolls forward to March 2, so a cutoff
  // would silently land two days from where it was written. Checked against
  // the calendar rather than trusted.
  const [year, month, day] = raw.slice(0, 10).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Where this account stands with the welcome credit, opening the offer to it
 * if it is new and has not been decided yet.
 *
 * Never throws: a failed decision must not fail the request it rode in on. A
 * user who is not decided on one request is decided on the next, because
 * both writes are idempotent.
 *
 * **The access check lives here rather than at each call site.** This takes
 * the whole principal for that reason. The credit is the thing the invite
 * gate exists to protect, and the caller is an ungated route:
 * `/api/billing/status` is deliberately readable by somebody whose access
 * was revoked, so they can still see what happened to their money. An offer
 * opened here is what the webhook later pays against, so an account that
 * may not use the product must not be able to open one by reading its
 * balance.
 */
export async function signupCreditStatus(
  billing: Pick<
    BillingStore,
    | 'grantAdminCredit'
    | 'findAdminCredit'
    | 'openSignupOffer'
    | 'findSignupOffer'
    | 'latestSignupCardOutcome'
  >,
  principal: Principal,
  env: SignupCreditEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<SignupCreditStatus> {
  const userId = principal.userId;
  try {
    // Cheapest question first, and the one whose answer never changes. An
    // account that got its dollar, on creation or for a card, has it
    // whatever the configuration now says.
    const existing = await billing.findAdminCredit(signupGrantId(userId));
    if (existing) {
      return existing.creditUsdCents > 0
        ? { state: 'granted', cents: existing.creditUsdCents }
        : { state: 'none', reason: 'not-in-cohort' };
    }

    const cents = signupCreditCents(env);
    if (cents <= 0) return { state: 'none', reason: 'disabled' };
    const cohortStart = signupCohortStart(env);
    if (cohortStart === null) {
      return { state: 'none', reason: 'no-cohort-configured' };
    }

    // Before anything is written, and before Clerk is asked. An account that
    // may not use the product may not be offered its welcome credit either.
    if (!(await decideAccessFor(env, principal)).allowed) {
      return { state: 'none', reason: 'no-access' };
    }

    const offered = await billing.findSignupOffer(userId);
    if (offered !== undefined)
      return await awaitingCard(billing, userId, offered);

    const createdAt = await fetchClerkUserCreatedAt(env, userId, fetchImpl);
    // An account whose age cannot be established is not a new account. The
    // safe direction here is the stingy one: a genuinely new user is offered
    // the credit on a later request once Clerk answers, while the other
    // choice opens it to everyone during any Clerk outage.
    if (createdAt === null) return { state: 'none', reason: 'age-unknown' };
    if (createdAt < cohortStart) {
      // Recorded, not merely returned. This decision is permanent, and the
      // marker is what stops the Clerk call above repeating forever. Only
      // `age-unknown` above stays retryable, because that one can change.
      await billing.grantAdminCredit(
        signupGrantId(userId),
        userId,
        0,
        SIGNUP_GRANT_ACTOR,
        SIGNUP_DECLINED_NOTE,
      );
      return { state: 'none', reason: 'not-in-cohort' };
    }

    await billing.openSignupOffer(userId, cents);
    // Read back rather than assumed: a concurrent first request may have
    // opened it a moment earlier, and the amount it opened at is the one
    // that counts.
    return await awaitingCard(
      billing,
      userId,
      (await billing.findSignupOffer(userId)) ?? cents,
    );
  } catch {
    return { state: 'none', reason: 'error' };
  }
}

async function awaitingCard(
  billing: Pick<BillingStore, 'latestSignupCardOutcome'>,
  userId: string,
  cents: number,
): Promise<SignupCreditStatus> {
  // An offer of nothing is not an offer. Only reachable if a deployment
  // opened offers while the amount was misconfigured, and a button that
  // saves a card for $0.00 would be a promise with nothing behind it.
  if (cents <= 0) return { state: 'none', reason: 'disabled' };
  return {
    state: 'needs-card',
    cents,
    cardAlreadyUsed:
      (await billing.latestSignupCardOutcome(userId)) === 'card-used',
  };
}
