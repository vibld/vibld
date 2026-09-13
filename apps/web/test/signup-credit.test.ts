import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import {
  DEFAULT_SIGNUP_CREDIT_USD_CENTS,
  SIGNUP_DECLINED_NOTE,
  SIGNUP_GRANT_ACTOR,
  grantSignupCreditOnce,
  signupCohortStart,
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

const OFFER_START = '2026-09-13T00:00:00Z';
const BEFORE = Date.parse('2026-09-01T00:00:00Z');
const AFTER = Date.parse('2026-09-14T00:00:00Z');

/** Clerk's user endpoint, answering with a created_at of our choosing. */
const clerkSaying = (createdAt: number | null, ok = true) =>
  (async () =>
    new Response(
      JSON.stringify(createdAt === null ? {} : { created_at: createdAt }),
      {
        status: ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      },
    )) as unknown as typeof fetch;

const ENV = {
  CLERK_SECRET_KEY: 'sk_test',
  VIBLD_SIGNUP_CREDIT_FROM: OFFER_START,
};

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

  it('falls back to the default on an unreadable amount, never to zero', () => {
    for (const raw of ['', '   ', 'free', '1.5', '-100', 'NaN']) {
      assert.equal(
        signupCreditCents({ VIBLD_SIGNUP_CREDIT_USD_CENTS: raw }),
        DEFAULT_SIGNUP_CREDIT_USD_CENTS,
        JSON.stringify(raw),
      );
    }
  });
});

describe('signupCohortStart', () => {
  it('reads an ISO instant', () => {
    assert.equal(
      signupCohortStart({ VIBLD_SIGNUP_CREDIT_FROM: OFFER_START }),
      Date.parse(OFFER_START),
    );
  });

  it('resolves an absent or unreadable cutoff to null, which grants nobody', () => {
    // The opposite of the amount's fallback, deliberately. A typo in an
    // amount overpays one cohort by a known factor; a typo in a date could
    // widen the cohort to every account ever created.
    for (const raw of [
      undefined,
      '',
      '   ',
      'soon',
      'yesterday',
      '13/09/2026',
    ]) {
      assert.equal(
        signupCohortStart({ VIBLD_SIGNUP_CREDIT_FROM: raw }),
        null,
        JSON.stringify(raw),
      );
    }
  });

  it('refuses a bare number, which Date.parse would happily accept', () => {
    // The whole fail-closed claim rested on Date.parse returning NaN for
    // nonsense, and it does not: "0" is 2000-01-01 and "99" is 1999-01-01,
    // both finite. A cutoff mistyped that way would admit every account
    // created this century, the exact payout the cohort exists to prevent.
    // "0" is a likely typo rather than an exotic one: it is what disables
    // the amount variable.
    for (const raw of ['0', '1', '99', '2026', '2026-09', '1700000000000']) {
      assert.equal(
        signupCohortStart({ VIBLD_SIGNUP_CREDIT_FROM: raw }),
        null,
        JSON.stringify(raw),
      );
    }
  });

  it('requires an explicit timezone', () => {
    // Without one the instant is read in the runtime's local time, which
    // makes the cohort boundary depend on where the Worker runs.
    for (const raw of ['2026-09-13T00:00:00', '2026-09-13']) {
      assert.equal(
        signupCohortStart({ VIBLD_SIGNUP_CREDIT_FROM: raw }),
        null,
        JSON.stringify(raw),
      );
    }
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    // "2026-02-30" does not throw: it rolls to March 2, so the cutoff would
    // land two days from where it was written.
    for (const raw of ['2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z']) {
      assert.equal(
        signupCohortStart({ VIBLD_SIGNUP_CREDIT_FROM: raw }),
        null,
        JSON.stringify(raw),
      );
    }
    // A real leap day is still a real day.
    assert.equal(
      signupCohortStart({ VIBLD_SIGNUP_CREDIT_FROM: '2024-02-29T00:00:00Z' }),
      Date.parse('2024-02-29T00:00:00Z'),
    );
  });

  it('accepts an offset and fractional seconds', () => {
    assert.equal(
      signupCohortStart({
        VIBLD_SIGNUP_CREDIT_FROM: '2026-09-13T00:00:00.500+02:00',
      }),
      Date.parse('2026-09-13T00:00:00.500+02:00'),
    );
  });
});

