import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Stripe from 'stripe';

import { createCancelSession } from '../worker/billing-checkout.ts';
import { handleBillingCancel } from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { resetClerkKeyCache } from '../worker/clerk-auth.ts';
import {
  PRICE_LOOKUP_KEYS,
  RETENTION_COUPON_ID,
  isMonthlyPlanPrice,
} from '../worker/stripe-client.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Cancelling through vibld, and who is offered half off a month for staying
 * (Chris, 2026-09-28: monthly plans once, annual plans never).
 *
 * Against a Stripe stand-in that records every portal session it is asked
 * for, and against the real schema, so the subscription lookup is the one
 * production runs.
 */

const SCHEMA = schemaSql();
const RETURN_URL = 'https://app.vibld.com/';

interface SubscriptionShape {
  id?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  lookupKey?: string | null;
  interval?: 'month' | 'year';
}

function subscription(shape: SubscriptionShape = {}) {
  return {
    id: shape.id ?? 'sub_1',
    status: shape.status ?? 'active',
    cancel_at_period_end: shape.cancel_at_period_end ?? false,
    cancel_at: shape.cancel_at ?? null,
    items: {
      data: [
        {
          price: {
            id: 'price_1',
            lookup_key:
              shape.lookupKey === undefined
                ? PRICE_LOOKUP_KEYS.buildMonthly
                : shape.lookupKey,
            recurring: { interval: shape.interval ?? 'month' },
          },
        },
      ],
    },
  };
}

interface FakeStripe {
  stripe: Stripe;
  sessions: Record<string, unknown>[];
  retrieved: string[];
}

/**
 * Answers the one subscription read and records every portal session.
 * `refuse` decides, per request, whether Stripe turns the session down.
 */
function fakeStripe(
  live: ReturnType<typeof subscription>,
  refuse: (params: Record<string, unknown>) => Error | null = () => null,
): FakeStripe {
  const sessions: Record<string, unknown>[] = [];
  const retrieved: string[] = [];
  const stripe = {
    subscriptions: {
      retrieve: async (id: string) => {
        retrieved.push(id);
        return live;
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          sessions.push(params);
          const refusal = refuse(params);
          if (refusal) throw refusal;
          return {
            id: `bps_${sessions.length}`,
            url: `https://billing.stripe.com/p/session/${sessions.length}`,
          };
        },
      },
    },
  };
  return { stripe: stripe as unknown as Stripe, sessions, retrieved };
}

/** Stripe's own error for a coupon it has never heard of. */
function noSuchCoupon(): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    message: `No such coupon: '${RETENTION_COUPON_ID}'`,
    param: 'flow_data[subscription_cancel][retention][coupon_offer][coupon]',
  });
}

const withOffer = (params: Record<string, unknown>) =>
  Boolean(
    (params.flow_data as { subscription_cancel?: { retention?: unknown } })
      ?.subscription_cancel?.retention,
  );

