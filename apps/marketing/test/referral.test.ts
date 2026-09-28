import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  REFERRAL_STORAGE_KEY,
  readReferralCode,
  referralCodeForVisit,
  withReferral,
} from '../app/referral.ts';
import type { ReferralStorage } from '../app/referral.ts';
import { SITE } from '../app/site.ts';

/**
 * A referral code, from a link to vibld.com to the builder's sign-up form.
 *
 * The builder is another origin, so the code rides in the sign-up link's
 * query string. These are the rules for what is kept and what is written
 * into that link; the builder's side is apps/web/test/referral-client.test.ts.
 */

const WORKER_REFERRAL = join(
  import.meta.dirname,
  '..',
  '..',
  'web',
  'worker',
  'referral.ts',
);

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: ReferralStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

describe('the referral code format, on vibld.com', () => {
  it('agrees with the Worker that issues the codes', async () => {
    // A variable specifier on purpose, as in plans.test.ts: the type-checker
    // would otherwise follow it into the builder's Worker.
    const worker = (await import(WORKER_REFERRAL)) as {
      normaliseCode: (raw: string) => string | null;
      CODE_ALPHABET: string;
    };
    const samples = [
      'ABCD2345',
      'abcd-2345',
      ' ABCD 2345 ',
      'ABCD234',
      'ABCD23456',
      'ABCD0345',
      'ABCDO345',
      'ABCD1345',
      'ABCDI345',
      'ABCDL345',
      '<script>',
      '"><svg onload=alert(1)>',
      '',
      worker.CODE_ALPHABET.slice(0, 8),
      worker.CODE_ALPHABET.slice(-8),
    ];
    for (const sample of samples) {
      assert.equal(
        readReferralCode(sample),
        worker.normaliseCode(sample),
        JSON.stringify(sample),
      );
    }
  });

  it('reads nothing that is not a string', () => {
    for (const value of [null, undefined, 12345678, {}]) {
      assert.equal(readReferralCode(value), null);
    }
  });
});

describe('the code for this visit', () => {
  it('keeps a readable code a link arrived with', () => {
    const { storage, map } = memoryStorage();
    assert.equal(referralCodeForVisit('?ref=abcd-2345', storage), 'ABCD2345');
    assert.equal(map.get(REFERRAL_STORAGE_KEY), 'ABCD2345');
  });

  it('remembers it on the pages after the one it landed on', () => {
    const { storage } = memoryStorage({ [REFERRAL_STORAGE_KEY]: 'ABCD2345' });
    assert.equal(referralCodeForVisit('', storage), 'ABCD2345');
    assert.equal(referralCodeForVisit('?utm_source=x', storage), 'ABCD2345');
  });

  it('ignores an unreadable code and keeps the good one', () => {
    const { storage, map } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: 'ABCD2345',
    });
    assert.equal(
      referralCodeForVisit('?ref=%3Cimg%20src%3Dx%3E', storage),
      'ABCD2345',
    );
    assert.equal(map.get(REFERRAL_STORAGE_KEY), 'ABCD2345');
  });

  it('never returns what it did not write', () => {
    const { storage } = memoryStorage({
      [REFERRAL_STORAGE_KEY]: '"><script>alert(1)</script>',
    });
    assert.equal(referralCodeForVisit('', storage), null);
  });

  it('is null with nothing to go on', () => {
    assert.equal(referralCodeForVisit('', memoryStorage().storage), null);
    assert.equal(referralCodeForVisit('', null), null);
  });

  it('still applies to the landing page when storage refuses', () => {
    const refusing: ReferralStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    assert.equal(referralCodeForVisit('?ref=ABCD2345', refusing), 'ABCD2345');
    assert.equal(referralCodeForVisit('', refusing), null);
  });
});

describe('the sign-up link, with the code added', () => {
  it('adds the code to the sign-up form link', () => {
    assert.equal(
      withReferral(SITE.signUpUrl, SITE.signUpUrl, 'ABCD2345'),
      `${SITE.signUpUrl}?ref=ABCD2345`,
    );
  });

  it('replaces a code already on the link rather than adding a second', () => {
    const once = withReferral(SITE.signUpUrl, SITE.signUpUrl, 'ABCD2345');
    assert.equal(
      withReferral(once, SITE.signUpUrl, 'EFGH6789'),
      `${SITE.signUpUrl}?ref=EFGH6789`,
    );
  });

  it('leaves every other link alone', () => {
    for (const href of [
      SITE.appUrl,
      '/pricing',
      '#main',
      'mailto:hello@vibld.com',
      SITE.repoUrl,
      `${SITE.signUpUrl}.evil.example/`,
      'https://evil.example/sign-up',
      `${SITE.signUpUrl}/extra`,
      'not a url',
    ]) {
      assert.equal(withReferral(href, SITE.signUpUrl, 'ABCD2345'), href);
    }
  });
});
