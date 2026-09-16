/**
 * Referral codes, attribution and payout, decided apart from the database and
 * the endpoints that apply them.
 *
 * Here rather than inside a handler for the same reason `spend.ts` is: this is
 * the rule about who gets given money, and a rule that can only be exercised
 * by deploying is a rule nobody checks. A referral program is a faucet
 * pointed at the credit ledger, so every rule below is written to fail
 * closed.
 *
 * The shape of the offer (docs/decisions.md, resolved 2026-09-16): both sides
 * earn, and nothing is paid until the referred account's first purchase
 * clears. Paying on signup would fund an attacker with disposable addresses
 * out of real model spend; paying on a cleared card funds the reward out of
 * revenue and makes the attack cost more than it returns.
 */

/**
 * The alphabet a code is drawn from.
 *
 * No `0`, `O`, `1`, `I` or `L`: a referral code's whole job is to survive
 * being read off a screen, typed from a phone, or dictated, and those five
 * are where that fails. 31 symbols over 8 places is about 8.5e11
 * combinations, which is far more than a lookup table this small will ever
 * need and enough that guessing one is pointless.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** How many characters a code has. */
export const CODE_LENGTH = 8;

/**
 * A new code, drawn from the given randomness.
 *
 * `random` takes a byte count and returns that many bytes, which is
 * `crypto.getRandomValues` in the Worker and a fake in the tests. Taken as an
 * argument rather than reached for, so the tests can prove the two properties
 * that matter: every character is in the alphabet, and the distribution is
 * not skewed by the modulo.
 *
 * Bytes are rejected rather than folded when they fall outside the largest
 * whole multiple of the alphabet. `byte % 31` looks equivalent and is not:
 * 256 is not a multiple of 31, so the first eight symbols would come up
 * about 13% more often than the rest. That bias is harmless for a code
 * nobody guesses and it is the kind of thing that gets copied into somewhere
 * it matters.
 */
export function makeCode(random: (bytes: number) => Uint8Array): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of random(CODE_LENGTH)) {
      if (code.length === CODE_LENGTH) break;
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return code;
}

/**
 * The stored form of whatever someone typed or pasted, or null.
 *
 * Codes are shared by voice, in chat, and in URLs people edit by hand, so
 * lowercase and separators are expected rather than exceptional. Anything
 * still not a valid code after that is null: a near-miss must not resolve to
 * somebody else's code, so nothing here guesses.
 */
export function normaliseCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const character of cleaned) {
    if (!CODE_ALPHABET.includes(character)) return null;
  }
  return cleaned;
}

/** Why an attribution was refused, for a caller that has to say something. */
export type AttributionRefusal =
  'unreadable-code' | 'unknown-code' | 'self-referral' | 'already-attributed';

export type AttributionDecision =
  | { ok: true; referrerUserId: string; code: string }
  | { ok: false; reason: AttributionRefusal };

/**
 * Whether this signup can be attributed to this code.
 *
 * Every refusal is silent to the person signing up: none of these is their
 * problem to solve, and the difference between "no such code" and "that is
 * your own code" is exactly the difference an attacker probes for.
 *
 * `existing` is any attribution already recorded for this account. First one
 * wins and is never replaced, because an account that can be re-attributed
 * can be sold to whichever referrer asks last.
 */
export function decideAttribution(input: {
  rawCode: string | null | undefined;
  referredUserId: string;
  ownerOfCode: string | undefined;
  existing: boolean;
}): AttributionDecision {
  const code = normaliseCode(input.rawCode);
  if (code === null) return { ok: false, reason: 'unreadable-code' };
  if (input.existing) return { ok: false, reason: 'already-attributed' };
  if (input.ownerOfCode === undefined) {
    return { ok: false, reason: 'unknown-code' };
  }
  // The cheapest attack there is, and the only one a single account can run
  // alone. Checked here rather than trusted to a database constraint so the
  // rule is visible and tested.
  if (input.ownerOfCode === input.referredUserId) {
    return { ok: false, reason: 'self-referral' };
  }
  return { ok: true, referrerUserId: input.ownerOfCode, code };
}

/** What a payout is worth, in cents, to each side. */
export interface RewardCents {
  referrer: number;
  referred: number;
}

/**
 * The default reward.
 *
 * Chris chose "both sides, on first purchase" but not an amount, so this is a
 * placeholder rather than a decision: it is deliberately modest and it is
 * overridable per deployment. Whatever replaces it is his number, not mine.
 */
export const DEFAULT_REWARD_CENTS: RewardCents = {
  referrer: 500,
  referred: 500,
};

/**
 * How many referrals one account can be paid for.
 *
 * A ceiling exists because the honest case and the abusive case look
 * identical from here: both are a stream of new accounts that paid. The
 * limit does not stop a real advocate being rewarded, it stops an unattended
 * faucet, and passing it is a reason to look rather than to refuse forever.
 */
export const MAX_PAID_REFERRALS = 25;

export type PayoutRefusal =
  'not-attributed' | 'already-paid' | 'referrer-at-cap';

export type PayoutDecision =
  | { pay: true; referrerUserId: string; reward: RewardCents }
  | { pay: false; reason: PayoutRefusal };

/**
 * Whether this first purchase earns a payout.
 *
 * Called from the path that records a cleared payment, so "the money arrived"
 * is already established and is not re-litigated here.
 *
 * `paidAlready` is the idempotency guard and it is the one that matters:
 * Stripe delivers a webhook more than once as a matter of course, and a
 * payout that runs twice is a payout an attacker can run as often as they can
 * make the delivery retry.
 */
export function decidePayout(input: {
  referrerUserId: string | undefined;
  paidAlready: boolean;
  referrerPaidCount: number;
  reward?: RewardCents;
}): PayoutDecision {
  if (input.referrerUserId === undefined) {
    return { pay: false, reason: 'not-attributed' };
  }
  if (input.paidAlready) return { pay: false, reason: 'already-paid' };
  if (input.referrerPaidCount >= MAX_PAID_REFERRALS) {
    return { pay: false, reason: 'referrer-at-cap' };
  }
  return {
    pay: true,
    referrerUserId: input.referrerUserId,
    reward: input.reward ?? DEFAULT_REWARD_CENTS,
  };
}

/**
 * The id a payout is written under.
 *
 * Deterministic, and keyed on the referred account rather than on the payment:
 * the offer is one payout per referred account, ever, so a second purchase by
 * the same account must collide with the first grant rather than earn again.
 * `grantAdminCredit` inserts or does nothing on this id, which is what makes a
 * repeated webhook a no-op rather than a second grant.
 */
export function payoutGrantId(
  side: 'referrer' | 'referred',
  referredUserId: string,
): string {
  return `referral:${side}:${referredUserId}`;
}

/** The link a user shares. */
export function referralUrl(appOrigin: string, code: string): string {
  const url = new URL(appOrigin);
  url.searchParams.set('ref', code);
  return url.toString();
}
