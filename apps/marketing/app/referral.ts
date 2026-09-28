/**
 * Carrying a referral code from vibld.com to the builder's sign-up form.
 *
 * A shared link can land here (`https://vibld.com/?ref=CODE`), and the
 * account is created on app.vibld.com, a different origin, so nothing this
 * site stores is visible there. The code therefore travels in the one thing
 * both origins see: the query string of the sign-up link. The builder reads
 * `?ref=` on `/sign-up` and claims it once the account exists
 * (apps/web/src/referral/referral-client.ts).
 *
 * The prerendered pages are untouched: every sign-up link is rendered as the
 * plain `SITE.signUpUrl`, which is correct without JavaScript and simply
 * carries no referral. Only once the page is running is a kept code added.
 */

/**
 * The code format, as the builder's Worker issues it
 * (apps/web/worker/referral.ts): 8 characters from an alphabet without 0, O,
 * 1, I or L. A copy, because this app cannot import that one;
 * `test/referral.test.ts` holds the two to the same answers.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** The query parameter a referral link carries, here and in the builder. */
export const REF_PARAM = 'ref';

/**
 * Where a code waits between landing and clicking "Sign up".
 *
 * `sessionStorage`: it lasts for this tab's visit and no longer, which is
 * the whole of what it is for, and it is never sent to this site or anybody
 * else. The Cookie Notice says so.
 */
export const REFERRAL_STORAGE_KEY = 'vibld.referral-code';

/**
 * A code in its stored form, or null. Case, spaces and hyphens are forgiven,
 * as the Worker forgives them; anything else is null rather than a guess, so
 * nothing from the address bar but eight known characters is ever kept or
 * written into a link.
 */
export function readReferralCode(raw: unknown): string | null {
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

/** The slice of `Storage` used here, so a test can pass a map. */
export type ReferralStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The code for this visit: one arriving in `search` if it is readable, which
 * is also kept, otherwise whatever was kept earlier in the visit.
 *
 * Never throws. A browser that refuses storage still gets the code on the
 * page it landed on, just not on the pages after it.
 */
export function referralCodeForVisit(
  search: string,
  storage: ReferralStorage | null,
): string | null {
  const arriving = readReferralCode(new URLSearchParams(search).get(REF_PARAM));
  if (arriving !== null) {
    try {
      storage?.setItem(REFERRAL_STORAGE_KEY, arriving);
    } catch {
      // Kept for this page only.
    }
    return arriving;
  }
  try {
    return readReferralCode(storage?.getItem(REFERRAL_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * `href` with the code added, if it is a link to the sign-up form, else
 * `href` unchanged.
 *
 * Compared as parsed URLs, origin and path, rather than as a string prefix,
 * so a lookalike such as `https://app.vibld.com/sign-up.evil.example` is
 * never touched. The code goes in through `URLSearchParams`, which encodes
 * it, although a code that got this far is only ever eight safe characters.
 */
export function withReferral(
  href: string,
  signUpUrl: string,
  code: string,
): string {
  let target: URL;
  let signUp: URL;
  try {
    target = new URL(href);
    signUp = new URL(signUpUrl);
  } catch {
    return href;
  }
  if (target.origin !== signUp.origin || target.pathname !== signUp.pathname) {
    return href;
  }
  target.searchParams.set(REF_PARAM, code);
  return target.toString();
}
