import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_KEY,
  answerOutcome,
  bannerVisible,
  consentSignals,
  readConsent,
  shouldLoadAnalytics,
  writeConsent,
  type ConsentStorage,
} from '../app/consent.ts';

/** A Storage that works, so the failing ones below have something to differ from. */
function working(
  initial?: string,
): ConsentStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(CONSENT_KEY, initial);
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

/** What a private window or blocked site data actually does: it throws. */
const throwing: ConsentStorage = {
  getItem() {
    throw new Error('access denied');
  },
  setItem() {
    throw new Error('access denied');
  },
};

describe('readConsent', () => {
  it('returns what was stored', () => {
    assert.equal(readConsent(working('granted')), 'granted');
    assert.equal(readConsent(working('denied')), 'denied');
  });

  it('treats an empty store as nobody having been asked', () => {
    assert.equal(readConsent(working()), null);
  });

  it('denies rather than trusting a value it does not recognise', () => {
    // Something else wrote this key, or an older version of us did. Neither
    // is the visitor agreeing to anything.
    assert.equal(readConsent(working('yes')), null);
    assert.equal(readConsent(working('')), null);
    assert.equal(readConsent(working('GRANTED')), null);
  });

  it('denies when the store throws rather than letting the page break', () => {
    assert.equal(readConsent(throwing), null);
  });

  it('denies when there is no store at all', () => {
    assert.equal(readConsent(null), null);
  });
});

describe('writeConsent', () => {
  it('stores the answer under the shared key', () => {
    const store = working();
    assert.equal(writeConsent(store, 'granted'), true);
    assert.equal(store.map.get(CONSENT_KEY), 'granted');
  });

  it('reports a write that did not happen instead of claiming it did', () => {
    // The caller cannot fix the store, but a silent false success would show
    // the banner again on the next page, which reads as ignoring the visitor.
    assert.equal(writeConsent(throwing, 'granted'), false);
    assert.equal(writeConsent(null, 'granted'), false);
  });

  it('round-trips through readConsent', () => {
    const store = working();
    writeConsent(store, 'denied');
    assert.equal(readConsent(store), 'denied');
  });
});

describe('consentSignals', () => {
  it('grants analytics storage only for an explicit grant', () => {
    assert.equal(consentSignals('granted').analytics_storage, 'granted');
    assert.equal(consentSignals('denied').analytics_storage, 'denied');
    assert.equal(consentSignals(null).analytics_storage, 'denied');
  });

  it('never grants an advertising signal, in any state', () => {
    // This site runs no advertising scripts, so there is no answer to the
    // banner that should turn one of these on.
    for (const state of ['granted', 'denied', null] as const) {
      const signals = consentSignals(state);
      assert.equal(signals.ad_storage, 'denied');
      assert.equal(signals.ad_user_data, 'denied');
      assert.equal(signals.ad_personalization, 'denied');
    }
  });

  it('names every advertising signal rather than omitting it', () => {
    // An unset consent signal is not a denied one as far as gtag is
    // concerned, so leaving them out would not be the same thing.
    const keys = Object.keys(consentSignals(null)).sort();
    assert.deepEqual(keys, [
      'ad_personalization',
      'ad_storage',
      'ad_user_data',
      'analytics_storage',
    ]);
  });
});

describe('bannerVisible', () => {
  it('asks a visitor who has not been asked', () => {
    assert.equal(bannerVisible(null, false), true);
  });

  it('stays out of the way once answered', () => {
    assert.equal(bannerVisible('granted', false), false);
    assert.equal(bannerVisible('denied', false), false);
  });

  it('reopens after either answer, which is the whole point of the footer link', () => {
    // "No stored choice" would be the obvious rule and would make the link
    // do nothing for exactly the people who click it.
    assert.equal(bannerVisible('granted', true), true);
    assert.equal(bannerVisible('denied', true), true);
    assert.equal(bannerVisible(null, true), true);
  });
});

describe('shouldLoadAnalytics', () => {
  it('loads only for an explicit grant', () => {
    assert.equal(shouldLoadAnalytics('granted'), true);
  });

  it('treats undecided exactly like denied', () => {
    // The whole point of gating the load rather than only the storage.
    // Someone who has not been asked has not agreed, and under Consent Mode
    // alone gtag.js is still fetched from Google and still pings, which
    // would make "it runs only if you say yes" false.
    assert.equal(shouldLoadAnalytics(null), false);
    assert.equal(shouldLoadAnalytics('denied'), false);
  });

  it('agrees with readConsent on every unreadable store', () => {
    // The two rules have to compose: anything readConsent cannot trust
    // resolves to null, and null must not load.
    assert.equal(shouldLoadAnalytics(readConsent(null)), false);
    assert.equal(shouldLoadAnalytics(readConsent(throwing)), false);
    assert.equal(shouldLoadAnalytics(readConsent(working('yes'))), false);
    assert.equal(shouldLoadAnalytics(readConsent(working('granted'))), true);
  });
});

describe('answerOutcome', () => {
  it('applies the answer whether or not it could be stored', () => {
    // Refusing to honour what someone just clicked, because we could not
    // write it down, would be worse than not remembering it.
    for (const stored of [true, false]) {
      assert.equal(answerOutcome('granted', stored).apply, 'granted');
      assert.equal(answerOutcome('denied', stored).apply, 'denied');
    }
  });

  it('says nothing when the answer was stored', () => {
    assert.equal(answerOutcome('granted', true).warn, false);
    assert.equal(answerOutcome('denied', true).warn, false);
  });

  it('warns about a lost yes, because the banner will come back', () => {
    // The bug this replaced: the write failed, the banner closed as though
    // it had been remembered, and the next page asked again with no
    // explanation.
    assert.equal(answerOutcome('granted', false).warn, true);
  });

  it('stays quiet about a lost no, which costs the visitor nothing', () => {
    // An unstored denial re-reads as undecided, which denies anyway. Nobody
    // is measured against their wishes, so there is nothing to warn about
    // and a warning would only be noise.
    assert.equal(answerOutcome('denied', false).warn, false);
  });

  it('round-trips with the write it is given', () => {
    assert.equal(
      answerOutcome('granted', writeConsent(working(), 'granted')).warn,
      false,
    );
    assert.equal(
      answerOutcome('granted', writeConsent(throwing, 'granted')).warn,
      true,
    );
  });
});
