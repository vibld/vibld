import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REFERRAL_STORAGE_KEY,
  capNotice,
  captureReferral,
  claimStoredReferral,
  fetchReferralStatus,
  progressSummary,
  readReferralCode,
  rewardSentence,
} from '../src/referral/referral-client.ts';
import type {
  ReferralStatus,
  ReferralStorage,
} from '../src/referral/referral-client.ts';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  normaliseCode,
} from '../worker/referral.ts';
import { handleReferralClaim } from '../worker/referral-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * A referral link, from the moment it is opened to the moment the Worker
 * answers the claim, and the builder's reading of `/api/referral/status`.
 *
 * The claim is driven against the real handler and the real tables, so
 * "every refusal is quiet" is checked against what the Worker actually does
 * rather than against a stand-in that agrees with the client.
 */

const SCHEMA = schemaSql();

/** A `Storage` stand-in: a map, plus a way to make it refuse. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: ReferralStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { storage, map };
}

describe('the referral code format, in the browser', () => {
  const samples = [
    'ABCD2345',
    'abcd2345',
    ' abcd-2345 ',
    'ABCD 2345',
    'ABCD234',
    'ABCD23456',
    'ABCD2340',
    'ABCDO345',
    'ABCD1345',
    'ABCDI345',
    'ABCDL345',
    '',
    '        ',
    '<script>',
    'ABCD2345"><img src=x>',
    'ＡＢＣＤ２３４５',
    'ABCD​2345',
    'ABCD%202345',
  ];

  it('agrees with the Worker on every sample', () => {
    // Two copies of one rule. If they drift, a link the Worker would honour
    // is dropped before it is sent, or the reverse, and nothing on screen
    // would say so.
    for (const sample of samples) {
      assert.equal(
        readReferralCode(sample),
        normaliseCode(sample),
        JSON.stringify(sample),
      );
    }
  });

  it('agrees with the Worker on every code it can issue', () => {
    // Every character of the alphabet, in every position.
    for (let offset = 0; offset < CODE_ALPHABET.length; offset += 1) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[(offset + i) % CODE_ALPHABET.length];
      }
      assert.equal(readReferralCode(code), code);
      assert.equal(readReferralCode(code.toLowerCase()), code);
    }
  });

  it('reads nothing that is not a string', () => {
    for (const value of [null, undefined, 12345678, {}, ['ABCD2345']]) {
      assert.equal(readReferralCode(value), null);
    }
  });
});

describe('keeping the code a link arrived with', () => {
  it('keeps a readable code from the home page and the sign-up form', () => {
    for (const pathname of ['/', '/sign-up', '/sign-up/verify-email-address']) {
      const { storage, map } = memoryStorage();
      assert.equal(
        captureReferral({ pathname, search: '?ref=abcd-2345' }, storage),
        'ABCD2345',
      );
      assert.equal(map.get(REFERRAL_STORAGE_KEY), 'ABCD2345');
    }
  });

  it('keeps only the normalised code, never the raw query text', () => {
    const { storage, map } = memoryStorage();
    captureReferral(
      { pathname: '/', search: '?ref=%20abcd%202345%20&other=1' },
      storage,
    );
    assert.equal(map.get(REFERRAL_STORAGE_KEY), 'ABCD2345');
  });

  it('ignores an unreadable code, and does not let it replace a good one', () => {
    const { storage, map } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: 'ABCD2345',
    });
    for (const search of [
      '?ref=%3Cscript%3E',
      '?ref=ABCD0000',
      '?ref=',
      '?ref=ABCD23456',
      '',
    ]) {
      assert.equal(captureReferral({ pathname: '/', search }, storage), null);
    }
    assert.equal(map.get(REFERRAL_STORAGE_KEY), 'ABCD2345');
  });

  it('lets a newer link replace an older one before any claim', () => {
    const { storage, map } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: 'ABCD2345',
    });
    captureReferral({ pathname: '/sign-up', search: '?ref=EFGH6789' }, storage);
    assert.equal(map.get(REFERRAL_STORAGE_KEY), 'EFGH6789');
  });

  it('ignores a ref on any other page', () => {
    const { storage, map } = memoryStorage();
    for (const pathname of ['/admin', '/billing/success', '/sign-upx']) {
      assert.equal(
        captureReferral({ pathname, search: '?ref=ABCD2345' }, storage),
        null,
      );
    }
    assert.equal(map.size, 0);
  });

  it('survives a store that refuses', () => {
    const refusing: ReferralStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    assert.equal(
      captureReferral({ pathname: '/', search: '?ref=ABCD2345' }, refusing),
      null,
    );
    assert.equal(
      captureReferral({ pathname: '/', search: '?ref=ABCD2345' }, null),
      null,
    );
  });
});

/**
 * A world with a referrer, a new account and the real claim handler behind
 * `fetch`, so the client is exercised against what the Worker does.
 */
