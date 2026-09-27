/**
 * The two things a signed-in account does with referrals: see its own code,
 * and claim the one it arrived with.
 */
import { BillingStore } from './billing-store.ts';
import { ReferralStore } from './referral-store.ts';
import {
  DEFAULT_REWARD_CENTS,
  MAX_PAID_REFERRALS,
  decideAttribution,
  referralUrl,
} from './referral.ts';
import type { Principal } from './principal.ts';

export interface ReferralEnv {
  DB?: D1Database;
  /** Where a shared link points. The builder's own origin. */
  VIBLD_APP_ORIGIN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Where a referral link should send people.
 *
 * Derived from the request when nothing is configured, so preview and
 * production each produce links back to themselves rather than a preview
 * handing out production links or the reverse.
 */
function appOrigin(request: Request, env: ReferralEnv): string {
  const configured = env.VIBLD_APP_ORIGIN?.trim();
  if (configured) return configured;
  return new URL(request.url).origin;
}

/**
 * This account's referral code, issuing one on first look.
 *
 * Lazy on purpose: an account that never opens this surface never gets a row,
 * which keeps the table the size of the people actually sharing rather than
 * the size of the user list.
 */
export async function handleReferralStatus(
  request: Request,
  env: ReferralEnv,
  principal: Principal,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!env.DB) {
    return json({ error: 'Referrals are not configured here.' }, 503);
  }

  const store = new ReferralStore(env.DB);
  const code = await store.codeFor(principal.userId);
  const summary = await store.summaryFor(principal.userId);

  return json({
    code,
    url: referralUrl(appOrigin(request, env), code),
    referred: summary.referred,
    paid: summary.paid,
    // Both stated rather than left for the client to know: the reward is a
    // deployment setting, and the cap is the reason an honest advocate stops
    // earning. Somebody who has hit it should be able to see why.
    rewardCents: DEFAULT_REWARD_CENTS,
    maxPaidReferrals: MAX_PAID_REFERRALS,
  });
}

/**
 * Claim the code this account arrived with.
 *
 * Answers the same way whatever happened. The caller is the person who just
 * signed up, none of the refusals is theirs to fix, and the difference
 * between "no such code" and "that is your own" is precisely what an attacker
 * probes for. The server knows which it was; the response does not say.
 */
export async function handleReferralClaim(
  request: Request,
  env: ReferralEnv,
  principal: Principal,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.DB) {
    return json({ error: 'Referrals are not configured here.' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const rawCode =
    typeof body === 'object' && body !== null
      ? (body as { code?: unknown }).code
      : undefined;

  const store = new ReferralStore(env.DB);
  const billing = new BillingStore(env.DB);
  const existing = await store.attributionFor(principal.userId);
  const decision = decideAttribution({
    rawCode: typeof rawCode === 'string' ? rawCode : null,
    referredUserId: principal.userId,
    ownerOfCode: await store.ownerOf(
      typeof rawCode === 'string' ? rawCode : null,
    ),
    existing: existing !== undefined,
    purchaseStarted: await billing.hasBegunAPurchase(principal.userId),
  });

  if (decision.ok) {
    // The write can still decline, and silently: it carries the purchase
    // barrier itself, so a Checkout that completed between the check above
    // and this line loses the race here. Logged as its own outcome rather
    // than assumed to have succeeded, because "the rule said yes and nothing
    // was written" is exactly the kind of thing that goes unnoticed.
    const written = await store.attribute(
      principal.userId,
      decision.referrerUserId,
      decision.code,
    );
    if (!written) {
      console.log('referral claim not recorded', principal.userId);
    }
  } else {
    // Logged, never returned. A support question about a link that did not
    // work needs an answer, and the person asking is not the attacker.
    console.log('referral claim refused', principal.userId, decision.reason);
  }

  return json({ recorded: true });
}
