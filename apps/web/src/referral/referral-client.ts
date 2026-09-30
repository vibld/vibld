import { isSignUpPath, getClerkToken } from '../auth/clerk-token.ts';
import { formatCredit } from '../billing/billing-client.ts';
import { AUTH_MODE } from '../auth/mode.ts';

/**
 * The builder's half of referrals: reading a code off an arriving link,
 * claiming it once the account exists, and fetching this account's own code
 * and progress (`/api/referral/status`, `/api/referral/claim`).
 *
 * JSX-free for the same reason `billing-client.ts` is: a `*.test.ts` file
 * can import it. `components/ReferralPanel.tsx` is the JSX half.
 */

/**
 * The code format, as `worker/referral.ts` issues it: 8 characters from an
 * alphabet without 0, O, 1, I or L.
 *
 * A copy rather than an import, because nothing in the browser bundle reaches
 * into the Worker's source. `referral-client.test.ts` holds the two to the
 * same answers, so a change to either fails there rather than turning into a
 * link the builder silently ignores.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/**
 * A code in its stored form, or null.
 *
 * The same leniency the Worker's `normaliseCode` has (case, spaces and
 * hyphens), and the same strictness: anything else is null, never a guess.
 * Checked here as well as on the Worker so that whatever sits in a URL is
 * reduced to eight known characters before it is stored, sent or shown.
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

/** The query parameter a referral link carries, here and on vibld.com. */
export const REF_PARAM = 'ref';

/**
 * Where an arriving code waits until the account exists to claim it.
 *
 * `localStorage` rather than `sessionStorage`: signing up can leave the tab
 * (an emailed verification link opens a new one), and a code that did not
 * survive that would be lost for exactly the people who just followed it.
 * It is removed once the claim has an answer.
 */
export const REFERRAL_STORAGE_KEY = 'vibld.referral-code';

/** The slice of `Storage` used here, so a test can pass a map. */
export type ReferralStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

/** `localStorage`, or null where reading it throws (a sandbox, a privacy mode). */
export function referralStorage(): ReferralStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Keep the code a link arrived with, if it arrived on a page that takes one.
 *
 * `/` and the sign-up form only: those are where a shared link lands, and a
 * `ref` on any other path is not a referral link. An unreadable code is
 * ignored rather than stored, and does not replace a readable one already
 * kept. Returns what was kept, for a caller that wants to know.
 */
export function captureReferral(
  location: { pathname: string; search: string },
  storage: ReferralStorage | null,
): string | null {
  if (location.pathname !== '/' && !isSignUpPath(location.pathname)) {
    return null;
  }
  const code = readReferralCode(
    new URLSearchParams(location.search).get(REF_PARAM),
  );
  if (code === null || storage === null) return null;
  try {
    storage.setItem(REFERRAL_STORAGE_KEY, code);
  } catch {
    // A full or refused store. The link still worked as a link; the
    // referral is the part that is lost, and nothing on screen depends on it.
    return null;
  }
  return code;
}

/**
 * What claiming the kept code came to.
 *
 * - `none`: there was no code to claim.
 * - `sent`: the Worker answered. Whether it recorded the attribution is not
 *   said, by design (`handleReferralClaim`), and the code is gone either way.
 * - `kept`: no answer yet (not signed in, a network failure, a Worker
 *   error), so the code stays for the next page load to try again.
 */
export type ClaimOutcome = 'none' | 'sent' | 'kept';

/**
 * Claim the kept code for the signed-in account, once.
 *
 * Every refusal is quiet. The Worker answers the same 200 whether the code
 * was unknown, the account's own, already superseded by an earlier claim,
 * or too late because a purchase has started, and there is nothing for the
 * person who just signed up to do about any of them. A 400 is the Worker
 * rejecting the request itself, which trying again cannot change, so it
 * also ends the attempt.
 */