async function world(userId = 'user_new') {
  const db = new SqliteD1Database(SCHEMA);
  const referrals = new ReferralStore(db);
  const billing = new BillingStore(db);
  const ownerCode = await referrals.codeFor('user_owner');
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handleReferralClaim(
      new Request(`https://app.vibld.com${String(input)}`, init),
      { DB: db },
      { userId, policyIdentity: `${userId}@example.com` },
    );
  }) as typeof fetch;
  return { db, referrals, billing, ownerCode, calls, fetchImpl };
}

const signedIn = async () => 'token_1';

describe('claiming the kept code once signed in', () => {
  it('claims it for the new account, with the session token, and forgets it', async () => {
    const w = await world();
    const { storage, map } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: w.ownerCode,
    });

    assert.equal(
      await claimStoredReferral(storage, w.fetchImpl, signedIn),
      'sent',
    );
    assert.equal(w.calls.length, 1);
    assert.equal(w.calls[0]!.url, '/api/referral/claim');
    assert.equal(w.calls[0]!.init?.method, 'POST');
    assert.equal(
      (w.calls[0]!.init?.headers as Record<string, string>).Authorization,
      'Bearer token_1',
    );
    assert.equal(
      (await w.referrals.attributionFor('user_new'))?.referrerUserId,
      'user_owner',
    );
    assert.equal(map.has(REFERRAL_STORAGE_KEY), false);

    // Once: nothing is left to send on the next load.
    assert.equal(
      await claimStoredReferral(storage, w.fetchImpl, signedIn),
      'none',
    );
    assert.equal(w.calls.length, 1);
  });

  it('sends nothing, and keeps the code, until there is a session', async () => {
    const w = await world();
    const { storage, map } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: w.ownerCode,
    });
    assert.equal(
      await claimStoredReferral(storage, w.fetchImpl, async () => null),
      'kept',
    );
    assert.equal(w.calls.length, 0);
    assert.equal(map.get(REFERRAL_STORAGE_KEY), w.ownerCode);
  });

  it('sends nothing when there is no code, or one this code did not write', async () => {
    const w = await world();
    assert.equal(
      await claimStoredReferral(memoryStorage().storage, w.fetchImpl, signedIn),
      'none',
    );
    const { storage, map } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: '"><img src=x onerror=alert(1)>',
    });
    assert.equal(
      await claimStoredReferral(storage, w.fetchImpl, signedIn),
      'none',
    );
    assert.equal(map.has(REFERRAL_STORAGE_KEY), false);
    assert.equal(w.calls.length, 0);
  });

  it('keeps the code through a network failure or a Worker error', async () => {
    for (const fetchImpl of [
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      (async () =>
        new Response('{}', { status: 503 })) as unknown as typeof fetch,
      (async () =>
        new Response('{}', { status: 401 })) as unknown as typeof fetch,
    ]) {
      const { storage, map } = memoryStorage({
        [REFERRAL_STORAGE_KEY]: 'ABCD2345',
      });
      assert.equal(
        await claimStoredReferral(storage, fetchImpl, signedIn),
        'kept',
      );
      assert.equal(map.get(REFERRAL_STORAGE_KEY), 'ABCD2345');
    }
  });

  describe('every refusal is quiet, and ends the attempt', () => {
    async function refused(w: Awaited<ReturnType<typeof world>>, code: string) {
      const { storage, map } = memoryStorage({ [REFERRAL_STORAGE_KEY]: code });
      const outcome = await claimStoredReferral(storage, w.fetchImpl, signedIn);
      assert.equal(outcome, 'sent');
      assert.equal(map.has(REFERRAL_STORAGE_KEY), false);
    }

    it('an unknown code', async () => {
      const w = await world();
      await refused(w, w.ownerCode === 'ABCD2345' ? 'EFGH6789' : 'ABCD2345');
      assert.equal(await w.referrals.attributionFor('user_new'), undefined);
    });

    it('the account’s own code', async () => {
      const w = await world('user_owner');
      await refused(w, w.ownerCode);
      assert.equal(await w.referrals.attributionFor('user_owner'), undefined);
    });

    it('an account that was already referred by somebody else', async () => {
      const w = await world();
      const firstCode = await w.referrals.codeFor('user_first');
      await w.referrals.attribute('user_new', 'user_first', firstCode);
      await refused(w, w.ownerCode);
      assert.equal(
        (await w.referrals.attributionFor('user_new'))?.referrerUserId,
        'user_first',
      );
    });

    it('an account that has started a purchase', async () => {
      const w = await world();
      await w.billing.recordPurchaseStarted('user_new');
      await refused(w, w.ownerCode);
      assert.equal(await w.referrals.attributionFor('user_new'), undefined);
    });
  });

  it('still claims for an account that only saved a card', async () => {
    // The welcome credit's card creates a Stripe customer; that alone must
    // not read as a purchase (purchase-barrier.ts).
    const w = await world();
    await w.billing.linkCustomer('user_new', 'cus_card');
    const { storage } = memoryStorage({ [REFERRAL_STORAGE_KEY]: w.ownerCode });
    await claimStoredReferral(storage, w.fetchImpl, signedIn);
    assert.equal(
      (await w.referrals.attributionFor('user_new'))?.referrerUserId,
      'user_owner',
    );
  });
});

