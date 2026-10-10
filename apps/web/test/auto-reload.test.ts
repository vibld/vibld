import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type Stripe from 'stripe';

import {
  AUTO_RELOAD_THRESHOLD_MICRO_USD,
  autoReloadIdempotencyKey,
  maybeAutoReload,
  resolveReusableCard,
  validAutoReloadCap,
} from '../worker/auto-reload.ts';
import type { AutoReloadStripe } from '../worker/auto-reload.ts';
import { applyStripeEvent } from '../worker/billing-events.ts';
import type { ClawbackDeps } from '../worker/billing-events.ts';
import { handleBillingAutoReload } from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { resetClerkKeyCache } from '../worker/clerk-auth.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Opt-in auto-reload (D166), against the real store and schema with Stripe
 * faked at the edge. The questions are the money ones: nothing is charged
 * unless asked for, never twice at once, never past the cap, and a charge
 * is credited, refunded and disputed exactly as a Checkout top-up is.
 */

const SCHEMA = schemaSql();
const USER = 'user_a';
const CUSTOMER = 'cus_a';
const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const MONTH = '2026-10';

async function world(
  settings: { enabled?: boolean; cap?: number } | null = {},
  { admitted = true }: { admitted?: boolean } = {},
) {
  const db = new SqliteD1Database(SCHEMA) as unknown as D1Database;
  const store = new BillingStore(db);
  await store.linkCustomer(USER, CUSTOMER);
  if (admitted) {
    // Let in as the invite gate lets an account in: by the address it signed
    // in with, invited and redeemed by it.
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
    await store.saveAutoReloadSettings(USER, {
      enabled: settings.enabled ?? true,
      monthlyCapUsdCents: settings.cap ?? 3000,
      card: { paymentMethodId: 'pm_card', brand: 'visa', last4: '4242' },
    });
  }
  return { db, store };
}

type Answer =
  | { status: Stripe.PaymentIntent.Status; code?: string }
  | { throws: Record<string, unknown> };

/** A Stripe that answers each charge as told, recording what it was asked. */
function fakeStripe(answers: Answer[] = [{ status: 'succeeded' }]) {
  const created: { params: Stripe.PaymentIntentCreateParams; key?: string }[] =
    [];
  const searched: string[] = [];
  let found: Stripe.PaymentIntent[] = [];
  const stripe: AutoReloadStripe = {
    prices: {
      list: (async () => ({
        data: [{ id: 'price_topup', unit_amount: 1000 }],
      })) as never,
    },
    paymentIntents: {
      create: (async (
        params: Stripe.PaymentIntentCreateParams,
        options?: Stripe.RequestOptions,
      ) => {
        created.push({ params, key: options?.idempotencyKey });
        const answer = answers.shift() ?? { status: 'succeeded' };
        if ('throws' in answer) throw answer.throws;
        return intent(params, answer.status, answer.code);
      }) as never,
      list: (async (params: { customer: string }) => {
        searched.push(params.customer);
        return { data: found, has_more: false };
      }) as never,
    },
  };
  return {
    stripe,
    created,
    searched,
    willFind: (intents: Stripe.PaymentIntent[]) => {
      found = intents;
    },
  };
}

function intent(
  params: Stripe.PaymentIntentCreateParams,
  status: Stripe.PaymentIntent.Status,
  code?: string,
): Stripe.PaymentIntent {
  return {
    id: 'pi_auto',
    object: 'payment_intent',
    status,
    customer: params.customer,
    amount: params.amount,
    amount_received: status === 'succeeded' ? params.amount : 0,
    latest_charge: 'ch_auto',
    created: Math.floor(NOW / 1000),
    metadata: params.metadata,
    last_payment_error: code ? { code } : null,
  } as unknown as Stripe.PaymentIntent;
}

function deps(
  store: BillingStore,
  stripe: AutoReloadStripe,
  leftMicroUsd: number | null = 500_000,
  now = NOW,
) {
  const cleared: string[][] = [];
  return {
    cleared,
    deps: {
      store,
      stripe,
      spendableLeftMicroUsd: async () => leftMicroUsd,
      onPurchaseCleared: async (_userId: string, fundedBy: string[]) => {
        cleared.push(fundedBy);
      },
      now,
    },
  };
}

const creditCents = async (store: BillingStore) =>
  Math.round((await store.totalSpendableCreditMicroUsd(USER)) / 10_000);

async function rows(db: D1Database) {
  return (
    await db
      .prepare(
        `SELECT state, seq, payment_intent_id, failure_code
           FROM billing_auto_reload_attempts ORDER BY seq`,
      )
      .all<{
        state: string;
        seq: number;
        payment_intent_id: string | null;
        failure_code: string | null;
      }>()
  ).results;
}

