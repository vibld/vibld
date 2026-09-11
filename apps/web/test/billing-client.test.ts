import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchBillingStatus,
  formatUsd,
  openBillingPortal,
  startCheckout,
} from '../src/billing/billing-client.ts';

const STATUS = {
  tier: 'build',
  allowanceMicroUsd: 10_000_000,
  spentMicroUsd: 3_200_000,
  topupRemainingMicroUsd: 0,
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  hasStripeCustomer: true,
  billingConfigured: true,
};

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('fetchBillingStatus', () => {
  it('sends the Clerk bearer token and returns the parsed status', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify(STATUS), { status: 200 });
    }) as unknown as typeof fetch;

    const status = await fetchBillingStatus(fetchImpl, async () => 'a-token');

    assert.deepEqual(status, STATUS);
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/billing/status');
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer a-token',
    );
  });

  it('omits the Authorization header when signed out', async () => {
    const calls: Array<RequestInit | undefined> = [];
    await fetchBillingStatus(
      (async (_url: string, init?: RequestInit) => {
        calls.push(init);
        return new Response(JSON.stringify(STATUS), { status: 200 });
      }) as unknown as typeof fetch,
      async () => null,
    );
    assert.equal(
      (calls[0]?.headers as Record<string, string>).Authorization,
      undefined,
    );
  });

  it('is null rather than throwing when signed out or unauthorized', async () => {
    assert.equal(
      await fetchBillingStatus(jsonFetch({ error: 'Sign in required.' }, 401)),
      null,
    );
  });

  it('is null when the deployment has no billing endpoint at all', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    assert.equal(await fetchBillingStatus(failing), null);
  });

  it('is null on a response that is not shaped like a status', async () => {
    assert.equal(await fetchBillingStatus(jsonFetch({ ok: true })), null);
  });
});

describe('startCheckout', () => {
  it('posts a subscription purchase and returns the redirect URL', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({ url: 'https://checkout.stripe.com/session_1' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const url = await startCheckout(
      { kind: 'subscription', tier: 'ship', interval: 'annual' },
      fetchImpl,
      async () => 'a-token',
    );

    assert.equal(url, 'https://checkout.stripe.com/session_1');
    const [path, init] = calls[0]!;
    assert.equal(path, '/api/billing/checkout');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      tier: 'ship',
      interval: 'annual',
    });
  });

  it('posts a top-up purchase', async () => {
    const calls: Array<RequestInit | undefined> = [];
    await startCheckout(
      { kind: 'topup' },
      (async (_url: string, init?: RequestInit) => {
        calls.push(init);
        return new Response(JSON.stringify({ url: 'https://x' }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
      async () => 'a-token',
    );
    assert.deepEqual(JSON.parse(String(calls[0]?.body)), { topup: true });
  });

  it('surfaces the server error message rather than failing opaquely', async () => {
    await assert.rejects(
      () =>
        startCheckout(
          { kind: 'topup' },
          jsonFetch(
            { error: 'Billing is not configured for this deployment.' },
            503,
          ),
        ),
      /not configured for this deployment/,
    );
  });

  it('rejects a 200 response that carries no url', async () => {
    await assert.rejects(
      () => startCheckout({ kind: 'topup' }, jsonFetch({})),
      /did not return a redirect URL/,
    );
  });
});

describe('openBillingPortal', () => {
  it('posts with no body and returns the redirect URL', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const url = await openBillingPortal(
      (async (path: string, init?: RequestInit) => {
        calls.push([path, init]);
        return new Response(
          JSON.stringify({ url: 'https://billing.stripe.com/session_1' }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
      async () => 'a-token',
    );

    assert.equal(url, 'https://billing.stripe.com/session_1');
    const [path, init] = calls[0]!;
    assert.equal(path, '/api/billing/portal');
    assert.equal(init?.body, undefined);
  });

  it('surfaces the "no Stripe customer yet" error', async () => {
    await assert.rejects(
      () =>
        openBillingPortal(
          jsonFetch(
            { error: 'Could not open the billing portal. Try again shortly.' },
            502,
          ),
        ),
      /Try again shortly/,
    );
  });
});

describe('formatUsd', () => {
  it('renders micro-USD as a two-decimal dollar string', () => {
    assert.equal(formatUsd(3_200_000), '$3.20');
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(1_000_000), '$1.00');
  });
});
