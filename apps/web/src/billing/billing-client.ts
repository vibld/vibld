import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/billing/*` endpoints (docs/decisions.md L12-L15,
 * L35-L39).
 *
 * JSX-free for the same reason `remote-provider.ts` and `clerk-token.ts` are
 * (see the latter's own doc comment): this project's test runner strips
 * TypeScript types only and errors on JSX, so anything a `*.test.ts` file
 * might import has to stay clear of it. `components/BillingStatus.tsx` is
 * the JSX half that calls these functions from React.
 */

export type Tier = 'free' | 'build' | 'ship';

/**
 * Where the caller stands with the one-time welcome credit, which since
 * 2026-09-27 waits for a card on file (`worker/signup-credit.ts`).
 */
export type SignupCredit =
  | { state: 'granted'; cents: number }
  | { state: 'needs-card'; cents: number; cardAlreadyUsed: boolean }
  | { state: 'none'; reason: string };

export interface BillingStatus {
  tier: Tier;
  allowanceMicroUsd: number;
  spentMicroUsd: number;
  topupRemainingMicroUsd: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  billingConfigured: boolean;
  /**
   * Optional because a Worker deployed before the card requirement does not
   * send it, and a shell ahead of its Worker should show no offer rather
   * than a wrong one.
   */
  signupCredit?: SignupCredit;
  /**
   * A Free account with no card on file is on a trial rather than the
   * monthly allowance (D159): `allowanceMicroUsd` and `spentMicroUsd` above
   * are the trial's, for the life of the account, and saving a card moves it
   * to `monthlyMicroUsd` a month. `cardAlreadyUsed` says every card it saved
   * was first saved by another account. Absent otherwise, and from a Worker
   * deployed before D159.
   */
  freeTrial?: { cardAlreadyUsed: boolean; monthlyMicroUsd: number };
  /**
   * A lost dispute has this account's paid features refused until an
   * operator lifts it. Optional for the same reason `signupCredit` is.
   */
  suspended?: boolean;
  /**
   * The tier this account's own subscription pays for, apart from any gift
   * (docs/decisions.md D73). Optional for the same reason; absent, `tier`
   * is the subscription's, as it always was.
   */
  planTier?: Tier;
  /**
   * A plan an admin gave this account with no charge, while it is in
   * force, and whether it is the one that decides `tier` above.
   */
  gift?: {
    tier: 'build' | 'ship';
    endsAt: string | null;
    inUse: boolean;
  } | null;
  /**
   * Opt-in auto-reload (D166). Optional for the same reason `signupCredit`
   * is: absent, the panel offers none.
   */
  autoReload?: AutoReloadStatus;
}

/** Why auto-reload turned itself off. */
export type AutoReloadDisabledReason =
  'declined' | 'authentication_required' | 'no_card';

export interface AutoReloadStatus {
  enabled: boolean;
  monthlyCapUsdCents: number;
  card: { brand: string; last4: string } | null;
  disabledReason: AutoReloadDisabledReason | null;
  reloadsThisMonth: number;
}

/** The sentence the panel says when auto-reload turned itself off. */
export function autoReloadOffReason(
  reason: AutoReloadDisabledReason | null,
): string | null {
  switch (reason) {
    case 'declined':
      return 'Auto-reload is off: your card was declined.';
    case 'authentication_required':
      return 'Auto-reload is off: your bank asked to confirm the charge, which cannot happen while you are away.';
    case 'no_card':
      return 'Auto-reload is off: the card it charged is no longer saved.';
    default:
      return null;
  }
}

/**
 * The line that says a plan is gifted and until when, or null when there
 * is no gift in force. Said even where the account also pays for as much,
 * so nobody is surprised when the gift ends and nothing changes, or does.
 */
export function describeGift(status: BillingStatus): string | null {
  const gift = status.gift;
  if (!gift) return null;
  const until = gift.endsAt
    ? `until ${new Date(gift.endsAt).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })}`
    : 'with no end date';
  return `${TIER_LABELS[gift.tier]} plan gifted ${until}${
    gift.inUse ? '' : ', alongside the plan you pay for'
  }.`;
}

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isBillingStatus(value: unknown): value is BillingStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BillingStatus).tier === 'string' &&
    typeof (value as BillingStatus).allowanceMicroUsd === 'number' &&
    typeof (value as BillingStatus).spentMicroUsd === 'number'
  );
}