function status(over: Partial<ReferralStatus> = {}): ReferralStatus {
  return {
    code: 'ABCD2345',
    url: 'https://app.vibld.com/?ref=ABCD2345',
    referred: 0,
    paid: 0,
    earnedCents: 0,
    rewardCents: { referrer: 500, referred: 500 },
    maxPaidReferrals: 25,
    ...over,
  };
}

function answering(body: unknown, init: ResponseInit = { status: 200 }) {
  return (async () =>
    new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
}

describe('reading /api/referral/status', () => {
  it('reads a well-formed status', async () => {
    const body = status({ referred: 3, paid: 1, earnedCents: 500 });
    assert.deepEqual(
      await fetchReferralStatus(answering(body), signedIn),
      body,
    );
  });

  it('asks with the session token', async () => {
    let headers: HeadersInit | undefined;
    await fetchReferralStatus(
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        headers = init?.headers;
        return new Response(JSON.stringify(status()));
      }) as typeof fetch,
      signedIn,
    );
    assert.deepEqual(headers, { Authorization: 'Bearer token_1' });
  });

  it('is null for anything that is not a status to show', async () => {
    const failing = [
      answering(
        { error: 'Referrals are not configured here.' },
        { status: 503 },
      ),
      answering({ error: 'Sign in.' }, { status: 401 }),
      (async () => new Response('<!doctype html>')) as unknown as typeof fetch,
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      answering({ ...status(), code: '<b>nope</b>' }),
      answering({ ...status(), url: 'javascript:alert(1)' }),
      answering({ ...status(), url: 'not a url' }),
      answering({ ...status(), referred: -1 }),
      answering({ ...status(), paid: '2' }),
      answering({ ...status(), rewardCents: null }),
      answering({ ...status(), maxPaidReferrals: undefined }),
    ];
    for (const fetchImpl of failing) {
      assert.equal(await fetchReferralStatus(fetchImpl, signedIn), null);
    }
  });

  it('leaves earned credit out when an older Worker does not send it', async () => {
    const { earnedCents: _dropped, ...older } = status();
    const read = await fetchReferralStatus(answering(older), signedIn);
    assert.ok(read);
    assert.equal('earnedCents' in read, false);
    assert.equal(
      progressSummary({ ...read, referred: 2, paid: 1 }).includes('earned'),
      false,
    );
  });
});

describe('what the panel says', () => {
  it('states both sides and the cap from the Worker’s figures', () => {
    assert.equal(
      rewardSentence(status()),
      'When a friend signs up with your link and makes their first payment, you each get $5 of build credit, for up to 25 friends.',
    );
    assert.equal(
      rewardSentence(
        status({
          rewardCents: { referrer: 1000, referred: 250 },
          maxPaidReferrals: 10,
        }),
      ),
      'When a friend signs up with your link and makes their first payment, you get $10 and they get $2.50 of build credit, for up to 10 friends.',
    );
  });

  it('describes progress', () => {
    assert.equal(
      progressSummary(status()),
      'Nobody has signed up with your link yet.',
    );
    assert.equal(
      progressSummary(status({ referred: 1, paid: 0 })),
      "1 friend signed up with your link, 0 paid. You've earned $0.",
    );
    assert.equal(
      progressSummary(status({ referred: 4, paid: 2, earnedCents: 1000 })),
      "4 friends signed up with your link, 2 paid. You've earned $10.",
    );
  });

  it('says so once the cap is reached, and not before', () => {
    assert.equal(capNotice(status({ paid: 24, referred: 30 })), null);
    assert.match(
      capNotice(status({ paid: 25, referred: 30 }))!,
      /limit of 25 paid referrals/,
    );
  });
});
