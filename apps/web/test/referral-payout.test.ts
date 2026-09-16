import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REFERRAL_GRANT_ACTOR,
  payReferralIfEarned,
} from '../worker/referral-payout.ts';
import { MAX_PAID_REFERRALS, payoutGrantId } from '../worker/referral.ts';
import type { BillingStore } from '../worker/billing-store.ts';
import type { ReferralStore } from '../worker/referral-store.ts';

interface Grant {
  id: string;
  userId: string;
  cents: number;
  actor: string;
  note: string | null;
}

/** A billing store that records grants the way the real one does: id wins. */
function billingFake() {
  const grants = new Map<string, Grant>();
  return {
    grants,
    store: {
      async grantAdminCredit(
        id: string,
        userId: string,
        cents: number,
        actor: string,
        note: string | null,
      ) {
        // ON CONFLICT(id) DO NOTHING, which is the real idempotency guard.
        if (!grants.has(id)) grants.set(id, { id, userId, cents, actor, note });
      },
    } as unknown as BillingStore,
  };
}

function referralFake(options: {
  attribution?: {
    referrerUserId: string;
    code: string;
    paidAt: string | null;
  };
  paidCount?: number;
}) {
  const state = {
    paidAt: options.attribution?.paidAt ?? null,
    markCalls: 0,
  };
  return {
    state,
    store: {
      async attributionFor(referredUserId: string) {
        if (!options.attribution) return undefined;
        return {
          referredUserId,
          referrerUserId: options.attribution.referrerUserId,
          code: options.attribution.code,
          createdAt: '2026-09-16T00:00:00.000Z',
          paidAt: state.paidAt,
        };
      },
      async paidCountFor() {
        return options.paidCount ?? 0;
      },
      async markPaid(_id: string, at: string) {
        state.markCalls += 1;
        if (state.paidAt !== null) return false;
        state.paidAt = at;
        return true;
      },
    } as unknown as ReferralStore,
  };
}

describe('payReferralIfEarned', () => {
  it('credits both sides once a purchase clears', () => {
    const billing = billingFake();
    const referrals = referralFake({
      attribution: {
        referrerUserId: 'user_owner',
        code: 'ABCD2345',
        paidAt: null,
      },
    });
    return payReferralIfEarned(
      { referrals: referrals.store, billing: billing.store },
      'user_new',
    ).then((outcome) => {
      assert.equal(outcome.paid, true);
      assert.equal(billing.grants.size, 2);
      assert.equal(
        billing.grants.get(payoutGrantId('referrer', 'user_new'))?.userId,
        'user_owner',
      );
      assert.equal(
        billing.grants.get(payoutGrantId('referred', 'user_new'))?.userId,
        'user_new',
      );
    });
  });

  it('records where the credit came from', async () => {
    // The ledger is read by a human deciding whether a balance is legitimate,
    // so an unattributed grant is not good enough.
    const billing = billingFake();
    const referrals = referralFake({
      attribution: {
        referrerUserId: 'user_owner',
        code: 'ABCD2345',
        paidAt: null,
      },
    });
    await payReferralIfEarned(
      { referrals: referrals.store, billing: billing.store },
      'user_new',
    );
    for (const grant of billing.grants.values()) {
      assert.equal(grant.actor, REFERRAL_GRANT_ACTOR);
      assert.match(grant.note ?? '', /ABCD2345/);
    }
  });

  it('leaves the attribution unpaid when the credit could not be written', async () => {
    // The assertion that actually pins the order. An earlier version of this
    // test checked only that both things happened, which passes just as well
    // when they happen the wrong way round: moving the mark above the grants
    // did not fail it. So the write is made to fail. With grants first the
    // attribution is still claimable and the next delivery retries it; with
    // marking first it would read as paid forever and nobody would ever be
    // credited.
    const referrals = referralFake({
      attribution: {
        referrerUserId: 'user_owner',
        code: 'ABCD2345',
        paidAt: null,
      },
    });
    const exploding = {
      async grantAdminCredit() {
        throw new Error('D1 unavailable');
      },
    } as unknown as BillingStore;

    await assert.rejects(
      payReferralIfEarned(
        { referrals: referrals.store, billing: exploding },
        'user_new',
      ),
      /D1 unavailable/,
    );
    assert.equal(
      referrals.state.paidAt,
      null,
      'marked paid despite no credit being written',
    );
  });

  it('is a no-op on a redelivered webhook', async () => {
    // Stripe redelivers as a matter of course. Running twice must change
    // nothing, and the deterministic grant id is what guarantees it even if
    // the paid_at read is stale.
    const billing = billingFake();
    const referrals = referralFake({
      attribution: {
        referrerUserId: 'user_owner',
        code: 'ABCD2345',
        paidAt: null,
      },
    });
    const deps = { referrals: referrals.store, billing: billing.store };
    await payReferralIfEarned(deps, 'user_new');
    const second = await payReferralIfEarned(deps, 'user_new');
    assert.equal(second.paid, false);
    assert.equal(billing.grants.size, 2);
  });

  it('pays nothing for an account nobody referred', async () => {
    const billing = billingFake();
    const referrals = referralFake({});
    const outcome = await payReferralIfEarned(
      { referrals: referrals.store, billing: billing.store },
      'user_new',
    );
    assert.deepEqual(outcome, { paid: false, reason: 'not-attributed' });
    assert.equal(billing.grants.size, 0);
  });

  it('pays nothing once the referrer is at the cap', async () => {
    const billing = billingFake();
    const referrals = referralFake({
      attribution: {
        referrerUserId: 'user_owner',
        code: 'ABCD2345',
        paidAt: null,
      },
      paidCount: MAX_PAID_REFERRALS,
    });
    const outcome = await payReferralIfEarned(
      { referrals: referrals.store, billing: billing.store },
      'user_new',
    );
    assert.deepEqual(outcome, { paid: false, reason: 'referrer-at-cap' });
    assert.equal(billing.grants.size, 0);
  });

  it('honours an overridden reward on both sides', async () => {
    const billing = billingFake();
    const referrals = referralFake({
      attribution: {
        referrerUserId: 'user_owner',
        code: 'ABCD2345',
        paidAt: null,
      },
    });
    await payReferralIfEarned(
      {
        referrals: referrals.store,
        billing: billing.store,
        reward: { referrer: 250, referred: 1000 },
      },
      'user_new',
    );
    assert.equal(
      billing.grants.get(payoutGrantId('referrer', 'user_new'))?.cents,
      250,
    );
    assert.equal(
      billing.grants.get(payoutGrantId('referred', 'user_new'))?.cents,
      1000,
    );
  });
});
