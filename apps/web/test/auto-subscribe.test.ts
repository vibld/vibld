import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type Stripe from 'stripe';

import {
  autoSubscribeIdempotencyKey,
  maybeAutoSubscribe,
} from '../worker/auto-subscribe.ts';
import type { AutoSubscribeStripe } from '../worker/auto-subscribe.ts';
import { applyStripeEvent } from '../worker/billing-events.ts';
import { handleBillingAutoSubscribe } from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { resetClerkKeyCache } from '../worker/clerk-auth.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Opt-in auto-subscribe (D167), against the real store and schema with
 * Stripe faked at the edge. The questions are the money ones: nothing is
 * started unless asked for, never twice, never for an account already on a
 * plan, and never again once it has been.
 */

const SCHEMA = schemaSql();
const USER = 'user_a';
const CUSTOMER = 'cus_a';
const NOW = Date.parse('2026-10-07T12:00:00.000Z');

async function world(
  settings: { enabled?: boolean } | null = {},
  { admitted = true }: { admitted?: boolean } = {},
) {
  const db = new SqliteD1Database(SCHEMA) as unknown as D1Database;
  const store = new BillingStore(db);
  await store.linkCustomer(USER, CUSTOMER);
  if (admitted) {
    await db
      .prepare(
        `INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
         VALUES (?1, 'a@example.com', 'now', 'now')`,
      )
      .bind(USER)
      .run();
    await db
      .prepare(
        `INSERT INTO access_invites
           (email, invited_by_email, invited_at, redeemed_by_user_id)
         VALUES ('a@example.com', 'admin@vibld.com', 'now', ?1)`,
      )
      .bind(USER)
      .run();
  }
  if (settings) {
    await store.saveAutoSubscribeSettings(USER, {
      enabled: settings.enabled ?? true,
      card: { paymentMethodId: 'pm_card', brand: 'visa', last4: '4242' },
    });
  }
  return { db, store };
}

type Answer =
  { status: Stripe.Subscription.Status } | { throws: Record<string, unknown> };

/** A Stripe that answers each request as told, recording what it was asked. */
function fakeStripe(answers: Answer[] = [{ status: 'active' }]) {
  const created: {
    params: Stripe.SubscriptionCreateParams;
    key?: string;
  }[] = [];
  let found: Stripe.Subscription[] = [];
  let openCheckouts: { id: string; mode: string }[] = [];
  let completeCheckouts: {
    id: string;
    mode: string;
    payment_status: string;
    payment_intent?: { status: string };
  }[] = [];
  let expireFails = false;
  const intents = new Map<string, string>();
  let beforeCheckoutList: (() => void) | undefined;
  const expired: string[] = [];
  const stripe: AutoSubscribeStripe = {
    checkout: {
      sessions: {
        list: (async (params: Stripe.Checkout.SessionListParams) => {
          if (params.status === 'complete') {
            return { data: completeCheckouts, has_more: false };
          }
          beforeCheckoutList?.();
          return { data: openCheckouts, has_more: false };
        }) as never,
        expire: (async (id: string) => {
          if (expireFails) throw new Error('session is complete');
          expired.push(id);
          openCheckouts = openCheckouts.filter((s) => s.id !== id);
          return {};
        }) as never,
      },
    },
    prices: {
      list: (async () => ({ data: [{ id: 'price_build_monthly' }] })) as never,
    },
    paymentIntents: {
      retrieve: (async (id: string) => ({
        id,
        status: intents.get(id) ?? 'processing',
      })) as never,
    },
    subscriptions: {
      create: (async (
        params: Stripe.SubscriptionCreateParams,
        options?: Stripe.RequestOptions,
      ) => {
        created.push({ params, key: options?.idempotencyKey });
        const answer = answers.shift() ?? { status: 'active' };
        if ('throws' in answer) throw answer.throws;
        return subscription(
          (params.metadata || {}) as Record<string, string>,
          answer.status,
        );
      }) as never,
      list: (async () => ({ data: found, has_more: false })) as never,
    },
  };
  return {
    stripe,
    created,
    willFind: (subscriptions: Stripe.Subscription[]) => {
      found = subscriptions;
    },
    expired,
    openCheckout: (id: string, mode = 'subscription') => {
      openCheckouts.push({ id, mode });
    },
    intentIs: (id: string, status: string) => {
      intents.set(id, status);
    },
    paidTopup: (id: string) => {
      completeCheckouts.push({ id, mode: 'payment', payment_status: 'paid' });
    },
    unpaidTopup: (id: string, intentStatus: string) => {
      completeCheckouts.push({
        id,
        mode: 'payment',
        payment_status: 'unpaid',
        payment_intent: { status: intentStatus },
      });
    },
    failExpiring: () => {
      expireFails = true;
    },
    onCheckoutList: (hook: () => void) => {
      beforeCheckoutList = hook;
    },
  };
}