describe('grantSignupCreditOnce', () => {
  it('grants a dollar to an account created after the offer started', async () => {
    const store = newStore();
    const outcome = await grantSignupCreditOnce(
      store,
      'user_new',
      ENV,
      clerkSaying(AFTER),
    );
    assert.equal(outcome, 'granted');
    // Asserted through the balance the rest of the app reads, not the row: a
    // grant that does not reach spendable credit has given nobody anything.
    assert.equal(
      await store.totalSpendableCreditMicroUsd('user_new'),
      1_000_000,
    );
  });

  it('asks Clerk once for an account outside the cohort, not every request', async () => {
    // Without a recorded decision, findAdminCredit never matches for the
    // whole pre-offer population, so every /api/billing/status and /api/plan
    // request would call Clerk again for an answer that can never change,
    // and during a Clerk outage would pay the full 8-second timeout each
    // time, on a hot path.
    const store = newStore();
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ created_at: BEFORE }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    assert.equal(
      await grantSignupCreditOnce(store, 'user_repeat', ENV, counting),
      'not-in-cohort',
    );
    for (let i = 0; i < 4; i += 1) {
      assert.equal(
        await grantSignupCreditOnce(store, 'user_repeat', ENV, counting),
        'already-granted',
      );
    }
    assert.equal(calls, 1, 'Clerk should be asked exactly once');

    // The marker must not be worth anything.
    assert.equal(await store.totalSpendableCreditMicroUsd('user_repeat'), 0);
    const recorded = await store.listAdminCredits('user_repeat');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.creditUsdCents, 0);
    assert.equal(recorded[0]!.note, SIGNUP_DECLINED_NOTE);
  });

  it('grants nothing to an account that already existed', async () => {
    // The finding this file was rewritten for. Keyed only on the grant id,
    // every pre-existing user would have been paid on the first request
    // after this shipped: a credit advertised for new accounts arriving as a
    // retroactive payout to everyone who came back.
    const store = newStore();
    const outcome = await grantSignupCreditOnce(
      store,
      'user_old',
      ENV,
      clerkSaying(BEFORE),
    );
    assert.equal(outcome, 'not-in-cohort');
    assert.equal(await store.totalSpendableCreditMicroUsd('user_old'), 0);
  });

  it('includes an account created exactly at the cutoff', async () => {
    const store = newStore();
    const outcome = await grantSignupCreditOnce(
      store,
      'user_edge',
      ENV,
      clerkSaying(Date.parse(OFFER_START)),
    );
    assert.equal(outcome, 'granted');
  });

  it('grants nothing when no cohort is configured', async () => {
    // No safe default exists: any cutoff early enough to catch new accounts
    // also catches every account that already exists.
    const store = newStore();
    const outcome = await grantSignupCreditOnce(
      store,
      'user_x',
      { CLERK_SECRET_KEY: 'sk_test' },
      clerkSaying(AFTER),
    );
    assert.equal(outcome, 'no-cohort-configured');
    assert.equal(await store.totalSpendableCreditMicroUsd('user_x'), 0);
  });

  it('grants nothing when the account age cannot be established', async () => {
    // The stingy direction on purpose. A genuinely new user gets their credit
    // on a later request once Clerk answers; the other choice pays out to
    // everyone for the duration of a Clerk outage.
    const store = newStore();
    for (const unreachable of [clerkSaying(null), clerkSaying(AFTER, false)]) {
      const outcome = await grantSignupCreditOnce(
        store,
        'user_unknown',
        ENV,
        unreachable,
      );
      assert.equal(outcome, 'age-unknown');
    }
    assert.equal(await store.totalSpendableCreditMicroUsd('user_unknown'), 0);
  });

  it('grants nothing without a Clerk key, rather than falling open', async () => {
    const store = newStore();
    const outcome = await grantSignupCreditOnce(
      store,
      'user_nokey',
      { VIBLD_SIGNUP_CREDIT_FROM: OFFER_START },
      clerkSaying(AFTER),
    );
    assert.equal(outcome, 'age-unknown');
    assert.equal(await store.totalSpendableCreditMicroUsd('user_nokey'), 0);
  });

  it('grants exactly once however many times it is called', async () => {
    const store = newStore();
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(
        await grantSignupCreditOnce(store, 'user_b', ENV, clerkSaying(AFTER)),
      );
    }
    assert.equal(outcomes[0], 'granted');
    assert.deepEqual(outcomes.slice(1), Array(4).fill('already-granted'));
    assert.equal(await store.totalSpendableCreditMicroUsd('user_b'), 1_000_000);

    const credits = await store.listAdminCredits('user_b');
    assert.equal(credits.length, 1);
    assert.equal(credits[0]!.id, signupGrantId('user_b'));
    assert.equal(credits[0]!.grantedByEmail, SIGNUP_GRANT_ACTOR);
  });

  it('survives concurrent first requests without double-granting', async () => {
    // Two tabs opening at once is the ordinary case. The read above is an
    // optimisation, so correctness here rests on the insert's ON CONFLICT.
    const store = newStore();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        grantSignupCreditOnce(store, 'user_c', ENV, clerkSaying(AFTER)),
      ),
    );
    assert.equal(await store.totalSpendableCreditMicroUsd('user_c'), 1_000_000);
    assert.equal((await store.listAdminCredits('user_c')).length, 1);
  });

  it('grants nothing when the amount is zero, without asking Clerk', async () => {
    const store = newStore();
    let asked = false;
    const outcome = await grantSignupCreditOnce(
      store,
      'user_d',
      { ...ENV, VIBLD_SIGNUP_CREDIT_USD_CENTS: '0' },
      (async () => {
        asked = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    );
    assert.equal(outcome, 'disabled');
    assert.equal(asked, false);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_d'), 0);
  });

  it('never throws when the store fails, so the request it rode in on survives', async () => {
    const broken = {
      grantAdminCredit: async () => {
        throw new Error('D1 unavailable');
      },
      findAdminCredit: async () => undefined,
    };
    assert.equal(
      await grantSignupCreditOnce(broken, 'user_g', ENV, clerkSaying(AFTER)),
      'error',
    );
  });
});