describe('the claim', () => {
  it('lets one of two claims made at once through', async () => {
    const { store } = await world();
    const claims = await Promise.all([
      store.claimAutoReload(USER, MONTH, 1000),
      store.claimAutoReload(USER, MONTH, 1000),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
  });

  it('stops at the cap, counts no failed charge, and starts again next month', async () => {
    const { store } = await world({ cap: 2000 });
    const first = await store.claimAutoReload(USER, MONTH, 1000);
    await store.settleAutoReloadAttempt(
      first!,
      'succeeded',
      'pi_1',
      null,
      MONTH,
    );
    const second = await store.claimAutoReload(USER, MONTH, 1000);
    await store.settleAutoReloadAttempt(second!, 'failed', 'pi_2', 'x');
    const third = await store.claimAutoReload(USER, MONTH, 1000);
    assert.ok(third, 'a failed charge does not use up the cap');
    await store.settleAutoReloadAttempt(
      third!,
      'succeeded',
      'pi_3',
      null,
      MONTH,
    );
    assert.equal(await store.claimAutoReload(USER, MONTH, 1000), undefined);
    assert.ok(await store.claimAutoReload(USER, '2026-11', 1000));
  });

  it('counts a charge in the month Stripe made it, not the month it was claimed', async () => {
    const { store } = await world({ cap: 1000 });
    // Claimed on the last evening of October, charged after midnight.
    const late = await store.claimAutoReload(USER, MONTH, 1000);
    await store.settleAutoReloadAttempt(
      late!,
      'succeeded',
      'pi_1',
      null,
      '2026-11',
    );
    assert.equal(await store.claimAutoReload(USER, '2026-11', 1000), undefined);
    assert.equal(await store.autoReloadsIn(USER, '2026-11'), 1);
    assert.equal(await store.autoReloadsIn(USER, MONTH), 0);
  });

  it('claims nothing while off, never set, or without a card', async () => {
    const off = await world({ enabled: false });
    assert.equal(await off.store.claimAutoReload(USER, MONTH, 1000), undefined);
    const never = await world(null);
    assert.equal(
      await never.store.claimAutoReload(USER, MONTH, 1000),
      undefined,
    );
  });

  it('refuses a cap that is not whole top-ups from $10 to $100', async () => {
    for (const cents of [900, 10100, 1500, 0]) {
      assert.equal(validAutoReloadCap(cents), false, String(cents));
    }
    for (const cents of [1000, 3000, 10000]) {
      assert.equal(validAutoReloadCap(cents), true, String(cents));
    }
    const { db } = await world(null);
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO billing_auto_reload
             (user_id, enabled, monthly_cap_usd_cents, updated_at)
           VALUES ('u', 1, 1500, 'now')`,
        )
        .run(),
    );
  });
});

describe('a reload', () => {
  it('charges nothing while $1 or more is left', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    const { deps: d } = deps(
      store,
      fake.stripe,
      AUTO_RELOAD_THRESHOLD_MICRO_USD,
    );
    assert.equal(await maybeAutoReload(d, USER), 'skipped');
    assert.equal(fake.created.length, 0);
  });

  it('waits while a run is in flight, whose reservation counts at its worst', async () => {
    const { db, store } = await world();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, null).deps, USER),
      'skipped',
    );
    assert.equal(fake.created.length, 0);
    assert.equal((await rows(db)).length, 0);
  });

  it('charges nothing when it was never turned on', async () => {
    const { store } = await world(null);
    const fake = fakeStripe();
    const { deps: d } = deps(store, fake.stripe, 0);
    assert.equal(await maybeAutoReload(d, USER), 'off');
    assert.equal(fake.created.length, 0);
  });

  it('charges the chosen card off session, once, and credits the top-up', async () => {
    const { db, store } = await world();
    const fake = fakeStripe();
    const { deps: d, cleared } = deps(store, fake.stripe);
    assert.equal(await maybeAutoReload(d, USER), 'credited');

    assert.equal(fake.created.length, 1);
    const [{ params, key }] = fake.created as [(typeof fake.created)[number]];
    assert.equal(params.amount, 1000, 'the amount is the Stripe price');
    assert.equal(params.customer, CUSTOMER);
    assert.equal(params.payment_method, 'pm_card');
    assert.equal(params.off_session, true);
    assert.equal(params.confirm, true);
    const [attempt] = await rows(db);
    assert.equal(attempt?.state, 'succeeded');
    assert.equal(attempt?.payment_intent_id, 'pi_auto');
    assert.match(key ?? '', /^auto-reload:/);

    assert.equal(await creditCents(store), 800);
    assert.deepEqual(cleared, [['pi_auto', 'ch_auto']]);
    const started = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM billing_purchase_starts WHERE user_id = ?1`,
      )
      .bind(USER)
      .first<{ n: number }>();
    assert.equal(
      started?.n,
      1,
      'the referral barrier closes as for a Checkout',
    );
  });

  it('turns itself off on a decline, and on a bank asking to confirm', async () => {
    for (const [answer, reason] of [
      [
        { throws: { type: 'StripeCardError', code: 'card_declined' } },
        'declined',
      ],
      [
        {
          throws: { type: 'StripeCardError', code: 'authentication_required' },
        },
        'authentication_required',
      ],
      [{ status: 'requires_action' }, 'authentication_required'],
      [
        {
          throws: {
            type: 'StripeInvalidRequestError',
            code: 'resource_missing',
          },
        },
        'no_card',
      ],
    ] as [Answer, string][]) {
      const { db, store } = await world();
      const fake = fakeStripe([answer]);
      const { deps: d } = deps(store, fake.stripe);
      assert.equal(await maybeAutoReload(d, USER), 'failed', reason);
      const settings = await store.autoReloadSettings(USER);
      assert.equal(settings?.enabled, false);
      assert.equal(settings?.disabledReason, reason);
      assert.equal((await rows(db))[0]?.state, 'failed');
      assert.equal(await creditCents(store), 0);
      // And it does not try again.
      assert.equal(await maybeAutoReload(d, USER), 'off');
      assert.equal(fake.created.length, 1);
    }
  });

  it('asks again with the same key after no answer, and charges once', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([
      { throws: { type: 'StripeConnectionError' } },
      { status: 'succeeded' },
    ]);
    const first = deps(store, fake.stripe);
    assert.equal(await maybeAutoReload(first.deps, USER), 'pending');
    assert.equal((await rows(db))[0]?.state, 'pending');

    // Still in flight a minute later: nobody else charges.
    const soon = deps(store, fake.stripe, 0, NOW + 60_000);
    assert.equal(await maybeAutoReload(soon.deps, USER), 'skipped');
    assert.equal(fake.created.length, 1);

    const later = deps(store, fake.stripe, 0, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'credited');
    assert.equal(fake.created.length, 2);
    assert.equal(fake.created[0]?.key, fake.created[1]?.key);
    assert.equal((await rows(db)).length, 1);
    assert.equal(await creditCents(store), 800);
  });

  it('neither asks again nor gives up in the hour after the key stops being used', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    // A check that began asking at 22h59 may still be in flight: nothing
    // may claim a second charge under a new key until it has finished.
    const between = deps(store, fake.stripe, 0, NOW + 23.5 * 3_600_000);
    assert.equal(await maybeAutoReload(between.deps, USER), 'pending');
    assert.equal(fake.created.length, 1);
    assert.equal((await rows(db)).length, 1);
    assert.equal((await rows(db))[0]?.state, 'pending');
  });

  it('gives up a charge never made once the key has lapsed, and claims the next', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    const late = deps(store, fake.stripe, 0, NOW + 24 * 3_600_000);
    assert.equal(await maybeAutoReload(late.deps, USER), 'credited');
    assert.equal(fake.searched.length, 1);
    const [abandoned, next] = await rows(db);
    assert.equal(abandoned?.state, 'failed');
    assert.equal(abandoned?.failure_code, 'abandoned');
    assert.equal(next?.state, 'succeeded');
    assert.notEqual(fake.created[0]?.key, fake.created[1]?.key);
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
  });

  it('settles a charge Stripe made before asking again', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    const claimed = await store.pendingAutoReload(USER);
    fake.willFind([
      intent(
        {
          amount: 1000,
          currency: 'usd',
          customer: CUSTOMER,
          metadata: {
            vibld_user_id: USER,
            vibld_purpose: 'auto_reload',
            vibld_auto_reload_attempt: String(claimed?.id),
          },
        },
        'succeeded',
      ),
    ]);
    const later = deps(store, fake.stripe, 0, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'credited');
    assert.equal(fake.created.length, 1);
    assert.equal((await rows(db))[0]?.state, 'succeeded');
  });

  it('asks nothing again once a top-up bought meanwhile left enough', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    const later = deps(store, fake.stripe, 9_000_000, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'skipped');
    assert.equal(fake.created.length, 1);
    const [attempt] = await rows(db);
    assert.equal(attempt?.state, 'failed');
    assert.equal(attempt?.failure_code, 'not_due');
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
  });

  it('asks nothing again while a run is in flight', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    const later = deps(store, fake.stripe, null, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'skipped');
    assert.equal(fake.created.length, 1);
    assert.equal((await rows(db))[0]?.state, 'pending');
  });

  it('charges an account let in again by a new invite, or by an open deployment', async () => {
    const { db, store } = await world();
    await db.prepare(`UPDATE access_invites SET revoked_at = 'now'`).run();
    assert.equal(await store.autoReloadBarred(USER), true);
    // An open deployment admits it whatever its invites say.
    assert.equal(
      await store.autoReloadBarred(USER, { inviteGated: false }),
      false,
    );
    const open = deps(store, fakeStripe().stripe, 0);
    assert.equal(
      await maybeAutoReload(
        { ...open.deps, access: { inviteGated: false } },
        USER,
      ),
      'credited',
    );
    // A new invite, redeemed under the address it now signs in with.
    await db
      .prepare(
        `INSERT INTO access_invites
           (email, invited_by_email, invited_at, redeemed_by_user_id)
         VALUES ('b@example.com', 'admin@vibld.com', 'now', ?1)`,
      )
      .bind(USER)
      .run();
    await db.prepare(`UPDATE accounts SET email = 'b@example.com'`).run();
    assert.equal(await store.autoReloadBarred(USER), false);
    assert.notEqual(
      await store.claimAutoReload(USER, '2026-11', 1000),
      undefined,
    );
  });

  it('charges nothing for an account the invite gate would not let in now', async () => {
    // Never invited: turned on while the deployment was open.
    const never = await world({}, { admitted: false });
    assert.equal(await never.store.autoReloadBarred(USER), true);
    assert.equal(
      await never.store.claimAutoReload(USER, MONTH, 1000),
      undefined,
    );
    // Signed in since under an address nobody invited: the old invite still
    // stands, but it is not the one the gate would find.
    const moved = await world();
    await moved.db
      .prepare(`UPDATE accounts SET email = 'elsewhere@example.com'`)
      .run();
    assert.equal(await moved.store.autoReloadBarred(USER), true);
  });

  it('decides nothing while it cannot tell whether Stripe made the charge', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    // More of the customer's charges than are read before giving up.
    const other = intent(
      { amount: 1000, currency: 'usd', customer: CUSTOMER, metadata: {} },
      'succeeded',
    );
    fake.stripe.paymentIntents.list = (async () => ({
      data: [other],
      has_more: true,
    })) as never;
    const later = deps(store, fake.stripe, 0, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'pending');
    assert.equal(fake.created.length, 1);
    assert.equal((await rows(db))[0]?.state, 'pending');
  });

  it('charges an admin whose invite was withdrawn', async () => {
    const { db, store } = await world();
    await db.prepare(`UPDATE access_invites SET revoked_at = 'now'`).run();
    await db.prepare(`UPDATE accounts SET email = 'Boss@Example.com'`).run();
    const admitted = { inviteGated: true, admins: ['boss@example.com'] };
    assert.equal(await store.autoReloadBarred(USER), true);
    assert.equal(await store.autoReloadBarred(USER, admitted), false);
    const d = deps(store, fakeStripe().stripe, 0);
    assert.equal(
      await maybeAutoReload({ ...d.deps, access: admitted }, USER),
      'credited',
    );
  });

  it('charges nothing once the invite the account signed in with is withdrawn', async () => {
    const { db, store } = await world();
    await db.prepare(`UPDATE access_invites SET revoked_at = 'now'`).run();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, 0).deps, USER),
      'off',
    );
    assert.equal(await store.claimAutoReload(USER, MONTH, 1000), undefined);
    assert.equal(fake.created.length, 0);
  });

  it('charges nothing when the setting was saved again while the claim was being made', async () => {
    const { db, store } = await world();
    const fake = fakeStripe();
    const { deps: d } = deps(store, fake.stripe);
    let reads = 0;
    d.spendableLeftMicroUsd = async () => {
      // The second read is the one after the claim: a cap lowered then.
      if (++reads === 2) {
        await store.saveAutoReloadSettings(USER, {
          enabled: true,
          monthlyCapUsdCents: 1000,
        });
      }
      return 500_000;
    };
    assert.equal(await maybeAutoReload(d, USER), 'skipped');
    assert.equal(fake.created.length, 0);
    assert.equal((await rows(db))[0]?.failure_code, 'superseded');
  });

  it('closes no referral barrier for an attempt that gave way before Stripe', async () => {
    const { store } = await world();
    const fake = fakeStripe();
    const { deps: d } = deps(store, fake.stripe);
    let reads = 0;
    d.spendableLeftMicroUsd = async () => {
      if (++reads === 2) {
        await store.saveAutoReloadSettings(USER, {
          enabled: true,
          monthlyCapUsdCents: 1000,
        });
      }
      return 500_000;
    };
    assert.equal(await maybeAutoReload(d, USER), 'skipped');
    assert.equal(fake.created.length, 0);
    assert.equal(await store.hasBegunAPurchase(USER), false);
  });

  it('stamps the dispatch with the time it was sent, not the time the check began', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    const sent = NOW + 15 * 60_000;
    const { deps: d } = deps(store, fake.stripe);
    assert.equal(
      await maybeAutoReload({ ...d, clock: () => sent }, USER),
      'pending',
    );
    const row = await db
      .prepare(`SELECT dispatched_at FROM billing_auto_reload_attempts`)
      .first<{ dispatched_at: string }>();
    assert.equal(row?.dispatched_at, new Date(sent).toISOString());
    assert.equal(await store.hasBegunAPurchase(USER), true);
  });

  it('charges nothing when credit arrived while the claim was being made', async () => {
    const { db, store } = await world();
    const fake = fakeStripe();
    const answers = [500_000, 9_000_000];
    const { deps: d } = deps(store, fake.stripe);
    d.spendableLeftMicroUsd = async () => answers.shift() ?? 9_000_000;
    assert.equal(await maybeAutoReload(d, USER), 'skipped');
    assert.equal(fake.created.length, 0);
    const [attempt] = await rows(db);
    assert.equal(attempt?.state, 'failed');
    assert.equal(attempt?.failure_code, 'not_due');
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
  });

  it('gives way to a setting saved while its answer is outstanding, under a new key', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    // Saved again with another card while the first answer is outstanding.
    await store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card: { paymentMethodId: 'pm_other', brand: 'visa', last4: '1111' },
    });
    // And the purchase barrier lost, as a Worker stopped after the claim
    // would leave it.
    await db.prepare(`DELETE FROM billing_purchase_starts`).run();
    const later = deps(store, fake.stripe, 0, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'credited');
    // The new save decides: the old attempt ends, and the charge is a new
    // request, with its own key, for the card saved last.
    assert.equal(fake.created[1]?.params.payment_method, 'pm_other');
    assert.notEqual(fake.created[1]?.key, fake.created[0]?.key);
    const [old, next] = await rows(db);
    assert.equal(old?.failure_code, 'superseded');
    assert.equal(next?.state, 'succeeded');
    const barrier = await db
      .prepare(`SELECT COUNT(*) AS n FROM billing_purchase_starts`)
      .first<{ n: number }>();
    assert.equal(barrier?.n, 1);
  });

  it('keeps a superseded attempt while another check may still be sending it', async () => {
    const { db, store } = await world();
    const fake = fakeStripe([{ throws: { type: 'StripeConnectionError' } }]);
    await maybeAutoReload(deps(store, fake.stripe).deps, USER);
    // Another check is resuming it at 11 minutes, and is sending its
    // request under the same key, when the setting is saved again.
    await db
      .prepare(`UPDATE billing_auto_reload_attempts SET dispatched_at = ?1`)
      .bind(new Date(NOW + 11 * 60_000).toISOString())
      .run();
    await store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card: { paymentMethodId: 'pm_other', brand: 'visa', last4: '1111' },
    });
    const soon = deps(store, fake.stripe, 0, NOW + 12 * 60_000);
    assert.equal(await maybeAutoReload(soon.deps, USER), 'pending');
    // Nothing new was asked, and the attempt still holds the claim.
    assert.equal(fake.created.length, 1);
    assert.equal((await rows(db)).length, 1);
    assert.ok(await store.pendingAutoReload(USER));
    // Once that request can no longer be in flight, the new save decides.
    const later = deps(store, fake.stripe, 0, NOW + 22 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'credited');
    assert.equal(fake.created[1]?.params.payment_method, 'pm_other');
    const [old] = await rows(db);
    assert.equal(old?.failure_code, 'superseded');
  });

  it('charges nothing once the account has asked to be deleted', async () => {
    const { db, store } = await world();
    await db
      .prepare(
        `INSERT INTO account_deletions
           (user_id, tombstone, requested_at, purge_after)
         VALUES (?1, 'tomb_a', ?2, ?2)`,
      )
      .bind(USER, new Date(NOW).toISOString())
      .run();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, 0).deps, USER),
      'off',
    );
    assert.equal(await store.claimAutoReload(USER, MONTH, 1000), undefined);
    assert.equal(fake.created.length, 0);
  });

  it('stops at the cap', async () => {
    const { store } = await world({ cap: 1000 });
    const fake = fakeStripe();
    const { deps: d } = deps(store, fake.stripe, 0);
    assert.equal(await maybeAutoReload(d, USER), 'credited');
    assert.equal(await maybeAutoReload(d, USER), 'capped');
    assert.equal(fake.created.length, 1);
    assert.equal(await store.autoReloadsIn(USER, MONTH), 1);
  });

  it('charges nothing for a suspended account', async () => {
    const { db, store } = await world();
    await db
      .prepare(
        `INSERT INTO billing_clawbacks
           (id, user_id, cause, stripe_event_id, stripe_charge_id,
            stripe_object_id, kind, charge_usd_cents, reversed_usd_cents,
            credit_removed_usd_cents, credit_shortfall_usd_cents,
            credit_granted_at, stripe_subscription_id, suspends, created_at)
         VALUES ('dispute:dp', ?1, 'dispute', 'evt', 'ch', 'cs', 'topup',
                 1000, 1000, 800, 0, 'now', NULL, 1, 'now')`,
      )
      .bind(USER)
      .run();
    assert.equal(await store.isSuspended(USER), true);
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, 0).deps, USER),
      'off',
    );
    assert.equal(fake.created.length, 0);
    // Refused in the claim's own statement too, for a suspension that lands
    // between the first read and the claim.
    assert.equal(await store.claimAutoReload(USER, MONTH, 1000), undefined);
  });

  it('charges nothing for a banned account', async () => {
    const { db, store } = await world();
    await db
      .prepare(
        `INSERT INTO user_bans (user_id, banned_at, banned_by, reason)
         VALUES (?1, 'now', 'admin@vibld.com', 'abuse')`,
      )
      .bind(USER)
      .run();
    const fake = fakeStripe();
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, 0).deps, USER),
      'off',
    );
    assert.equal(await store.claimAutoReload(USER, MONTH, 1000), undefined);
    assert.equal(fake.created.length, 0);
    // Lifted, it charges again.
    await db.prepare(`UPDATE user_bans SET lifted_at = 'later'`).run();
    assert.notEqual(await store.claimAutoReload(USER, MONTH, 1000), undefined);
  });

  it('asks nothing again once the cap was lowered under it', async () => {
    const { db, store } = await world({ cap: 2000 });
    const fake = fakeStripe([
      { status: 'succeeded' },
      { throws: { type: 'StripeConnectionError' } },
    ]);
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, 0).deps, USER),
      'credited',
    );
    assert.equal(
      await maybeAutoReload(deps(store, fake.stripe, 0, NOW + 1).deps, USER),
      'pending',
    );
    await db
      .prepare(`UPDATE billing_auto_reload SET monthly_cap_usd_cents = 1000`)
      .run();
    const later = deps(store, fake.stripe, 0, NOW + 11 * 60_000);
    assert.equal(await maybeAutoReload(later.deps, USER), 'capped');
    assert.equal(fake.created.length, 2);
    const [, second] = await rows(db);
    assert.equal(second?.state, 'failed');
    assert.equal(second?.failure_code, 'superseded');
  });

  it('turns off on a decline about the setting the claim read, whatever its clock', async () => {
    const { store } = await world();
    // Claimed with a time read before the setting was saved again.
    await store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card: { paymentMethodId: 'pm_new', brand: 'visa', last4: '1111' },
    });
    const attempt = await store.claimAutoReload(
      USER,
      MONTH,
      1000,
      new Date(0).toISOString(),
    );
    assert.ok(attempt);
    await store.disableAutoReload(USER, 'declined', attempt);
    assert.equal((await store.autoReloadSettings(USER))?.enabled, false);
  });

  it('names the idempotency key by the attempt alone', () => {
    assert.equal(autoReloadIdempotencyKey('a1'), 'auto-reload:a1');
  });
});

