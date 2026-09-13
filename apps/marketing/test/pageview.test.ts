import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { beaconFor } from '../app/pageview.ts';

const ORIGIN = 'https://vibld.com';

describe('beaconFor', () => {
  it('sends nothing for the first view, which the inline script covered', () => {
    assert.deepEqual(beaconFor(null, '/', ORIGIN), { send: false });
  });

  it('sends nothing when the view has not changed', () => {
    // React is free to run an effect more than once for the same render, and
    // a second send would count one visit twice.
    assert.deepEqual(beaconFor('/legal', '/legal', ORIGIN), { send: false });
  });

  it('sends a navigation, naming the page it came from', () => {
    // The bug this rule exists to fix: every page reachable only by an
    // internal link recorded nothing, because the inline script in the root
    // layout runs once per document load and a Link does not reload one.
    assert.deepEqual(beaconFor('/', '/legal/privacy', ORIGIN), {
      send: true,
      referrer: 'https://vibld.com/',
    });
  });

  it('reports the previous page rather than the original referrer', () => {
    // referrerHost() in worker/analytics.ts resolves one of our own URLs to
    // "self". Sending document.referrer instead would credit the search engine
    // that brought someone to the home page with every page they read after
    // it, turning one referral into nine.
    const decision = beaconFor('/legal', '/legal/terms', ORIGIN);
    assert.equal(
      decision.send && new URL(decision.referrer).hostname,
      'vibld.com',
    );
  });

  it('keeps the query string, which is where the UTM parameters are', () => {
    const decision = beaconFor('/?utm_source=news', '/legal', ORIGIN);
    assert.equal(
      decision.send && decision.referrer,
      'https://vibld.com/?utm_source=news',
    );
  });
});
