import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_KEY,
  analyticsAction,
  recordAnswer,
  bannerVisible,
  consentSignals,
  isConsentStorageEvent,
  mustReload,
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
    removeItem: (key) => void map.delete(key),
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
  removeItem() {
    throw new Error('access denied');
  },
};

/**
 * The store that made this bug possible: writing fails, removing works, and
 * something is already in it. A quota error is the ordinary way to get here,
 * and deleting is what frees the quota.
 */
function readOnlyish(initial: string): ConsentStorage & {
  map: Map<string, string>;
} {
  const store = working(initial);
  return {
    ...store,
    setItem() {
      throw new Error('quota exceeded');
    },
  };
}

/** Writing and removing both fail, with a grant already stored: the worst case. */
function frozen(initial: string): ConsentStorage {
  const store = working(initial);
  return {
    getItem: store.getItem,
    setItem() {
      throw new Error('quota exceeded');
    },
    removeItem() {
      throw new Error('quota exceeded');
    },
  };
}

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

describe('recordAnswer', () => {
  it('stores the answer and allows everything when the write works', () => {
    const store = working();
    const outcome = recordAnswer(store, 'granted');
    assert.deepEqual(outcome, {
      apply: 'granted',
      safeToReload: true,
      warn: false,
    });
    assert.equal(readConsent(store), 'granted');
  });

  it('applies a yes it could not store, and says so', () => {
    // Refusing to honour what someone just clicked, because we could not
    // write it down, would be worse than not remembering it. Reloading is
    // still safe: the next document reads no grant and loads nothing.
    const outcome = recordAnswer(throwing, 'granted');
    assert.deepEqual(outcome, {
      apply: 'granted',
      safeToReload: true,
      warn: true,
    });
  });

  it('stays quiet about a lost no when nothing was stored', () => {
    // It re-reads as undecided, which denies anyway, so the only cost is
    // being asked again and a warning would be noise.
    const outcome = recordAnswer(throwing, 'denied');
    assert.equal(outcome.apply, 'denied');
    assert.equal(outcome.warn, false);
    assert.equal(outcome.safeToReload, true);
  });

  it('removes a stale grant when a denial cannot be written', () => {
    // The recovery, and the reason it is worth trying: removing a key can
    // succeed where writing one fails, and then the next document reads
    // nothing and loads nothing.
    const store = readOnlyish('granted');
    const outcome = recordAnswer(store, 'denied');
    assert.equal(readConsent(store), null);
    assert.deepEqual(outcome, {
      apply: 'denied',
      safeToReload: true,
      warn: false,
    });
  });

  it('refuses the reload when a stale grant survives a denial', () => {
    // The bug two fixes made together. Applying the denial, then replacing
    // the document, made the new one read the grant still sitting in the
    // store and load analytics again: "No thanks" would reload the page and
    // turn it back on, silently.
    const outcome = recordAnswer(frozen('granted'), 'denied');
    assert.equal(outcome.apply, 'denied');
    assert.equal(outcome.safeToReload, false);
    assert.equal(outcome.warn, true);
  });

  it('allows the reload when what survives is a denial, not a grant', () => {
    // Nothing worse than the answer is left behind, so replacing the
    // document is safe and is the only thing that removes a running tag.
    const outcome = recordAnswer(frozen('denied'), 'denied');
    assert.equal(outcome.safeToReload, true);
    assert.equal(outcome.warn, false);
  });

  it('never reports a grant it did not leave behind', () => {
    // safeToReload is read from the store afterwards rather than inferred
    // from whether a call threw, because only the store knows what the next
    // document will see.
    for (const store of [working(), working('denied'), working('granted')]) {
      const outcome = recordAnswer(store, 'denied');
      assert.equal(outcome.safeToReload, true);
      assert.equal(readConsent(store), 'denied');
    }
  });
});