function subscription(
  metadata: Record<string, string | number | null>,
  status: Stripe.Subscription.Status = 'active',
): Stripe.Subscription {
  return {
    id: 'sub_auto',
    object: 'subscription',
    status,
    customer: CUSTOMER,
    cancel_at_period_end: false,
    metadata,
    items: {
      data: [
        {
          current_period_end: Math.floor(NOW / 1000) + 30 * 86_400,
          price: {
            id: 'price_build_monthly',
            lookup_key: 'vibld_build_monthly',
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function deps(
  store: BillingStore,
  stripe: AutoSubscribeStripe,
  {
    left = 500_000,
    now = NOW,
    onFree = true,
  }: { left?: number | null; now?: number; onFree?: boolean } = {},
) {
  return {
    store,
    stripe,
    spendableLeftMicroUsd: async () => left,
    onFree: async () => onFree,
    now,
  };
}

const AUTO_METADATA = (attempt: string) => ({
  vibld_user_id: USER,
  vibld_purpose: 'auto_subscribe',
  vibld_auto_subscribe_attempt: attempt,
});

describe('auto-subscribe', () => {
  it('starts nothing while $1 or more is left, or while off', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { left: 1_000_000 }),
        USER,
      ),
      'skipped',
    );
    const off = await world({ enabled: false });
    assert.equal(
      await maybeAutoSubscribe(deps(off.store, fake.stripe), USER),
      'off',
    );
    const never = await world(null);
    assert.equal(
      await maybeAutoSubscribe(deps(never.store, fake.stripe), USER),
      'off',
    );
    assert.equal(fake.created.length, 0);
  });

  it('starts Build monthly on the chosen card, once, and turns itself off', async () => {
    const { db, store } = await world();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'subscribed',
    );
    const [request] = fake.created;
    assert.equal(request?.params.customer, CUSTOMER);
    assert.deepEqual(request?.params.items, [{ price: 'price_build_monthly' }]);
    assert.equal(request?.params.default_payment_method, 'pm_card');
    assert.equal(request?.params.off_session, true);
    assert.equal(request?.params.payment_behavior, 'error_if_incomplete');
    const attempt = (request?.params.metadata as Record<string, string>)
      .vibld_auto_subscribe_attempt;
    assert.equal(request?.key, autoSubscribeIdempotencyKey(String(attempt)));
    // A purchase started, as the referral barrier counts one.
    assert.notEqual(
      await db
        .prepare(`SELECT 1 FROM billing_purchase_starts WHERE user_id = ?1`)
        .bind(USER)
        .first(),
      null,
    );
    // Mirrored at once, so the next run is held to Build.
    assert.equal((await store.findActiveSubscription(USER))?.tier, 'build');
    const settings = await store.autoSubscribeSettings(USER);
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.disabledReason, 'subscribed');
    assert.equal(settings?.attempt, null);
    // Never again, even turned back on, while the plan is there.
    await store.saveAutoSubscribeSettings(USER, { enabled: true });
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'off',
    );
    assert.equal(fake.created.length, 1);

    // Nor once that plan is canceled and the account is on Free again.
    await db
      .prepare(`UPDATE billing_subscriptions SET status = 'canceled'`)
      .run();
    assert.equal(await store.onFree(USER), true);
    assert.equal(await store.claimAutoSubscribe(USER), undefined);
    assert.equal((await store.autoSubscribeSettings(USER))?.used, true);
    assert.equal(fake.created.length, 1);
  });

  it('lets one of two checks at once start the plan', async () => {
    const { store } = await world();
    const claims = await Promise.all([
      store.claimAutoSubscribe(USER),
      store.claimAutoSubscribe(USER),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
  });

  it('never holds its claim and an auto-reload charge at once', async () => {
    const MONTH = '2026-10';
    const card = { paymentMethodId: 'pm_card', brand: 'visa', last4: '4242' };
    // An auto-reload charge in flight keeps auto-subscribe from claiming.
    const reloading = await world();
    await reloading.store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card,
    });
    assert.ok(await reloading.store.claimAutoReload(USER, MONTH, 1000));
    assert.equal(await reloading.store.claimAutoSubscribe(USER), undefined);
    // And an auto-subscribe attempt keeps auto-reload from claiming.
    const subscribing = await world();
    await subscribing.store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card,
    });
    assert.ok(await subscribing.store.claimAutoSubscribe(USER));
    assert.equal(
      await subscribing.store.claimAutoReload(USER, MONTH, 1000),
      undefined,
    );
  });

  it('starts nothing for an account already on a plan or a gift', async () => {
    const { db, store } = await world();
    await db
      .prepare(
        `INSERT INTO billing_subscriptions
           (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
            price_id, created_at, updated_at)
         VALUES ('sub_old', ?1, ?2, 'build', 'past_due', 'price_x', 'now', 'now')`,
      )
      .bind(USER, CUSTOMER)
      .run();
    assert.equal(await store.claimAutoSubscribe(USER), undefined);

    const gifted = await world();
    await gifted.db
      .prepare(
        `INSERT INTO plan_gifts (id, user_id, tier, ends_at, granted_by, created_at)
         VALUES ('g1', ?1, 'build', '2027-01-01T00:00:00.000Z', 'admin', 'now')`,
      )
      .bind(USER)
      .run();
    assert.equal(
      await gifted.store.claimAutoSubscribe(USER, new Date(NOW).toISOString()),
      undefined,
    );

    const fake = fakeStripe();
    const plan = await world();
    assert.equal(
      await maybeAutoSubscribe(
        deps(plan.store, fake.stripe, { onFree: false }),
        USER,
      ),
      'off',
    );
    assert.equal(fake.created.length, 0);
  });

  it('starts nothing for a banned account, or one the invite gate would not let in', async () => {
    const { db, store } = await world();
    await db
      .prepare(
        `INSERT INTO user_bans (user_id, reason, banned_by, banned_at)
         VALUES (?1, 'abuse', 'admin', 'now')`,
      )
      .bind(USER)
      .run();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'off',
    );
    const uninvited = await world({}, { admitted: false });
    assert.equal(
      await maybeAutoSubscribe(deps(uninvited.store, fake.stripe), USER),
      'off',
    );
    assert.equal(fake.created.length, 0);
  });

  it('turns itself off on a decline, a bank asking to confirm, or a card gone', async () => {
    for (const [thrown, reason] of [
      [{ type: 'StripeCardError', code: 'card_declined' }, 'declined'],
      [
        { type: 'StripeCardError', code: 'authentication_required' },
        'authentication_required',
      ],
      [
        { type: 'StripeInvalidRequestError', code: 'resource_missing' },
        'no_card',
      ],
    ] as const) {
      const { store } = await world();
      const fake = fakeStripe([{ throws: thrown }]);
      assert.equal(
        await maybeAutoSubscribe(deps(store, fake.stripe), USER),
        'failed',
      );
      const settings = await store.autoSubscribeSettings(USER);
      assert.equal(settings?.enabled, false);
      assert.equal(settings?.disabledReason, reason);
      assert.equal(settings?.attempt, null);
      assert.equal(await store.findActiveSubscription(USER), undefined);
    }
  });

  it('asks again with the same key after no answer, and starts one plan', async () => {
    const { store } = await world();
    const fake = fakeStripe([
      { throws: { type: 'StripeConnectionError' } },
      { status: 'active' },
    ]);
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'pending',
    );
    // Too soon to ask again.
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 5 * 60_000 }),
        USER,
      ),
      'skipped',
    );
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 11 * 60_000 }),
        USER,
      ),
      'subscribed',
    );
    assert.equal(fake.created.length, 2);
    assert.equal(fake.created[0]?.key, fake.created[1]?.key);
  });

  it('settles a plan Stripe started before asking again', async () => {
    const { store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoSubscribe(deps(store, fake.stripe), USER);
    const attempt = (await store.autoSubscribeSettings(USER))?.attempt?.id;
    fake.willFind([subscription(AUTO_METADATA(attempt!))]);
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 11 * 60_000 }),
        USER,
      ),
      'subscribed',
    );
    assert.equal(fake.created.length, 1);
    assert.equal(
      (await store.autoSubscribeSettings(USER))?.disabledReason,
      'subscribed',
    );
  });

  it('settles a plan it started that has been canceled since', async () => {
    const { store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoSubscribe(deps(store, fake.stripe), USER);
    const attempt = (await store.autoSubscribeSettings(USER))?.attempt?.id;
    fake.willFind([subscription(AUTO_METADATA(attempt!), 'canceled')]);
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 11 * 60_000 }),
        USER,
      ),
      'subscribed',
    );
    const settings = await store.autoSubscribeSettings(USER);
    assert.equal(settings?.attempt, null);
    assert.equal(settings?.used, true);
    assert.equal(fake.created.length, 1);
  });

  it('starts nothing while Stripe has a plan D1 has not heard of yet', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    // Bought through Checkout a moment ago; its webhook has not landed.
    fake.willFind([
      { ...subscription({ vibld_user_id: USER }), id: 'sub_checkout' },
    ]);
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'off',
    );
    assert.equal(fake.created.length, 0);
    const settings = await store.autoSubscribeSettings(USER);
    assert.equal(settings?.attempt, null);
    assert.equal(settings?.used, false);
    // Mirrored, so D1 now knows the account is on a plan.
    assert.equal(await store.onFree(USER), false);
  });

  it('starts nothing when a top-up lands during the Stripe reads', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    // Out before the claim and after it; topped up by the third read, the
    // one after the Stripe reads.
    const lefts = [500_000, 500_000, 5_000_000];
    assert.equal(
      await maybeAutoSubscribe(
        {
          ...deps(store, fake.stripe),
          spendableLeftMicroUsd: async () => lefts.shift() ?? 5_000_000,
        },
        USER,
      ),
      'skipped',
    );
    assert.equal(fake.created.length, 0);
    assert.equal((await store.autoSubscribeSettings(USER))?.attempt, null);
  });

  it('leaves no referral barrier when turned off during the Stripe reads', async () => {
    const { db, store } = await world();
    const fake = fakeStripe();
    let reads = 0;
    assert.equal(
      await maybeAutoSubscribe(
        {
          ...deps(store, fake.stripe),
          // The third read is the one after the Stripe reads.
          spendableLeftMicroUsd: async () => {
            if (++reads === 3) {
              await store.saveAutoSubscribeSettings(USER, { enabled: false });
            }
            return 500_000;
          },
        },
        USER,
      ),
      'off',
    );
    assert.equal(fake.created.length, 0);
    const barrier = await db
      .prepare(`SELECT 1 FROM billing_purchase_starts WHERE user_id = ?1`)
      .bind(USER)
      .first();
    assert.equal(barrier, null);
  });

  it('expires open plan and top-up Checkouts before starting the plan', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    fake.openCheckout('cs_plan');
    fake.openCheckout('cs_topup', 'payment');
    fake.openCheckout('cs_card', 'setup');
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'subscribed',
    );
    assert.deepEqual(fake.expired, ['cs_plan', 'cs_topup']);
    assert.equal(fake.created.length, 1);
  });

  it('finds a plan Checkout completed just before its sessions were read', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    // Completed as auto-subscribe went to expire it: no longer open, and
    // its subscription now exists.
    fake.onCheckoutList(() =>
      fake.willFind([
        { ...subscription({ vibld_user_id: USER }), id: 'sub_checkout' },
      ]),
    );
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'off',
    );
    assert.equal(fake.created.length, 0);
  });

  it('waits for a paid top-up the webhook has not credited yet', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    fake.paidTopup('cs_topup');
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'pending',
    );
    assert.equal(fake.created.length, 0);
    // Credited, the balance read decides as before.
    await store.recordTopup('cs_topup', USER, CUSTOMER, 1000);
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 31 * 60_000 }),
        USER,
      ),
      'subscribed',
    );
  });

  it('waits for a top-up paid by bank debit while it settles, not one that failed', async () => {
    const settling = await world();
    const fake = fakeStripe();
    fake.unpaidTopup('cs_debit', 'processing');
    assert.equal(
      await maybeAutoSubscribe(deps(settling.store, fake.stripe), USER),
      'pending',
    );
    assert.equal(fake.created.length, 0);

    const failed = await world();
    const other = fakeStripe();
    other.unpaidTopup('cs_debit', 'requires_payment_method');
    assert.equal(
      await maybeAutoSubscribe(deps(failed.store, other.stripe), USER),
      'subscribed',
    );
  });

  it('waits for an unsettled top-up however old, until credited or failed', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    // Marked by the webhook long ago; its session is past the lookback.
    await store.recordUnsettledTopup('cs_old_debit', USER, 'pi_old_debit');
    fake.intentIs('pi_old_debit', 'succeeded');
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'pending',
    );
    assert.equal(fake.created.length, 0);

    // A failed one is not waited for.
    const failed = await world();
    await failed.store.recordUnsettledTopup('cs_debit', USER, 'pi_failed');
    fake.intentIs('pi_failed', 'requires_payment_method');
    assert.equal(
      await maybeAutoSubscribe(deps(failed.store, fake.stripe), USER),
      'subscribed',
    );

    // Nor one credited since.
    await store.recordTopup('cs_old_debit', USER, CUSTOMER, 1000);
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 31 * 60_000 }),
        USER,
      ),
      'subscribed',
    );
  });

  it('starts nothing while an open plan Checkout cannot be expired', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    fake.openCheckout('cs_plan');
    fake.failExpiring();
    assert.equal(
      await maybeAutoSubscribe(deps(store, fake.stripe), USER),
      'pending',
    );
    assert.equal(fake.created.length, 0);
    assert.notEqual((await store.autoSubscribeSettings(USER))?.attempt, null);
  });

  it('refuses turning it on again in the write, once a plan was started', async () => {
    const { db, store } = await world({ enabled: false });
    await db
      .prepare(
        `UPDATE billing_auto_subscribe
            SET stripe_subscription_id = 'sub_done',
                disabled_reason = 'subscribed'`,
      )
      .run();
    assert.equal(
      await store.saveAutoSubscribeSettings(USER, { enabled: true }),
      false,
    );
    const settings = await store.autoSubscribeSettings(USER);
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.disabledReason, 'subscribed');
    // Turning it off still saves.
    assert.equal(
      await store.saveAutoSubscribeSettings(USER, { enabled: false }),
      true,
    );
  });

  it('stamps the dispatch when it is sent, not when it was claimed', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    // The Stripe reads before the send took 15 minutes.
    const sentAt = NOW + 15 * 60_000;
    assert.equal(
      await maybeAutoSubscribe(
        { ...deps(store, fake.stripe), clock: () => sentAt },
        USER,
      ),
      'pending',
    );
    const row = await db
      .prepare(
        `SELECT attempt_claimed_at, attempt_dispatched_at
           FROM billing_auto_subscribe WHERE user_id = ?1`,
      )
      .bind(USER)
      .first<{ attempt_claimed_at: string; attempt_dispatched_at: string }>();
    assert.equal(row?.attempt_claimed_at, new Date(NOW).toISOString());
    assert.equal(row?.attempt_dispatched_at, new Date(sentAt).toISOString());
  });

  it('keeps an attempt another check may still be sending, then gives way to a new save', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoSubscribe(deps(store, fake.stripe), USER);
    // Another check is sending it again at 11 minutes when the setting is
    // saved again with another card.
    await db
      .prepare(`UPDATE billing_auto_subscribe SET attempt_dispatched_at = ?1`)
      .bind(new Date(NOW + 11 * 60_000).toISOString())
      .run();
    await store.saveAutoSubscribeSettings(USER, {
      enabled: true,
      card: { paymentMethodId: 'pm_other', brand: 'visa', last4: '1111' },
    });
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 12 * 60_000 }),
        USER,
      ),
      'pending',
    );
    assert.equal(fake.created.length, 1);
    // Once that request can no longer be in flight, the new save decides,
    // under a new key.
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 22 * 60_000 }),
        USER,
      ),
      'subscribed',
    );
    assert.equal(fake.created[1]?.params.default_payment_method, 'pm_other');
    assert.notEqual(fake.created[1]?.key, fake.created[0]?.key);
  });

  it('gives up an attempt never answered once its key has lapsed, leaving it on', async () => {
    const { store } = await world();
    const fake = fakeStripe([
      { throws: { type: 'StripeConnectionError' } },
      { status: 'active' },
    ]);
    await maybeAutoSubscribe(deps(store, fake.stripe), USER);
    // Between the key lapsing and the hour after, nothing is decided.
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 23.5 * 3_600_000 }),
        USER,
      ),
      'pending',
    );
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 25 * 3_600_000 }),
        USER,
      ),
      'subscribed',
    );
    assert.notEqual(fake.created[1]?.key, fake.created[0]?.key);
  });

  it('decides nothing while it cannot tell whether Stripe started the plan', async () => {
    const { store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoSubscribe(deps(store, fake.stripe), USER);
    fake.stripe.subscriptions.list = (async () => ({
      data: [subscription({})],
      has_more: true,
    })) as never;
    assert.equal(
      await maybeAutoSubscribe(
        deps(store, fake.stripe, { now: NOW + 11 * 60_000 }),
        USER,
      ),
      'pending',
    );
    assert.equal(fake.created.length, 1);
  });

  it('is turned off by the webhook for the plan it started', async () => {
    const { store } = await world();
    await applyStripeEvent(store, {
      id: 'evt_sub',
      type: 'customer.subscription.created',
      data: { object: subscription(AUTO_METADATA('a1')) },
    } as never);
    const settings = await store.autoSubscribeSettings(USER);
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.disabledReason, 'subscribed');
    // A plan bought through Checkout leaves it as it is.
    const other = await world();
    await applyStripeEvent(other.store, {
      id: 'evt_sub',
      type: 'customer.subscription.created',
      data: { object: subscription({ vibld_user_id: USER }) },
    } as never);
    assert.equal(
      (await other.store.autoSubscribeSettings(USER))?.enabled,
      true,
    );
  });
});