/**
 * The caller's own tier, this period's usage and top-up credit.
 *
 * `null` covers every case that is not "here is a status to show" -- signed
 * out, not yet configured, an expired session, a network failure -- rather
 * than throwing: unlike a generation request, nobody asked for this, so a
 * widget that renders nothing is the correct outcome, not an error worth
 * surfacing.
 */
export async function fetchBillingStatus(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<BillingStatus | null> {
  let response: Response;
  try {
    response = await fetchImpl('/api/billing/status', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  try {
    const body: unknown = await response.json();
    return isBillingStatus(body) ? body : null;
  } catch {
    return null;
  }
}

export type PurchaseOption =
  | {
      kind: 'subscription';
      tier: 'build' | 'ship';
      interval: 'monthly' | 'annual';
    }
  | { kind: 'topup' };

function bodyFor(option: PurchaseOption): Record<string, unknown> {
  return option.kind === 'topup'
    ? { topup: true }
    : { tier: option.tier, interval: option.interval };
}

/**
 * POST to a billing endpoint that answers `{ url }` -- the Stripe-hosted page
 * to redirect the browser to. Unlike `fetchBillingStatus`, a failure here is
 * the direct result of something the user just clicked, so it throws rather
 * than swallowing the problem.
 */
async function postForRedirect(
  path: string,
  body: Record<string, unknown> | undefined,
  fetchImpl: typeof fetch,
  getToken: () => Promise<string | null>,
): Promise<string> {
  const response = await fetchImpl(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null);
    const message =
      typeof problem === 'object' &&
      problem !== null &&
      typeof (problem as { error?: unknown }).error === 'string'
        ? (problem as { error: string }).error
        : 'The billing request failed. Try again shortly.';
    throw new Error(message);
  }

  const parsed: unknown = await response.json();
  const url =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { url?: unknown }).url
      : undefined;
  if (typeof url !== 'string' || url === '') {
    throw new Error('Billing did not return a redirect URL.');
  }
  return url;
}

/** Start a Checkout Session for a subscription tier or a top-up. Returns the URL to redirect the browser to. */
export function startCheckout(
  option: PurchaseOption,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<string> {
  return postForRedirect(
    '/api/billing/checkout',
    bodyFor(option),
    fetchImpl,
    getToken,
  );
}

/** Open the Stripe-hosted Billing Portal. Returns the URL to redirect the browser to. */
export function openBillingPortal(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<string> {
  return postForRedirect('/api/billing/portal', undefined, fetchImpl, getToken);
}

/**
 * Open the Stripe-hosted page that cancels this account's subscription,
 * which for a monthly plan first offers half off the next month. Returns
 * the URL to redirect the browser to.
 */
export function openCancelPlan(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<string> {
  return postForRedirect('/api/billing/cancel', undefined, fetchImpl, getToken);
}

/**
 * Open the Stripe-hosted page that saves a card for the welcome credit.
 * Returns the URL to redirect the browser to. Nothing is charged there.
 */
export function startCardSetup(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<string> {
  return postForRedirect('/api/billing/card', undefined, fetchImpl, getToken);
}

/**
 * Open the Stripe-hosted page that saves a card for auto-reload (D166):
 * the same page as above, asked for by an account that may already count
 * as having a card but has none Stripe can charge again.
 */
export function startAutoReloadCardSetup(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<string> {
  return postForRedirect(
    '/api/billing/card',
    { purpose: 'auto-reload' },
    fetchImpl,
    getToken,
  );
}

/** What turning auto-reload on or off answered. */
export type AutoReloadResult =
  { ok: true } | { ok: false; error: string; needsCard: boolean };

/**
 * Turn auto-reload on or off, with the monthly cap (D166). A refusal comes
 * back as a value rather than a throw, because one of them (`needsCard`)
 * is a step the panel offers next rather than a failure.
 */
export async function setAutoReload(
  settings: { enabled: boolean; monthlyCapUsdCents: number },
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<AutoReloadResult> {
  const response = await fetchImpl('/api/billing/auto-reload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify(settings),
  });
  if (response.ok) return { ok: true };
  const problem = (await response.json().catch(() => null)) as {
    error?: unknown;
    needsCard?: unknown;
  } | null;
  return {
    ok: false,
    error:
      typeof problem?.error === 'string'
        ? problem.error
        : 'Could not change auto-reload. Try again shortly.',
    needsCard: problem?.needsCard === true,
  };
}

/** Where Stripe sends the browser back to once a card is saved. */
export const CARD_ADDED_PATH = '/billing/card-added';

/**
 * "$1" for a whole-dollar amount of cents, "$2.50" otherwise: the offer is a
 * round figure and reads as one, where a balance readout (`formatUsd`) wants
 * every cent.
 */
export function formatCredit(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * What the builder says about saving a card, if anything: the monthly
 * allowance a Free account on the trial gets for one (D159), and the
 * welcome credit where it is offered too.
 *
 * Said in the same three kinds as the welcome credit alone, below.
 */
function freeTrialPrompt(
  trial: NonNullable<BillingStatus['freeTrial']>,
  credit: SignupCredit | undefined,
  pathname: string,
): { kind: 'offer' | 'card-used' | 'pending'; message: string } {
  const monthly = formatCredit(Math.floor(trial.monthlyMicroUsd / 10_000));
  const welcome =
    credit?.state === 'needs-card' ? formatCredit(credit.cents) : null;
  const offer = welcome
    ? `Add a card to get ${welcome} of free build credit now and ${monthly} every month. You won't be charged.`
    : `Add a card to get ${monthly} of free builds every month. You won't be charged.`;
  // Before the pending note: a reused card may be recorded before the page
  // Stripe returns to has loaded, and its month will never start.
  if (trial.cardAlreadyUsed) {
    return {
      kind: 'card-used',
      message: `That card is already on file for another account. ${offer}`,
    };
  }
  if (pathname === CARD_ADDED_PATH) {
    return {
      kind: 'pending',
      message: `Card saved. Your ${monthly} a month starts once Stripe confirms it, usually within a minute.`,
    };
  }
  return { kind: 'offer', message: offer };
}

/**
 * What the builder says about the welcome credit, if anything.
 *
 * Pure, so the three things it can say are tested without a browser:
 *
 * - `offer`: the account is offered the credit. Saving a card claims it.
 * - `card-used`: the last card it saved had already claimed the credit on
 *   another account, which is why nothing arrived. A different card still
 *   can.
 * - `pending`: Stripe has just sent the browser back with a card saved, and
 *   the webhook that pays has not landed yet. Saying so stops somebody
 *   adding a second card because the first seemed to do nothing.
 *
 * `null` for everything else, including a deployment with no billing, where
 * there is no way to save a card and so nothing honest to offer.
 */
export function signupCreditPrompt(
  status: BillingStatus,
  pathname: string,
): { kind: 'offer' | 'card-used' | 'pending'; message: string } | null {
  const credit = status.signupCredit;
  if (status.billingConfigured && status.freeTrial) {
    return freeTrialPrompt(status.freeTrial, credit, pathname);
  }
  if (!status.billingConfigured || credit?.state !== 'needs-card') {
    return null;
  }
  const amount = formatCredit(credit.cents);
  const offer = `Add a card to get ${amount} of free build credit. You won't be charged.`;
  if (credit.cardAlreadyUsed) {
    return {
      kind: 'card-used',
      message: `That card has already claimed the welcome credit on another account. ${offer}`,
    };
  }
  if (pathname === CARD_ADDED_PATH) {
    return {
      kind: 'pending',
      message: `Card saved. Your ${amount} of build credit appears here once Stripe confirms it, usually within a minute.`,
    };
  }
  return { kind: 'offer', message: offer };
}

/** "$3.20" from 3_200_000 micro-USD -- a readout a human can parse at a glance. */
export function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  build: 'Build',
  ship: 'Ship',
};
