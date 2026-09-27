import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { spendableFor } from '../worker/spendable.ts';
import { BillingStore } from '../worker/billing-store.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  monthlyAllowanceMicroUsd,
} from '../worker/entitlement.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';
import type { Principal } from '../worker/principal.ts';

/**
 * What a caller is allowed to spend (#185).
 *
 * Extracted from `handlePlan` because a second route is about to need the
 * same answer, and this is the part where two copies would hurt. The
 * reservation arithmetic around it is already shared and caller-independent;
 * this is policy. A tier change that landed in one route and not the other
 * would quietly let somebody spend what their plan does not buy, or refuse
 * them what it does -- and until this was its own function there was nothing
 * asserting it at all.
 */

const SCHEMA = schemaSql();

function principal(userId = 'user_1'): Principal {
  return { userId, email: `${userId}@example.com` } as Principal;
}

/** No signup-credit grant: that path has its own tests and its own network. */
function env(db: SqliteD1Database, over: Record<string, unknown> = {}) {
  return {
    DB: db,
    // Absent on purpose. `grantSignupCreditOnce` is a no-op without the
    // configuration that makes a grant, which keeps these about allowance.
    ...over,
  } as unknown as Parameters<typeof spendableFor>[0];
}

describe('what a caller may spend', () => {
  it('gives an account with no subscription the free allowance', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const { monthlyAllowance, topupCeiling } = await spendableFor(
      env(db),
      principal(),
    );
    assert.equal(
      monthlyAllowance,
      monthlyAllowanceMicroUsd('free', DEFAULT_FREE_INCLUDED_MICRO_USD),
    );
    assert.equal(topupCeiling, 0);
  });

  it('honours an operator override of the free allowance', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const { monthlyAllowance } = await spendableFor(
      env(db, { VIBLD_FREE_MONTHLY_MICRO_USD: '5000000' }),
      principal(),
    );
    assert.equal(monthlyAllowance, monthlyAllowanceMicroUsd('free', 5_000_000));
  });

  it('gives a subscriber their tier, not the free allowance', async () => {
    // The case a second copy of this would get wrong: a paying caller
    // silently held to the free ceiling.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.upsertSubscription({
      stripeSubscriptionId: 'sub_1',
      userId: 'user_1',
      stripeCustomerId: 'cus_1',
      tier: 'build',
      status: 'active',
      priceId: 'price_build_monthly',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    });

    const { monthlyAllowance } = await spendableFor(env(db), principal());
    assert.equal(
      monthlyAllowance,
      monthlyAllowanceMicroUsd('build', DEFAULT_FREE_INCLUDED_MICRO_USD),
    );
    assert.notEqual(
      monthlyAllowance,
      monthlyAllowanceMicroUsd('free', DEFAULT_FREE_INCLUDED_MICRO_USD),
    );
  });

  it('counts credit on top of the allowance, not instead of it', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    // Cents in, micro-USD out: $2.50 is 250 cents is 2,500,000 micro-USD.
    await store.grantAdminCredit(
      'grant_1',
      'user_1',
      250,
      'admin@example.com',
      'test',
    );

    const { monthlyAllowance, topupCeiling } = await spendableFor(
      env(db),
      principal(),
    );
    assert.equal(topupCeiling, 2_500_000);
    assert.equal(
      monthlyAllowance,
      monthlyAllowanceMicroUsd('free', DEFAULT_FREE_INCLUDED_MICRO_USD),
    );
  });

  it('answers for the caller asked about, not for anybody else', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    // Cents in, micro-USD out: $2.50 is 250 cents is 2,500,000 micro-USD.
    await store.grantAdminCredit(
      'grant_1',
      'user_1',
      250,
      'admin@example.com',
      'test',
    );

    const other = await spendableFor(env(db), principal('user_2'));
    assert.equal(other.topupCeiling, 0);
  });
});
