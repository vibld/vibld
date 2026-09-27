import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import {
  DEFAULT_SIGNUP_CREDIT_USD_CENTS,
  SIGNUP_DECLINED_NOTE,
  SIGNUP_GRANT_ACTOR,
  signupCohortStart,
  signupCreditCents,
  signupCreditStatus,
  signupGrantId,
} from '../worker/signup-credit.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

// Every migration, not a named subset: the offer and the card claims live in
// 0029, and a subset is a copy of the migration list that drifts.
const SCHEMA = schemaSql();

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
  // These tests are about the cohort, not the gate, so they run against an
  // open deployment. The gate has its own test below, and `access.test.ts`
  // owns the question of what opens one.
  VIBLD_ACCESS_MODE: 'open',
};

/** A signed-in account, which is all `signupCreditStatus` needs of one. */
function who(userId: string) {
  return {
    userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    policyIdentity: `${userId}@example.com`,
  };
}

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

describe('signupCreditStatus', () => {
  it('offers nothing to an account the access gate refuses', async () => {
    // The whole reason the invite gate exists. `/api/billing/status` is
    // deliberately ungated, so that somebody whose access was revoked can
    // still see what happened to their money, and it calls this. An offer
    // opened here is what the webhook later pays a saved card against, so
    // without the check one direct request would open it for any signed-in
    // account whatever the UI rendered.
    const store = newStore();

    const status = await signupCreditStatus(
      store,
      who('user_uninvited'),
      // Unset: the deployed default, and the one the open beta keeps until
      // the flip.
      { ...ENV, VIBLD_ACCESS_MODE: undefined },
      clerkSaying(AFTER),
    );

    assert.deepEqual(status, { state: 'none', reason: 'no-access' });
    assert.equal(await store.findSignupOffer('user_uninvited'), undefined);
    assert.equal(
      await store.findAdminCredit(signupGrantId('user_uninvited')),
      undefined,
    );
  });

  it('offers a new account a dollar for a card, and pays nothing yet', async () => {
    // The decision this file was changed for (Chris, 2026-09-27): the credit
    // waits for a card on file. Being new is what opens the offer, and the
    // balance stays at nothing until the webhook reports a saved card.
    const store = newStore();
    const status = await signupCreditStatus(
      store,
      who('user_new'),
      ENV,
      clerkSaying(AFTER),
    );
    assert.deepEqual(status, {
      state: 'needs-card',
      cents: 100,
      cardAlreadyUsed: false,
    });
    assert.equal(await store.findSignupOffer('user_new'), 100);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_new'), 0);
  });

  it('asks Clerk once per account, in or out of the cohort', async () => {
    // Without a recorded decision every /api/billing/status request would
    // call Clerk again for an answer that can never change, and during a
    // Clerk outage would pay the full 8-second timeout each time, on a hot
    // path. The offer row records "in"; the zero-cent marker records "out".
    for (const [createdAt, expected] of [
      [AFTER, 'needs-card'],
      [BEFORE, 'none'],
    ] as const) {
      const store = newStore();
      let calls = 0;
      const counting = (async () => {
        calls += 1;
        return new Response(JSON.stringify({ created_at: createdAt }), {
          status: 200,
        });
      }) as unknown as typeof fetch;

      for (let i = 0; i < 5; i += 1) {
        const status = await signupCreditStatus(
          store,
          who('user_repeat'),
          ENV,
          counting,
        );
        assert.equal(status.state, expected);
      }
      assert.equal(calls, 1, 'Clerk should be asked exactly once');
    }
  });

  it('offers nothing to an account that already existed, and says so once', async () => {
    // The finding the cohort was written for. Keyed only on the grant id,
    // every pre-existing user would be offered the dollar the moment this
    // shipped: a credit advertised for new accounts arriving as a
    // retroactive payout to everyone with a card.
    const store = newStore();
    const status = await signupCreditStatus(
      store,
      who('user_old'),
      ENV,
      clerkSaying(BEFORE),
    );
    assert.deepEqual(status, { state: 'none', reason: 'not-in-cohort' });
    assert.equal(await store.findSignupOffer('user_old'), undefined);

    // The marker must not be worth anything.
    const recorded = await store.listAdminCredits('user_old');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.creditUsdCents, 0);
    assert.equal(recorded[0]!.note, SIGNUP_DECLINED_NOTE);
    assert.equal(recorded[0]!.grantedByEmail, SIGNUP_GRANT_ACTOR);
  });

  it('includes an account created exactly at the cutoff', async () => {
    const store = newStore();
    const status = await signupCreditStatus(
      store,
      who('user_edge'),
      ENV,
      clerkSaying(Date.parse(OFFER_START)),
    );
    assert.equal(status.state, 'needs-card');
  });

  it('leaves an account that got its dollar on creation exactly as it is', async () => {
    // Accounts granted before the card requirement keep their credit, and
    // are never offered a second one: their row carries the same id, so to
    // the new path they are already granted. Clerk is not asked.
    const store = newStore();
    await store.grantAdminCredit(
      signupGrantId('user_early'),
      'user_early',
      100,
      SIGNUP_GRANT_ACTOR,
      'Welcome credit on account creation',
    );
    let asked = false;
    const status = await signupCreditStatus(
      store,
      who('user_early'),
      ENV,
      (async () => {
        asked = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    );
    assert.deepEqual(status, { state: 'granted', cents: 100 });
    assert.equal(asked, false);
    assert.equal(await store.findSignupOffer('user_early'), undefined);
    assert.equal(
      await store.totalSpendableCreditMicroUsd('user_early'),
      1_000_000,
    );
  });

  it('offers nothing when no cohort is configured', async () => {
    // No safe default exists: any cutoff early enough to catch new accounts
    // also catches every account that already exists.
    const store = newStore();
    const status = await signupCreditStatus(
      store,
      who('user_x'),
      { CLERK_SECRET_KEY: 'sk_test', VIBLD_ACCESS_MODE: 'open' },
      clerkSaying(AFTER),
    );
    assert.deepEqual(status, { state: 'none', reason: 'no-cohort-configured' });
    assert.equal(await store.findSignupOffer('user_x'), undefined);
  });

  it('offers nothing while the account age cannot be established, and decides nothing', async () => {
    // The stingy direction on purpose, and retryable: nothing is written, so
    // a genuinely new user is offered the credit once Clerk answers.
    const store = newStore();
    for (const unreachable of [clerkSaying(null), clerkSaying(AFTER, false)]) {
      const status = await signupCreditStatus(
        store,
        who('user_unknown'),
        ENV,
        unreachable,
      );
      assert.deepEqual(status, { state: 'none', reason: 'age-unknown' });
    }
    assert.equal(await store.findSignupOffer('user_unknown'), undefined);
    assert.equal(
      await store.findAdminCredit(signupGrantId('user_unknown')),
      undefined,
    );
    assert.equal(
      (
        await signupCreditStatus(
          store,
          who('user_unknown'),
          ENV,
          clerkSaying(AFTER),
        )
      ).state,
      'needs-card',
    );
  });

  it('offers nothing without a Clerk key, rather than falling open', async () => {
    const store = newStore();
    const status = await signupCreditStatus(
      store,
      who('user_nokey'),
      // Open, so this test is about the missing Clerk key and not about the
      // gate. Access is checked before Clerk is asked, deliberately: an
      // account that may not use the product is not worth an external call.
      { VIBLD_SIGNUP_CREDIT_FROM: OFFER_START, VIBLD_ACCESS_MODE: 'open' },
      clerkSaying(AFTER),
    );
    assert.deepEqual(status, { state: 'none', reason: 'age-unknown' });
  });

  it('opens one offer however many first requests race for it', async () => {
    // Two tabs opening at once is the ordinary case.
    const store = newStore();
    const statuses = await Promise.all(
      Array.from({ length: 8 }, () =>
        signupCreditStatus(store, who('user_c'), ENV, clerkSaying(AFTER)),
      ),
    );
    for (const status of statuses) assert.equal(status.state, 'needs-card');
    assert.equal(await store.findSignupOffer('user_c'), 100);
  });

  it('keeps the amount an offer opened at when the setting changes', async () => {
    const store = newStore();
    await signupCreditStatus(store, who('user_e'), ENV, clerkSaying(AFTER));
    const later = await signupCreditStatus(
      store,
      who('user_e'),
      { ...ENV, VIBLD_SIGNUP_CREDIT_USD_CENTS: '500' },
      clerkSaying(AFTER),
    );
    assert.deepEqual(later, {
      state: 'needs-card',
      cents: 100,
      cardAlreadyUsed: false,
    });
  });

  it('offers nothing when the amount is zero, without asking Clerk', async () => {
    const store = newStore();
    let asked = false;
    const status = await signupCreditStatus(
      store,
      who('user_d'),
      { ...ENV, VIBLD_SIGNUP_CREDIT_USD_CENTS: '0' },
      (async () => {
        asked = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    );
    assert.deepEqual(status, { state: 'none', reason: 'disabled' });
    assert.equal(asked, false);
  });

  it('says when the last card saved had already claimed the credit elsewhere', async () => {
    const store = newStore();
    for (const user of ['user_first', 'user_second']) {
      await signupCreditStatus(store, who(user), ENV, clerkSaying(AFTER));
    }
    await store.claimSignupCardCredit({
      setupIntentId: 'seti_1',
      userId: 'user_first',
      cardFingerprint: 'fp_shared',
      grantId: signupGrantId('user_first'),
      grantedByEmail: SIGNUP_GRANT_ACTOR,
      note: 'test',
    });
    await store.claimSignupCardCredit({
      setupIntentId: 'seti_2',
      userId: 'user_second',
      cardFingerprint: 'fp_shared',
      grantId: signupGrantId('user_second'),
      grantedByEmail: SIGNUP_GRANT_ACTOR,
      note: 'test',
    });

    assert.deepEqual(
      await signupCreditStatus(
        store,
        who('user_second'),
        ENV,
        clerkSaying(AFTER),
      ),
      { state: 'needs-card', cents: 100, cardAlreadyUsed: true },
    );
    assert.deepEqual(
      await signupCreditStatus(
        store,
        who('user_first'),
        ENV,
        clerkSaying(AFTER),
      ),
      { state: 'granted', cents: 100 },
    );
  });

  it('never throws when the store fails, so the request it rode in on survives', async () => {
    const broken = {
      grantAdminCredit: async () => {
        throw new Error('D1 unavailable');
      },
      findAdminCredit: async () => undefined,
      openSignupOffer: async () => {
        throw new Error('D1 unavailable');
      },
      findSignupOffer: async () => undefined,
      latestSignupCardOutcome: async () => undefined,
    };
    assert.deepEqual(
      await signupCreditStatus(broken, who('user_g'), ENV, clerkSaying(AFTER)),
      { state: 'none', reason: 'error' },
    );
  });
});