describe('POST /api/billing/auto-subscribe', () => {
  const ISSUER = 'https://clerk.vibld.com';
  const OWNER = 'user_owner';

  beforeEach(() => resetClerkKeyCache());

  const b64url = (bytes: Uint8Array | string) =>
    (typeof bytes === 'string'
      ? Buffer.from(bytes, 'utf8')
      : Buffer.from(bytes)
    ).toString('base64url');

  async function signedIn() {
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
        sub: OWNER,
        iss: ISSUER,
        sid: 'sess_test',
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

  async function post(
    body: unknown,
    {
      cards = [{ id: 'pm_new', card: { brand: 'mastercard', last4: '5555' } }],
      onPlan = false,
      subscribeNow,
      before,
      gate,
    }: {
      cards?: { id: string; card: { brand: string; last4: string } }[];
      /** A subscription row, in this status ('active' for true). */
      onPlan?: boolean | string;
      subscribeNow?: (userId: string) => Promise<unknown>;
      before?: (db: D1Database, store: BillingStore) => Promise<void>;
      gate?: () => Promise<Response | undefined>;
    } = {},
  ) {
    const db = new SqliteD1Database(SCHEMA) as unknown as D1Database;
    const store = new BillingStore(db);
    await store.linkCustomer(OWNER, CUSTOMER);
    await before?.(db, store);
    if (onPlan) {
      await db
        .prepare(
          `INSERT INTO billing_subscriptions
             (stripe_subscription_id, user_id, stripe_customer_id, tier,
              status, price_id, created_at, updated_at)
           VALUES ('sub_x', ?1, ?2, 'build', ?3, 'price_x', 'now', 'now')`,
        )
        .bind(OWNER, CUSTOMER, onPlan === true ? 'active' : onPlan)
        .run();
    }
    const { token, keys } = await signedIn();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(keys))) as unknown as typeof fetch;
    try {
      const response = await handleBillingAutoSubscribe(
        new Request('https://app.vibld.com/api/billing/auto-subscribe', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
        {
          CLERK_FRONTEND_API_URL: ISSUER,
          DB: db,
          STRIPE_SECRET_KEY: 'sk_test_fake',
          STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
        },
        subscribeNow,
        {
          customers: {
            retrieve: (async () => ({
              invoice_settings: { default_payment_method: null },
            })) as never,
            listPaymentMethods: (async () => ({ data: cards })) as never,
          } as never,
        },
        gate,
      );
      return { response, store };
    } finally {
      globalThis.fetch = original;
    }
  }

  it('refuses a body without enabled', async () => {
    const { response } = await post({});
    assert.equal(response.status, 400);
  });

  it('asks for a card when none can be charged', async () => {
    const { response, store } = await post({ enabled: true }, { cards: [] });
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { needsCard: boolean }).needsCard,
      true,
    );
    assert.equal(await store.autoSubscribeSettings(OWNER), undefined);
  });

  it('is not offered to an account already on a plan', async () => {
    const { response, store } = await post({ enabled: true }, { onPlan: true });
    assert.equal(response.status, 409);
    assert.equal(await store.autoSubscribeSettings(OWNER), undefined);
  });

  const refusedByGate = () =>
    Promise.resolve(new Response('not invited', { status: 403 }));

  it('does not let an account the gate refuses turn it on', async () => {
    const { response, store } = await post(
      { enabled: true },
      { gate: refusedByGate },
    );
    assert.equal(response.status, 403);
    assert.equal(await store.autoSubscribeSettings(OWNER), undefined);
  });

  it('lets an account the gate refuses turn it off', async () => {
    const { response, store } = await post(
      { enabled: false },
      {
        gate: refusedByGate,
        before: async (_db, billing) => {
          await billing.saveAutoSubscribeSettings(OWNER, { enabled: true });
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await store.autoSubscribeSettings(OWNER))?.enabled, false);
  });

  it('is not offered while a past_due subscription can still be billed', async () => {
    const { response, store } = await post(
      { enabled: true },
      { onPlan: 'past_due' },
    );
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { alreadySubscribed: boolean })
        .alreadySubscribed,
      true,
    );
    assert.equal(await store.autoSubscribeSettings(OWNER), undefined);
  });

  it('is not turned on again once it has started a plan', async () => {
    const asked: string[] = [];
    const { response, store } = await post(
      { enabled: true },
      {
        before: async (db) => {
          await db
            .prepare(
              `INSERT INTO billing_auto_subscribe
                 (user_id, enabled, disabled_reason, stripe_subscription_id,
                  updated_at)
               VALUES (?1, 0, 'subscribed', 'sub_done', 'now')`,
            )
            .bind(OWNER)
            .run();
        },
        subscribeNow: async (userId) => {
          asked.push(userId);
        },
      },
    );
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { alreadyUsed: boolean }).alreadyUsed,
      true,
    );
    assert.deepEqual(asked, []);
    const settings = await store.autoSubscribeSettings(OWNER);
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.used, true);
  });

  it('turns on with the card found, and asks at once', async () => {
    const asked: string[] = [];
    const { response, store } = await post(
      { enabled: true },
      {
        subscribeNow: async (userId) => {
          asked.push(userId);
        },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enabled: true,
      card: { brand: 'mastercard', last4: '5555' },
      disabledReason: null,
    });
    assert.deepEqual(asked, [OWNER]);
    assert.equal(
      (await store.autoSubscribeSettings(OWNER))?.paymentMethodId,
      'pm_new',
    );
  });

  it('turns off without asking Stripe', async () => {
    const { response, store } = await post(
      { enabled: false },
      { cards: [], onPlan: true },
    );
    assert.equal(response.status, 200);
    assert.equal((await store.autoSubscribeSettings(OWNER))?.enabled, false);
  });
});