async function subscribed(
  db: SqliteD1Database,
  userId: string,
  status = 'active',
): Promise<BillingStore> {
  const store = new BillingStore(db);
  await store.linkCustomer(userId, 'cus_1');
  await store.upsertSubscription({
    stripeSubscriptionId: 'sub_1',
    userId,
    stripeCustomerId: 'cus_1',
    tier: 'build',
    status,
    priceId: 'price_1',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
  return store;
}

describe('which prices are offered the retention coupon', () => {
  it('is the monthly plans, by lookup key and by interval together', () => {
    const price = (lookup_key: string | null, interval: string) => ({
      lookup_key,
      recurring: { interval },
    });
    assert.equal(
      isMonthlyPlanPrice(price(PRICE_LOOKUP_KEYS.buildMonthly, 'month')),
      true,
    );
    assert.equal(
      isMonthlyPlanPrice(price(PRICE_LOOKUP_KEYS.shipMonthly, 'month')),
      true,
    );
    assert.equal(
      isMonthlyPlanPrice(price(PRICE_LOOKUP_KEYS.buildAnnual, 'year')),
      false,
    );
    assert.equal(
      isMonthlyPlanPrice(price(PRICE_LOOKUP_KEYS.shipAnnual, 'year')),
      false,
    );
    // A monthly key on a price that bills yearly is a year's invoice, and
    // half of it is not the offer.
    assert.equal(
      isMonthlyPlanPrice(price(PRICE_LOOKUP_KEYS.buildMonthly, 'year')),
      false,
    );
    // A monthly price nobody named is not one of the plans.
    assert.equal(isMonthlyPlanPrice(price(null, 'month')), false);
    assert.equal(
      isMonthlyPlanPrice({
        lookup_key: PRICE_LOOKUP_KEYS.topup,
        recurring: null,
      }),
      false,
    );
  });
});

describe('opening the cancel flow', () => {
  it('offers a monthly subscriber half off a month', async () => {
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions, retrieved } = fakeStripe(subscription());

    const url = await createCancelSession(stripe, store, 'user_1', RETURN_URL);

    assert.equal(url, 'https://billing.stripe.com/p/session/1');
    assert.deepEqual(retrieved, ['sub_1']);
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0], {
      customer: 'cus_1',
      return_url: RETURN_URL,
      flow_data: {
        type: 'subscription_cancel',
        subscription_cancel: {
          subscription: 'sub_1',
          retention: {
            type: 'coupon_offer',
            coupon_offer: { coupon: RETENTION_COUPON_ID },
          },
        },
        after_completion: {
          type: 'redirect',
          redirect: { return_url: RETURN_URL },
        },
      },
    });
  });

  it('offers the Ship monthly plan the same', async () => {
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions } = fakeStripe(
      subscription({ lookupKey: PRICE_LOOKUP_KEYS.shipMonthly }),
    );
    await createCancelSession(stripe, store, 'user_1', RETURN_URL);
    assert.equal(withOffer(sessions[0]!), true);
  });

  for (const lookupKey of [
    PRICE_LOOKUP_KEYS.buildAnnual,
    PRICE_LOOKUP_KEYS.shipAnnual,
  ]) {
    it(`offers nothing on ${lookupKey}, and still cancels`, async () => {
      const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
      const { stripe, sessions } = fakeStripe(
        subscription({ lookupKey, interval: 'year' }),
      );

      await createCancelSession(stripe, store, 'user_1', RETURN_URL);

      assert.equal(sessions.length, 1);
      const flow = sessions[0]!.flow_data as {
        type: string;
        subscription_cancel: Record<string, unknown>;
      };
      assert.equal(flow.type, 'subscription_cancel');
      assert.deepEqual(flow.subscription_cancel, { subscription: 'sub_1' });
    });
  }

  it('lets a past-due subscriber cancel, since they are still being charged', async () => {
    const store = await subscribed(
      new SqliteD1Database(SCHEMA),
      'user_1',
      'past_due',
    );
    const { stripe, sessions } = fakeStripe(
      subscription({ status: 'past_due' }),
    );
    await createCancelSession(stripe, store, 'user_1', RETURN_URL);
    assert.equal(
      (sessions[0]!.flow_data as { type: string }).type,
      'subscription_cancel',
    );
  });

  it('refuses an account with no subscription, and asks Stripe nothing', async () => {
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    await store.linkCustomer('user_1', 'cus_1');
    const { stripe, sessions, retrieved } = fakeStripe(subscription());

    await assert.rejects(
      createCancelSession(stripe, store, 'user_1', RETURN_URL),
      /No subscription/,
    );
    assert.deepEqual(retrieved, []);
    assert.deepEqual(sessions, []);
  });

  it('refuses a subscription Stripe says has already ended', async () => {
    // The mirror can be a delivery behind; Stripe is asked, and believed.
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions } = fakeStripe(
      subscription({ status: 'canceled' }),
    );
    await assert.rejects(
      createCancelSession(stripe, store, 'user_1', RETURN_URL),
      /No subscription/,
    );
    assert.deepEqual(sessions, []);
  });

  it('sends a subscription already ending to the plain portal, with no offer', async () => {
    // Nothing is left to cancel, and this is also what a revoke leaves
    // behind: the wind-down schedules the end, so the offer never reaches
    // an account whose access was taken away.
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions } = fakeStripe(
      subscription({ cancel_at_period_end: true }),
    );

    await createCancelSession(stripe, store, 'user_1', RETURN_URL);

    assert.deepEqual(sessions, [{ customer: 'cus_1', return_url: RETURN_URL }]);
  });

  it('opens the flow without the offer when Stripe refuses the coupon', async () => {
    // The coupon not existing yet in this Stripe account must not stop
    // anybody cancelling.
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions } = fakeStripe(subscription(), (params) =>
      withOffer(params) ? noSuchCoupon() : null,
    );
    const logged: unknown[][] = [];
    const was = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    let url: string;
    try {
      url = await createCancelSession(stripe, store, 'user_1', RETURN_URL);
    } finally {
      console.error = was;
    }

    assert.equal(url, 'https://billing.stripe.com/p/session/2');
    assert.equal(sessions.length, 2);
    assert.equal(withOffer(sessions[0]!), true);
    assert.equal(withOffer(sessions[1]!), false);
    assert.equal(
      (sessions[1]!.flow_data as { type: string }).type,
      'subscription_cancel',
    );
    assert.equal(logged.length, 1, 'the refusal was not logged');
    assert.match(String(logged[0]![0]), /retention offer refused/);
  });

  it('does not drop the offer over a failure that is not a refusal', async () => {
    // An outage says nothing about the coupon. Opening the flow without the
    // offer would quietly take away a discount this customer is owed.
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions } = fakeStripe(
      subscription(),
      () =>
        new Stripe.errors.StripeConnectionError({
          message: 'connection reset',
        }),
    );

    await assert.rejects(
      createCancelSession(stripe, store, 'user_1', RETURN_URL),
      /connection reset/,
    );
    assert.equal(sessions.length, 1);
  });

  it('reports a refusal of the plain flow too, rather than looping', async () => {
    const store = await subscribed(new SqliteD1Database(SCHEMA), 'user_1');
    const { stripe, sessions } = fakeStripe(subscription(), () =>
      noSuchCoupon(),
    );
    const was = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        createCancelSession(stripe, store, 'user_1', RETURN_URL),
        /No such coupon/,
      );
    } finally {
      console.error = was;
    }
    assert.equal(sessions.length, 2);
  });
});