/** A PaymentIntent event, as auto-reload's charges carry it or not. */
function intentEvent(
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
  metadata: Record<string, string>,
  over: Record<string, unknown> = {},
) {
  return {
    id: `evt_${type}`,
    type,
    data: {
      object: {
        id: 'pi_auto',
        object: 'payment_intent',
        customer: CUSTOMER,
        amount_received: type === 'payment_intent.succeeded' ? 1000 : 0,
        latest_charge: 'ch_auto',
        metadata,
        last_payment_error:
          type === 'payment_intent.payment_failed'
            ? { code: 'card_declined' }
            : null,
        ...over,
      },
    },
  } as never;
}

const AUTO_METADATA = {
  vibld_user_id: USER,
  vibld_purpose: 'auto_reload',
  vibld_auto_reload_attempt: 'a1',
  vibld_credit_usd_cents: '800',
};

describe('the webhook', () => {
  it('credits an auto-reload charge once, however often it arrives', async () => {
    const { store } = await world();
    for (let n = 0; n < 2; n++) {
      assert.equal(
        await applyStripeEvent(
          store,
          intentEvent('payment_intent.succeeded', AUTO_METADATA),
        ),
        'applied',
      );
    }
    assert.equal(await creditCents(store), 800);
  });

  it('writes nothing for any other charge', async () => {
    const { db, store } = await world();
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.succeeded', { vibld_user_id: USER }),
    );
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.payment_failed', { vibld_user_id: USER }),
    );
    assert.equal(await creditCents(store), 0);
    const payments = await db
      .prepare(`SELECT COUNT(*) AS n FROM billing_payments`)
      .first<{ n: number }>();
    assert.equal(payments?.n, 0);
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
  });

  it('turns auto-reload off on a failed charge still waiting on its answer', async () => {
    const { store } = await world();
    const attempt = await store.claimAutoReload(USER, MONTH, 1000);
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.payment_failed', {
        ...AUTO_METADATA,
        vibld_auto_reload_attempt: attempt!,
      }),
    );
    const settings = await store.autoReloadSettings(USER);
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.disabledReason, 'declined');
  });

  it('turns auto-reload off on the retry when the first answer failed to write', async () => {
    const { db, store } = await world();
    const attempt = await store.claimAutoReload(USER, MONTH, 1000);
    const event = intentEvent('payment_intent.payment_failed', {
      ...AUTO_METADATA,
      vibld_auto_reload_attempt: attempt!,
    });
    // D1 fails partway through the first delivery's writes.
    const real = db.batch.bind(db);
    db.batch = (async (statements: D1PreparedStatement[]) => {
      db.batch = real;
      return real([...statements, db.prepare('SELECT * FROM no_such_table')]);
    }) as typeof db.batch;
    await assert.rejects(applyStripeEvent(store, event));
    // Neither write landed: the attempt still waits on its answer.
    assert.equal((await store.pendingAutoReload(USER))?.id, attempt);
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
    // Stripe delivers it again.
    await applyStripeEvent(store, event);
    assert.equal(await store.pendingAutoReload(USER), undefined);
    const settings = await store.autoReloadSettings(USER);
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.disabledReason, 'declined');
  });

  it('leaves auto-reload on for a failure about a charge made before it was set again', async () => {
    const { store } = await world();
    // Claimed, then left waiting on the bank ("processing").
    const attempt = await store.claimAutoReload(
      USER,
      MONTH,
      1000,
      '2026-01-01T00:00:00.000Z',
    );
    // The account turns it off and on again with another card.
    await store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card: { paymentMethodId: 'pm_other', brand: 'visa', last4: '1111' },
    });
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.payment_failed', {
        ...AUTO_METADATA,
        vibld_auto_reload_attempt: attempt!,
      }),
    );
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
  });

  it('counts a charge Stripe made for an attempt given up on', async () => {
    const { db, store } = await world();
    const attempt = await store.claimAutoReload(USER, MONTH, 1000);
    await store.settleAutoReloadAttempt(attempt!, 'failed', null, 'superseded');
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.succeeded', {
        ...AUTO_METADATA,
        vibld_auto_reload_attempt: attempt!,
      }),
    );
    const [row] = await rows(db);
    assert.equal(row?.state, 'succeeded');
    assert.equal(await store.autoReloadsIn(USER, MONTH), 1);
  });

  it('leaves auto-reload on for a late failure about a charge already answered', async () => {
    const { store } = await world();
    const attempt = await store.claimAutoReload(USER, MONTH, 1000);
    // The charge's own reply was the decline; the account then turned
    // auto-reload back on.
    await store.settleAutoReloadAttempt(attempt!, 'failed', 'pi_1', 'declined');
    await store.disableAutoReload(USER, 'declined');
    await store.saveAutoReloadSettings(USER, {
      enabled: true,
      monthlyCapUsdCents: 3000,
      card: { paymentMethodId: 'pm_other', brand: 'visa', last4: '1111' },
    });
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.payment_failed', {
        ...AUTO_METADATA,
        vibld_auto_reload_attempt: attempt!,
      }),
    );
    assert.equal((await store.autoReloadSettings(USER))?.enabled, true);
  });

  it('takes the credit back on a refund of the charge, as for a Checkout top-up', async () => {
    const { store } = await world();
    await applyStripeEvent(
      store,
      intentEvent('payment_intent.succeeded', AUTO_METADATA),
    );
    assert.equal(await creditCents(store), 800);
    const clawback: ClawbackDeps = {
      creditSpentMicroUsd: async () => 0,
      cancelSubscription: async () => 'cancelled',
      resolveInvoice: async () => null,
    };
    const outcome = await applyStripeEvent(
      store,
      {
        id: 'evt_refund',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_auto',
            object: 'charge',
            customer: CUSTOMER,
            payment_intent: 'pi_auto',
            amount: 1000,
            amount_refunded: 1000,
            refunded: true,
          },
        },
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      clawback,
    );
    assert.equal(outcome, 'applied');
    assert.equal(await creditCents(store), 0);
  });
});

