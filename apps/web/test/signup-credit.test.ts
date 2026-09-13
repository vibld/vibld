import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import {
  DEFAULT_SIGNUP_CREDIT_USD_CENTS,
  SIGNUP_GRANT_ACTOR,
  grantSignupCreditOnce,
  signupCreditCents,
  signupGrantId,
} from '../worker/signup-credit.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA =
  readFileSync(
    join(import.meta.dirname, '..', 'migrations', '0002_billing.sql'),
    'utf8',
  ) +
  readFileSync(
    join(import.meta.dirname, '..', 'migrations', '0004_admin_credits.sql'),
    'utf8',
  );

const newStore = () => new BillingStore(new SqliteD1Database(SCHEMA));

describe('signupCreditCents', () => {
  it('defaults to a dollar', () => {
    assert.equal(signupCreditCents({}), DEFAULT_SIGNUP_CREDIT_USD_CENTS);
    assert.equal(signupCreditCents({}), 100);
  });

  it('honours an explicit amount, including zero', () => {
    assert.equal(
      signupCreditCents({ VIBLD_SIGNUP_CREDIT_USD_CENTS: '250' }),
      250,
    );
    assert.equal(signupCreditCents({ VIBLD_SIGNUP_CREDIT_USD_CENTS: '0' }), 0);
  });

  it('falls back to the default on an unreadable value, never to zero', () => {
    // The safe direction is generous. Wrong the other way, every new account
    // silently stops receiving what it was promised and nothing reports it.
    for (const raw of ['', '   ', 'free', '1.5', '-100', 'NaN']) {
      assert.equal(
        signupCreditCents({ VIBLD_SIGNUP_CREDIT_USD_CENTS: raw }),
        DEFAULT_SIGNUP_CREDIT_USD_CENTS,
        JSON.stringify(raw),
      );
    }
  });
});

describe('grantSignupCreditOnce', () => {
  it('grants a dollar, spendable, on the first call', async () => {
    const store = newStore();
    assert.equal(await grantSignupCreditOnce(store, 'user_a', {}), true);

    // Asserted through the balance the rest of the app actually reads, not
    // through the row: a grant that does not reach spendable credit has not
    // given anybody anything. 100 cents is 1_000_000 micro-USD.
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 1_000_000);
  });

  it('grants exactly once however many times it is called', async () => {
    // Both /api/billing/status and /api/plan call this on every request, so
    // "once" has to survive repetition rather than depend on a caller
    // remembering. The deterministic id is what makes that true.
    const store = newStore();
    for (let i = 0; i < 5; i += 1) {
      await grantSignupCreditOnce(store, 'user_b', {});
    }
    assert.equal(await store.totalSpendableCreditMicroUsd('user_b'), 1_000_000);

    const credits = await store.listAdminCredits('user_b');
    assert.equal(credits.length, 1);
    assert.equal(credits[0]!.id, signupGrantId('user_b'));
    assert.equal(credits[0]!.grantedByEmail, SIGNUP_GRANT_ACTOR);
  });

  it('survives concurrent first requests without double-granting', async () => {
    // Two tabs opening at once is the ordinary case, not an exotic one.
    const store = newStore();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        grantSignupCreditOnce(store, 'user_c', {}),
      ),
    );
    assert.equal(await store.totalSpendableCreditMicroUsd('user_c'), 1_000_000);
  });

  it('grants nothing when the amount is zero', async () => {
    const store = newStore();
    const granted = await grantSignupCreditOnce(store, 'user_d', {
      VIBLD_SIGNUP_CREDIT_USD_CENTS: '0',
    });
    assert.equal(granted, false);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_d'), 0);
    assert.deepEqual(await store.listAdminCredits('user_d'), []);
  });

  it('keeps each user to their own grant', async () => {
    const store = newStore();
    await grantSignupCreditOnce(store, 'user_e', {});
    await grantSignupCreditOnce(store, 'user_f', {});
    assert.equal(await store.totalSpendableCreditMicroUsd('user_e'), 1_000_000);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_f'), 1_000_000);
  });

  it('never throws when the store fails, so the request it rode in on survives', async () => {
    // A user who misses their dollar on this request gets it on the next one.
    // Failing the whole billing-status or plan request instead would turn a
    // bookkeeping problem into an outage.
    const broken = {
      grantAdminCredit: async () => {
        throw new Error('D1 unavailable');
      },
    };
    assert.equal(await grantSignupCreditOnce(broken, 'user_g', {}), false);
  });
});
