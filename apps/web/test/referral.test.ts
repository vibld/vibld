import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_REWARD_CENTS,
  decideAttribution,
  decidePayout,
  makeCode,
  normaliseCode,
  payoutGrantId,
  referralUrl,
  reservationOutcome,
} from '../worker/referral.ts';

/** Bytes in order, wrapping: enough to walk the whole 0-255 range. */
function counting(start = 0): (bytes: number) => Uint8Array {
  let next = start;
  return (bytes) => Uint8Array.from({ length: bytes }, () => next++ & 0xff);
}

describe('makeCode', () => {
  it('draws only from the alphabet', () => {
    const code = makeCode(counting());
    assert.equal(code.length, CODE_LENGTH);
    for (const character of code) assert.ok(CODE_ALPHABET.includes(character));
  });

  it('never emits a character a person cannot read back', () => {
    // The whole point of the alphabet: codes are dictated and typed from
    // phones, and 0/O and 1/I/L are where that fails.
    for (const banned of ['0', 'O', '1', 'I', 'L']) {
      assert.ok(
        !CODE_ALPHABET.includes(banned),
        `${banned} is in the alphabet`,
      );
    }
  });

  it('rejects the bytes that would bias the distribution', () => {
    // 256 is not a multiple of 31, so folding with % would make the first
    // eight symbols roughly 13% more likely. Feeding only high bytes that
    // must be rejected still produces a full code, which is only possible if
    // they were skipped rather than folded.
    const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
    let calls = 0;
    const highThenLow = (bytes: number) => {
      calls += 1;
      return calls === 1
        ? Uint8Array.from({ length: bytes }, () => 255)
        : Uint8Array.from({ length: bytes }, () => 0);
    };
    assert.ok(255 >= limit, 'test assumes 255 is a rejected byte');
    const code = makeCode(highThenLow);
    assert.equal(code, CODE_ALPHABET[0]!.repeat(CODE_LENGTH));
  });

  it('keeps asking for randomness until it has a whole code', () => {
    let asked = 0;
    makeCode((bytes) => {
      asked += 1;
      return Uint8Array.from({ length: bytes }, () => (asked === 1 ? 255 : 5));
    });
    assert.ok(asked > 1, 'gave up before filling the code');
  });
});

describe('normaliseCode', () => {
  it('accepts a code as issued', () => {
    assert.equal(normaliseCode('ABCD2345'), 'ABCD2345');
  });

  it('accepts what people actually paste', () => {
    // Lowercased by a phone keyboard, split by a dash, padded by a copy.
    assert.equal(normaliseCode('abcd2345'), 'ABCD2345');
    assert.equal(normaliseCode('ABCD-2345'), 'ABCD2345');
    assert.equal(normaliseCode('  abcd 2345 '), 'ABCD2345');
  });

  it('refuses a near-miss rather than guessing', () => {
    // A code that resolves to somebody else's is worse than one that fails.
    assert.equal(normaliseCode('ABCD234'), null);
    assert.equal(normaliseCode('ABCD23456'), null);
    assert.equal(normaliseCode('ABCD2O45'), null);
    assert.equal(normaliseCode('ABCD2I45'), null);
  });

  it('refuses anything that is not a string', () => {
    assert.equal(normaliseCode(null), null);
    assert.equal(normaliseCode(undefined), null);
    assert.equal(normaliseCode(''), null);
  });
});

