/**
 * The welcome credit's ledger identity, and the one write the Stripe webhook
 * makes for it.
 *
 * Separate from `signup-credit.ts` so that `billing-events.ts` can pay a
 * saved card without importing the Clerk lookup and the access decision,
 * which that module needs and the webhook path must not: they reach back
 * into billing through `access-billing.ts`, and the webhook has neither a
 * session nor a reason to ask either question. See `signup-credit.ts` for
 * how the offer is decided.
 */

import type { BillingStore, SignupCardOutcome } from './billing-store.ts';

/**
 * Recorded as the granting actor. The column is an email because every other
 * row in this table was granted by a person; this one names the system that
 * granted it so an audit view can tell the two apart at a glance.
 */
export const SIGNUP_GRANT_ACTOR = 'system@vibld.com';

/**
 * The note on a grant made for a saved card. Rows granted on account
 * creation, before the card requirement, keep the note they were written
 * with; nothing rewrites them.
 */
export const SIGNUP_GRANT_NOTE = 'Welcome credit for adding a card';

/** One id per user, forever. The idempotency of the write rests on it. */
export function signupGrantId(userId: string): string {
  return `signup:${userId}`;
}

/**
 * Pay the welcome credit for a card the account has just saved, if the card
 * and the account are both still unclaimed.
 *
 * Called from the Stripe webhook, never from a browser request. It asks no
 * question about access or the cohort, because both were asked when the
 * offer opened, on a request that could ask them; an account with no offer
 * row is refused here. What it adds is the one thing only the webhook
 * knows: which card was saved.
 *
 * Idempotent on the SetupIntent, so a redelivered event, or the two events
 * one saved card produces, pay at most once. See
 * `BillingStore.claimSignupCardCredit` for how.
 */
export async function grantSignupCreditForCard(
  billing: Pick<BillingStore, 'claimSignupCardCredit'>,
  card: { userId: string; setupIntentId: string; cardFingerprint: string },
): Promise<{ outcome: SignupCardOutcome; paid: boolean }> {
  return billing.claimSignupCardCredit({
    setupIntentId: card.setupIntentId,
    userId: card.userId,
    cardFingerprint: card.cardFingerprint,
    grantId: signupGrantId(card.userId),
    grantedByEmail: SIGNUP_GRANT_ACTOR,
    note: SIGNUP_GRANT_NOTE,
  });
}