describe('the card it charges', () => {
  it('prefers the default card, else the newest saved', async () => {
    const card = (id: string, last4: string) => ({
      id,
      card: { brand: 'visa', last4 },
    });
    const withDefault = await resolveReusableCard(
      {
        customers: {
          retrieve: (async () => ({
            invoice_settings: { default_payment_method: card('pm_d', '1111') },
          })) as never,
          listPaymentMethods: (async () => ({
            data: [card('pm_n', '2222')],
          })) as never,
        },
      },
      CUSTOMER,
    );
    assert.equal(withDefault?.paymentMethodId, 'pm_d');
    const without = await resolveReusableCard(
      {
        customers: {
          retrieve: (async () => ({
            invoice_settings: { default_payment_method: null },
          })) as never,
          listPaymentMethods: (async () => ({
            data: [card('pm_n', '2222')],
          })) as never,
        },
      },
      CUSTOMER,
    );
    assert.deepEqual(without, {
      paymentMethodId: 'pm_n',
      brand: 'visa',
      last4: '2222',
    });
  });
});

describe('POST /api/billing/auto-reload', () => {
  const ISSUER = 'https://clerk.vibld.com';
  const OWNER = 'user_owner';

  beforeEach(() => resetClerkKeyCache());

  const b64url = (bytes: Uint8Array | string) =>
    (typeof bytes === 'string'
      ? Buffer.from(bytes, 'utf8')
      : Buffer.from(bytes)
    ).toString('base64url');

  /** A Clerk session token for OWNER, and the JWKS that verifies it. */
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
    cards: { id: string; card: { brand: string; last4: string } }[] = [
      { id: 'pm_new', card: { brand: 'mastercard', last4: '5555' } },
    ],
    reloadNow?: () => Promise<'credited'>,
    gate?: () => Promise<Response | undefined>,
    before?: (store: BillingStore) => Promise<void>,
  ) {
    const db = new SqliteD1Database(SCHEMA) as unknown as D1Database;
    const store = new BillingStore(db);
    await store.linkCustomer(OWNER, CUSTOMER);
    await before?.(store);
    const { token, keys } = await signedIn();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(keys))) as unknown as typeof fetch;
    try {
      const response = await handleBillingAutoReload(
        new Request('https://app.vibld.com/api/billing/auto-reload', {
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
        reloadNow,
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

  it('refuses a cap that is not whole top-ups', async () => {
    const { response } = await post({
      enabled: true,
      monthlyCapUsdCents: 1500,
    });
    assert.equal(response.status, 400);
  });

  it('asks for a card when none can be charged', async () => {
    const { response, store } = await post({ enabled: true }, []);
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { needsCard: boolean }).needsCard,
      true,
    );
    assert.equal(await store.autoReloadSettings(OWNER), undefined);
  });

  it('turns on at $30 by default with the card found, and reloads at once', async () => {
    let asked = 0;
    const { response, store } = await post(
      { enabled: true },
      undefined,
      async () => {
        asked++;
        return 'credited';
      },
    );
    assert.equal(response.status, 200);
    const settings = await store.autoReloadSettings(OWNER);
    assert.equal(settings?.enabled, true);
    assert.equal(settings?.monthlyCapUsdCents, 3000);
    assert.equal(settings?.paymentMethodId, 'pm_new');
    assert.equal(asked, 1);
  });

  it('turns off without asking Stripe', async () => {
    const { response, store } = await post({ enabled: false }, []);
    assert.equal(response.status, 200);
    assert.equal((await store.autoReloadSettings(OWNER))?.enabled, false);
  });

  const refusedByGate = () =>
    Promise.resolve(new Response('not invited', { status: 403 }));

  it('does not let an account the gate refuses turn it on', async () => {
    let asked = 0;
    const { response, store } = await post(
      { enabled: true },
      undefined,
      async () => {
        asked++;
        return 'credited';
      },
      refusedByGate,
    );
    assert.equal(response.status, 403);
    assert.equal(await store.autoReloadSettings(OWNER), undefined);
    assert.equal(asked, 0);
  });

  it('lets an account the gate refuses turn it off', async () => {
    const { response, store } = await post(
      { enabled: false },
      [],
      undefined,
      refusedByGate,
      (billing) =>
        billing.saveAutoReloadSettings(OWNER, {
          enabled: true,
          monthlyCapUsdCents: 3000,
          card: { paymentMethodId: 'pm_card', brand: 'visa', last4: '4242' },
        }),
    );
    assert.equal(response.status, 200);
    assert.equal((await store.autoReloadSettings(OWNER))?.enabled, false);
  });
});
