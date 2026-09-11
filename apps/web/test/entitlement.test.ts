import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  TIER_INCLUDED_MICRO_USD,
  allowancePeriodKey,
  monthlyAllowanceMicroUsd,
  tierFor,
} from '../worker/entitlement.ts';

describe('tierFor', () => {
  it('is free with no subscription', () => {
    assert.equal(tierFor(undefined), 'free');
  });

  it('is the subscribed tier when active or trialing', () => {
    assert.equal(tierFor({ tier: 'build', status: 'active' }), 'build');
    assert.equal(tierFor({ tier: 'ship', status: 'trialing' }), 'ship');
  });

  it('falls back to free for a subscription that exists but is not in force', () => {
    // billing_subscriptions rows are never deleted, only updated -- a
    // canceled or past_due row must not still grant the tier.
    for (const status of [
      'canceled',
      'past_due',
      'unpaid',
      'incomplete_expired',
    ]) {
      assert.equal(
        tierFor({ tier: 'ship', status }),
        'free',
        `status "${status}" must not grant a tier`,
      );
    }
  });
});

describe('monthlyAllowanceMicroUsd', () => {
  it('matches the accepted price table (docs/decisions.md L36)', () => {
    assert.equal(
      monthlyAllowanceMicroUsd('free', DEFAULT_FREE_INCLUDED_MICRO_USD),
      1_000_000,
    );
    assert.equal(
      monthlyAllowanceMicroUsd('build', 0),
      TIER_INCLUDED_MICRO_USD.build,
    );
    assert.equal(TIER_INCLUDED_MICRO_USD.build, 10_000_000);
    assert.equal(
      monthlyAllowanceMicroUsd('ship', 0),
      TIER_INCLUDED_MICRO_USD.ship,
    );
    assert.equal(TIER_INCLUDED_MICRO_USD.ship, 40_000_000);
  });

  it("lets an operator override the free tier's own default", () => {
    assert.equal(monthlyAllowanceMicroUsd('free', 2_000_000), 2_000_000);
  });

  it('ignores the free override for a paid tier', () => {
    assert.equal(
      monthlyAllowanceMicroUsd('build', 999_999_999),
      TIER_INCLUDED_MICRO_USD.build,
    );
  });
});

describe('allowancePeriodKey', () => {
  it('is the UTC calendar month', () => {
    assert.equal(
      allowancePeriodKey(Date.UTC(2026, 8, 30, 23, 59, 59)),
      '2026-09',
    );
    assert.equal(allowancePeriodKey(Date.UTC(2026, 9, 1, 0, 0, 0)), '2026-10');
  });
});