describe('POST /api/billing/cancel', () => {
  const ISSUER = 'https://clerk.vibld.com';

  beforeEach(() => resetClerkKeyCache());

  function b64url(bytes: Uint8Array | string): string {
    return (
      typeof bytes === 'string'
        ? Buffer.from(bytes, 'utf8')
        : Buffer.from(bytes)
    ).toString('base64url');
  }

  /** A Clerk session token for `userId`, and the JWKS that verifies it. */
  async function signedIn(userId: string) {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as {
      n: string;
      e: string;
    };
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }))}.${b64url(
      JSON.stringify({
        sub: userId,
        iss: ISSUER,
        exp: now + 3600,
        iat: now - 10,
      }),
    )}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(input),
    );
    return {
      token: `${input}.${b64url(new Uint8Array(signature))}`,
      keys: {
        keys: [{ kid: 'k1', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e }],
      },
    };
  }

  function env(db: SqliteD1Database) {
    return {
      CLERK_FRONTEND_API_URL: ISSUER,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
      DB: db,
    };
  }

  function post(token?: string, method = 'POST'): Request {
    return new Request('https://app.vibld.com/api/billing/cancel', {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  it('answers with the cancel flow for the signed-in account', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await subscribed(db, 'user_1');
    const { token, keys } = await signedIn('user_1');
    const { stripe, sessions } = fakeStripe(subscription());
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(keys))) as unknown as typeof fetch;
    let response: Response;
    try {
      response = await handleBillingCancel(
        post(token),
        env(db),
        'https://app.vibld.com',
        stripe,
      );
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: 'https://billing.stripe.com/p/session/1',
    });
    assert.equal(sessions[0]!.return_url, 'https://app.vibld.com/');
    assert.equal(withOffer(sessions[0]!), true);
  });

  it('answers an account with no subscription the way the portal answers one with no customer', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const { token, keys } = await signedIn('user_1');
    const { stripe } = fakeStripe(subscription());
    const original = globalThis.fetch;
    const was = console.error;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(keys))) as unknown as typeof fetch;
    console.error = () => {};
    let response: Response;
    try {
      response = await handleBillingCancel(
        post(token),
        env(db),
        'https://app.vibld.com',
        stripe,
      );
    } finally {
      globalThis.fetch = original;
      console.error = was;
    }

    assert.equal(response.status, 502);
    assert.match(
      ((await response.json()) as { error: string }).error,
      /Try again shortly/,
    );
  });

  it('refuses anything but POST', async () => {
    const response = await handleBillingCancel(
      post(undefined, 'GET'),
      env(new SqliteD1Database(SCHEMA)),
      'https://app.vibld.com',
    );
    assert.equal(response.status, 405);
  });

  it('says so when billing is not configured', async () => {
    const response = await handleBillingCancel(
      post(),
      {},
      'https://app.vibld.com',
    );
    assert.equal(response.status, 503);
  });

  it('refuses a caller with no session', async () => {
    const response = await handleBillingCancel(
      post(),
      env(new SqliteD1Database(SCHEMA)),
      'https://app.vibld.com',
    );
    assert.equal(response.status, 401);
  });
});
