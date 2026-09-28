import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  handleReferralClaim,
  handleReferralStatus,
} from '../worker/referral-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The two referral endpoints, against the real tables.
 *
 * Both schemas, because the claim endpoint has to ask the billing tables
 * whether this account has ever paid: that question is what stops a referral
 * being attached to an account long after its first purchase.
 */
// Every migration, not the three this file happens to need. Naming them was
// a copy of the migration list, and a copy drifts: adding `reversed_at` to
// referral_attributions broke five tests here that have nothing to do with
// reversals, because the table they got was a version production never has.
// `schemaSql` is the fix the rest of the suite already uses.
const SCHEMA = schemaSql();

const PRINCIPAL = { userId: 'user_new', policyIdentity: 'new@example.com' };

function newEnv(): {
  DB: SqliteD1Database;
  VIBLD_REFERRAL_ORIGIN?: string;
} {
  return { DB: new SqliteD1Database(SCHEMA) };
}

function claim(code: unknown): Request {
  return new Request('https://app.vibld.com/api/referral/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

describe('handleReferralClaim', () => {
  it('records the attribution for an account that has never purchased', async () => {
    const env = newEnv();
    const referrals = new ReferralStore(env.DB);
    const code = await referrals.codeFor('user_owner');

    const response = await handleReferralClaim(claim(code), env, PRINCIPAL);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: true });
    assert.equal(
      (await referrals.attributionFor('user_new'))?.referrerUserId,
      'user_owner',
    );
  });

  it('refuses an account that has already bought something', async () => {
    // The hole this closes: without it, a customer of two years pastes a
    // code today and their next top-up pays out both sides, attaching a
    // referral retroactively to a purchase nobody was referred for.
    const env = newEnv();
    const referrals = new ReferralStore(env.DB);
    const code = await referrals.codeFor('user_owner');
    await new BillingStore(env.DB).recordTopup(
      'cs_1',
      'user_new',
      'cus_1',
      500,
    );

    const response = await handleReferralClaim(claim(code), env, PRINCIPAL);

    assert.equal(await referrals.attributionFor('user_new'), undefined);
    // And says nothing about it. The refusal is not the caller's to fix, and
    // an answer that differed would be a way to learn which codes exist.
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: true });
  });

  it('answers the same way for a code that does not exist', async () => {
    const env = newEnv();
    const response = await handleReferralClaim(
      claim('ZZZZ9999'),
      env,
      PRINCIPAL,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: true });
    assert.equal(
      await new ReferralStore(env.DB).attributionFor('user_new'),
      undefined,
    );
  });

  it('never replaces an attribution that already exists', async () => {
    const env = newEnv();
    const referrals = new ReferralStore(env.DB);
    const first = await referrals.codeFor('user_owner_1');
    const second = await referrals.codeFor('user_owner_2');

    await handleReferralClaim(claim(first), env, PRINCIPAL);
    await handleReferralClaim(claim(second), env, PRINCIPAL);

    assert.equal(
      (await referrals.attributionFor('user_new'))?.referrerUserId,
      'user_owner_1',
    );
  });

  it('refuses a self-referral', async () => {
    const env = newEnv();
    const referrals = new ReferralStore(env.DB);
    const own = await referrals.codeFor('user_new');

    await handleReferralClaim(claim(own), env, PRINCIPAL);

    assert.equal(await referrals.attributionFor('user_new'), undefined);
  });
});

describe('handleReferralStatus', () => {
  it('issues a code on first look and keeps it thereafter', async () => {
    const env = newEnv();
    const request = new Request('https://app.vibld.com/api/referral/status');

    const first = (await (
      await handleReferralStatus(request, env, PRINCIPAL)
    ).json()) as { code: string; url: string };
    const second = (await (
      await handleReferralStatus(request, env, PRINCIPAL)
    ).json()) as { code: string };

    assert.equal(first.code, second.code);
    // vibld.com, not the builder the request came from (Chris, 2026-09-28):
    // a friend sees the site first, and it carries the code to sign-up.
    assert.equal(first.url, `https://vibld.com/?ref=${first.code}`);
  });

  it('points links wherever a deployment says its site is', async () => {
    const env = { ...newEnv(), VIBLD_REFERRAL_ORIGIN: 'https://example.test' };
    const request = new Request('https://app.vibld.com/api/referral/status');
    const body = (await (
      await handleReferralStatus(request, env, PRINCIPAL)
    ).json()) as { code: string; url: string };
    assert.equal(body.url, `https://example.test/?ref=${body.code}`);
  });

  it('reports what the builder shows: the reward, the cap and progress', async () => {
    const env = newEnv();
    const request = new Request('https://app.vibld.com/api/referral/status');

    const body = (await (
      await handleReferralStatus(request, env, PRINCIPAL)
    ).json()) as Record<string, unknown>;

    assert.deepEqual(body.rewardCents, { referrer: 500, referred: 500 });
    assert.equal(body.maxPaidReferrals, 25);
    assert.equal(body.referred, 0);
    assert.equal(body.paid, 0);
    assert.equal(body.earnedCents, 0);
  });

  it('reports credit earned from the grants, net of a clawback', async () => {
    // Two referrals paid and one of them refunded after the referrer had
    // spent part of it: the readout is what was given and kept, not paid
    // times the reward.
    const env = newEnv();
    const billing = new BillingStore(env.DB);
    await billing.grantAdminCredit(
      'referral:referrer:user_a',
      PRINCIPAL.userId,
      500,
      'referral',
      null,
    );
    await billing.grantAdminCredit(
      'referral:referrer:user_b',
      PRINCIPAL.userId,
      500,
      'referral',
      null,
    );
    await billing.grantAdminCredit(
      'referral-clawback:referrer:user_b',
      PRINCIPAL.userId,
      -300,
      'referral',
      null,
    );
    // Credit this account received for being referred itself is not earned
    // by referring anybody.
    await billing.grantAdminCredit(
      `referral:referred:${PRINCIPAL.userId}`,
      PRINCIPAL.userId,
      500,
      'referral',
      null,
    );

    const request = new Request('https://app.vibld.com/api/referral/status');
    const body = (await (
      await handleReferralStatus(request, env, PRINCIPAL)
    ).json()) as { earnedCents: number };

    assert.equal(body.earnedCents, 700);
  });
});