describe('decideAttribution', () => {
  const base = {
    rawCode: 'ABCD2345',
    referredUserId: 'user_new',
    ownerOfCode: 'user_owner',
    existing: false,
    alreadyPurchased: false,
  };

  it('attributes a readable code owned by somebody else', () => {
    const decision = decideAttribution(base);
    assert.deepEqual(decision, {
      ok: true,
      referrerUserId: 'user_owner',
      code: 'ABCD2345',
    });
  });

  it('normalises before looking anything up', () => {
    const decision = decideAttribution({ ...base, rawCode: 'abcd-2345' });
    assert.equal(decision.ok && decision.code, 'ABCD2345');
  });

  it('refuses a self-referral, the only attack one account can run alone', () => {
    const decision = decideAttribution({ ...base, ownerOfCode: 'user_new' });
    assert.deepEqual(decision, { ok: false, reason: 'self-referral' });
  });

  it('never replaces an attribution that already exists', () => {
    // An account that can be re-attributed can be sold to whichever referrer
    // asks last.
    const decision = decideAttribution({ ...base, existing: true });
    assert.deepEqual(decision, { ok: false, reason: 'already-attributed' });
  });

  it('checks the existing attribution before the code owner', () => {
    // Order matters for what an attacker learns: probing with a stranger's
    // code must not reveal whether that code exists.
    const decision = decideAttribution({
      ...base,
      existing: true,
      ownerOfCode: undefined,
    });
    assert.deepEqual(decision, { ok: false, reason: 'already-attributed' });
  });

  it('refuses an account that has already bought something', () => {
    // The offer is for somebody who arrived through a link and then bought.
    // Without this, a customer of two years pastes a code today and their
    // next top-up pays out both sides.
    const decision = decideAttribution({ ...base, alreadyPurchased: true });
    assert.deepEqual(decision, { ok: false, reason: 'already-purchased' });
  });

  it('asks whether they have purchased before it looks the code up', () => {
    // Same reason the existing attribution is checked first: the refusal
    // must not depend on whether the code exists, or it can be used to find
    // out which codes do.
    const decision = decideAttribution({
      ...base,
      alreadyPurchased: true,
      ownerOfCode: undefined,
    });
    assert.deepEqual(decision, { ok: false, reason: 'already-purchased' });
  });

  it('refuses an unknown code', () => {
    const decision = decideAttribution({ ...base, ownerOfCode: undefined });
    assert.deepEqual(decision, { ok: false, reason: 'unknown-code' });
  });

  it('refuses unreadable input before anything else', () => {
    const decision = decideAttribution({ ...base, rawCode: 'nope' });
    assert.deepEqual(decision, { ok: false, reason: 'unreadable-code' });
  });
});

describe('decidePayout', () => {
  const base = {
    referrerUserId: 'user_owner',
    paidAlready: false,
  };

  it('pays both sides on a first purchase', () => {
    const decision = decidePayout(base);
    assert.deepEqual(decision, {
      pay: true,
      referrerUserId: 'user_owner',
      reward: DEFAULT_REWARD_CENTS,
    });
  });

  it('pays nothing for a purchase by an unattributed account', () => {
    assert.deepEqual(decidePayout({ ...base, referrerUserId: undefined }), {
      pay: false,
      reason: 'not-attributed',
    });
  });

  it('pays once, which is what makes a repeated webhook safe', () => {
    // Stripe redelivers as a matter of course. A payout that runs twice runs
    // as often as an attacker can make delivery retry.
    assert.deepEqual(decidePayout({ ...base, paidAlready: true }), {
      pay: false,
      reason: 'already-paid',
    });
  });

  it('takes an overridden reward', () => {
    const reward = { referrer: 250, referred: 1000 };
    const decision = decidePayout({ ...base, reward });
    assert.deepEqual(decision.pay && decision.reward, reward);
  });
});

describe('reservationOutcome', () => {
  it('proceeds for the delivery that took the slot', () => {
    assert.deepEqual(reservationOutcome({ won: true, heldAlready: false }), {
      proceed: true,
    });
  });

  it('proceeds for a payout resuming on a slot it already holds', () => {
    // A payout that failed between claiming its slot and writing the credit
    // is owed both. Refusing here because the UPDATE changed nothing would
    // abandon it, and the grants it is about to make are idempotent anyway.
    assert.deepEqual(reservationOutcome({ won: false, heldAlready: true }), {
      proceed: true,
    });
  });

  it('refuses only when the slot was neither taken nor held', () => {
    assert.deepEqual(reservationOutcome({ won: false, heldAlready: false }), {
      proceed: false,
      reason: 'referrer-at-cap',
    });
  });
});

describe('payoutGrantId', () => {
  it('is keyed on the referred account, so a second purchase cannot earn again', () => {
    // The offer is one payout per referred account, ever. Keying on the
    // payment would pay on every top-up they ever buy.
    assert.equal(
      payoutGrantId('referrer', 'user_new'),
      payoutGrantId('referrer', 'user_new'),
    );
  });

  it('gives the two sides different ids', () => {
    assert.notEqual(
      payoutGrantId('referrer', 'user_new'),
      payoutGrantId('referred', 'user_new'),
    );
  });

  it('does not collide between referred accounts', () => {
    assert.notEqual(
      payoutGrantId('referrer', 'user_a'),
      payoutGrantId('referrer', 'user_b'),
    );
  });
});

describe('referralUrl', () => {
  it('puts the code where the app will look for it', () => {
    assert.equal(
      referralUrl('https://app.vibld.com', 'ABCD2345'),
      'https://app.vibld.com/?ref=ABCD2345',
    );
  });

  it('keeps an existing path and replaces an existing ref', () => {
    assert.equal(
      referralUrl('https://app.vibld.com/start?ref=OLD', 'ABCD2345'),
      'https://app.vibld.com/start?ref=ABCD2345',
    );
  });
});