describe('analyticsAction', () => {
  it('loads on the first yes, and only then', () => {
    assert.equal(analyticsAction('granted', false), 'load');
  });

  it('updates rather than reloading on a second yes', () => {
    // The bug: returning early because the tag "is already loaded" left GA4
    // denied for the rest of the visit, while the stored answer and the
    // closed banner both said it was allowed.
    assert.equal(analyticsAction('granted', true), 'grant');
  });

  it('denies a running tag when consent is withdrawn', () => {
    // A script already in the document cannot be taken out of it, so the
    // only honest response to "No thanks" mid-visit is an update.
    assert.equal(analyticsAction('denied', true), 'deny');
    assert.equal(analyticsAction(null, true), 'deny');
  });

  it('says nothing when there is no tag to say it to', () => {
    // A queue for a tag that does not exist is not a no-op: it is a
    // dataLayer waiting to be replayed the moment something loads.
    assert.equal(analyticsAction('denied', false), 'nothing');
    assert.equal(analyticsAction(null, false), 'nothing');
  });

  it('never loads for an answer that is not an explicit yes', () => {
    for (const state of ['denied', null] as const) {
      for (const running of [true, false]) {
        assert.notEqual(analyticsAction(state, running), 'load');
      }
    }
  });
});

describe('mustReload', () => {
  it('replaces the document when a running tag is withdrawn', () => {
    // The update stops storage, and nothing else can remove a script that is
    // already in the page. This site navigates without reloading, so without
    // this the tag keeps sending cookieless hits for the rest of the visit
    // and "withdrawing takes effect immediately" is not true.
    assert.equal(mustReload('deny'), true);
    assert.equal(mustReload(analyticsAction('denied', true)), true);
    assert.equal(mustReload(analyticsAction(null, true)), true);
  });

  it('does not jolt the far more common first "No thanks"', () => {
    // Nothing was loaded, so there is nothing to remove, and a reload would
    // cost a visitor their place in exchange for no change at all.
    assert.equal(mustReload('nothing'), false);
    assert.equal(mustReload(analyticsAction('denied', false)), false);
    assert.equal(mustReload(analyticsAction(null, false)), false);
  });

  it('never reloads on a yes, in either form', () => {
    assert.equal(mustReload('load'), false);
    assert.equal(mustReload('grant'), false);
    assert.equal(mustReload(analyticsAction('granted', false)), false);
    assert.equal(mustReload(analyticsAction('granted', true)), false);
  });

  it('cannot loop, because a reloaded document has nothing running', () => {
    // The answer is stored before the reload, so the next document reads
    // denied with no tag loaded, which is 'nothing', which does not reload.
    const afterReload = analyticsAction('denied', false);
    assert.equal(afterReload, 'nothing');
    assert.equal(mustReload(afterReload), false);
  });
});

describe('isConsentStorageEvent', () => {
  it('reacts to the consent key changing in another tab', () => {
    // The case this exists for: two tabs, "No thanks" clicked in one, and
    // the other still running the tag it loaded earlier. A storage event
    // fires in every other document and never in the one that wrote.
    assert.equal(isConsentStorageEvent(CONSENT_KEY), true);
  });

  it('treats a cleared store as a change, because it clears the answer', () => {
    // key is null when the whole store was cleared rather than one key
    // written. Matching only the exact key misses it, and clearing site data
    // is a fairly direct way of saying no.
    assert.equal(isConsentStorageEvent(null), true);
  });

  it('ignores every other key', () => {
    // Something else on this origin writing its own value is not an answer,
    // and reacting would re-read and re-apply consent for no reason.
    assert.equal(isConsentStorageEvent('theme'), false);
    assert.equal(isConsentStorageEvent(`${CONSENT_KEY}.other`), false);
    assert.equal(isConsentStorageEvent(''), false);
  });

  it('composes into a withdrawal that stops a tag in another tab', () => {
    // End to end as the other tab sees it: the event is ours, the stored
    // answer now reads denied, the tag here is running, so it is denied and
    // the document replaced.
    assert.equal(isConsentStorageEvent(CONSENT_KEY), true);
    const state = readConsent(working('denied'));
    assert.equal(analyticsAction(state, true), 'deny');
    assert.equal(mustReload(analyticsAction(state, true)), true);
  });
});