export async function claimStoredReferral(
  storage: ReferralStorage | null,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<ClaimOutcome> {
  if (storage === null) return 'none';
  let stored: string | null;
  try {
    stored = storage.getItem(REFERRAL_STORAGE_KEY);
  } catch {
    return 'none';
  }
  if (stored === null) return 'none';
  const code = readReferralCode(stored);
  if (code === null) {
    // Not something this code wrote. Dropped rather than sent.
    forget(storage);
    return 'none';
  }

  const token = await getToken();
  // Under Clerk no token means not signed in yet. Under the owner's
  // password or Cloudflare Access there never is one: the session is a
  // cookie the request carries on its own (D123).
  if (!token && AUTH_MODE !== 'owner' && AUTH_MODE !== 'access') return 'kept';

  let response: Response;
  try {
    response = await fetchImpl('/api/referral/claim', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ code }),
    });
  } catch {
    return 'kept';
  }
  if (response.ok || response.status === 400) {
    forget(storage);
    return 'sent';
  }
  return 'kept';
}

function forget(storage: ReferralStorage): void {
  try {
    storage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Left in place, it is claimed again next time and refused again. Harmless.
  }
}

/** This account's code and how its referrals are doing. */
export interface ReferralStatus {
  code: string;
  /** The link to share, as the Worker builds it (`referralUrl`). */
  url: string;
  /** Accounts that signed up with this code. */
  referred: number;
  /** Of those, how many have been paid for. */
  paid: number;
  /**
   * Credit this account has been given for referring, net of clawbacks.
   * Optional because a Worker deployed before it was added does not send it,
   * and the panel should then leave the figure out rather than invent one.
   */
  earnedCents?: number;
  rewardCents: { referrer: number; referred: number };
  maxPaidReferrals: number;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Only an absolute http(s) URL is a link worth showing and copying. */
function isShareableUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function toStatus(value: unknown): ReferralStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const reward = body.rewardCents as Record<string, unknown> | undefined;
  const code = readReferralCode(body.code);
  if (
    code === null ||
    !isShareableUrl(body.url) ||
    !isCount(body.referred) ||
    !isCount(body.paid) ||
    typeof reward !== 'object' ||
    reward === null ||
    !isCount(reward.referrer) ||
    !isCount(reward.referred) ||
    !isCount(body.maxPaidReferrals)
  ) {
    return null;
  }
  return {
    code,
    url: body.url,
    referred: body.referred,
    paid: body.paid,
    ...(isCount(body.earnedCents) ? { earnedCents: body.earnedCents } : {}),
    rewardCents: { referrer: reward.referrer, referred: reward.referred },
    maxPaidReferrals: body.maxPaidReferrals,
  };
}

/**
 * This account's referral status, or null.
 *
 * Null for everything that is not a status to show, the way
 * `fetchBillingStatus` is: nobody asked for this panel, so a deployment
 * without referrals, a signed-out caller or a network failure renders
 * nothing rather than an error. A body that does not have the expected
 * shape is also null, so nothing half-formed reaches the screen.
 */
export async function fetchReferralStatus(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<ReferralStatus | null> {
  const token = await getToken();
  let response: Response;
  try {
    response = await fetchImpl('/api/referral/status', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    return toStatus(await response.json());
  } catch {
    return null;
  }
}

/** What both sides get, in one sentence, from the Worker's own figures. */
export function rewardSentence(status: ReferralStatus): string {
  const { referrer, referred } = status.rewardCents;
  const each =
    referrer === referred
      ? `you each get ${formatCredit(referrer)} of build credit`
      : `you get ${formatCredit(referrer)} and they get ${formatCredit(referred)} of build credit`;
  return `When a friend signs up with your link and makes their first payment, ${each}, for up to ${status.maxPaidReferrals} friends.`;
}

/** How this account's referrals are doing, in words. */
export function progressSummary(status: ReferralStatus): string {
  if (status.referred === 0) return 'Nobody has signed up with your link yet.';
  const friends = status.referred === 1 ? 'friend' : 'friends';
  const parts = [
    `${status.referred} ${friends} signed up with your link, ${status.paid} paid.`,
  ];
  if (status.earnedCents !== undefined) {
    parts.push(`You've earned ${formatCredit(status.earnedCents)}.`);
  }
  return parts.join(' ');
}

/**
 * Said once the cap is reached, because from then on the sentence above is
 * no longer true for new sign-ups: a referrer at the cap is paid nothing
 * more, and neither is the friend (`reserveSlot` refuses the payout whole).
 */
export function capNotice(status: ReferralStatus): string | null {
  if (status.paid < status.maxPaidReferrals) return null;
  return `You've reached the limit of ${status.maxPaidReferrals} paid referrals, so new sign-ups with your link earn no credit.`;
}
