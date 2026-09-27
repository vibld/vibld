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

export interface BillingStatus {
  tier: Tier;
  allowanceMicroUsd: number;
  spentMicroUsd: number;
  topupRemainingMicroUsd: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  billingConfigured: boolean;
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

/** "$3.20" from 3_200_000 micro-USD -- a readout a human can parse at a glance. */
export function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  build: 'Build',
  ship: 'Ship',
};
