import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attributionFrom,
  clean,
  dataPointFor,
  pathOf,
  record,
  referrerHost,
} from '../worker/analytics.ts';

/**
 * These tests exist mostly to pin down what is *not* recorded. The analytics
 * here is first-party and the Cookie Notice and Privacy Policy both make
 * specific promises about it -- no IP address, no identifier, no full
 * referring URL, no query string. A change that quietly broke one of those
 * would make a published legal document false, which is the kind of
 * regression a type checker cannot catch.
 */

describe('referrerHost', () => {
  it('reports a missing referrer as direct', () => {
    assert.equal(referrerHost('', 'vibld.com'), 'direct');
  });

  it('reports our own pages as self, not as a referral', () => {
    assert.equal(referrerHost('https://vibld.com/legal', 'vibld.com'), 'self');
    assert.equal(referrerHost('https://www.vibld.com/', 'vibld.com'), 'self');
  });

  it('keeps only the hostname, never the path or query', () => {
    const host = referrerHost(
      'https://news.ycombinator.com/item?id=123&token=secret',
      'vibld.com',
    );
    assert.equal(host, 'news.ycombinator.com');
  });

  it('strips www so one referrer is not counted as two', () => {
    assert.equal(
      referrerHost('https://www.reddit.com/r/x', 'vibld.com'),
      'reddit.com',
    );
  });

  it('treats an unparseable referrer as direct rather than throwing', () => {
    assert.equal(referrerHost('not a url', 'vibld.com'), 'direct');
  });
});

describe('pathOf', () => {
  it('keeps the path and discards the query string', () => {
    assert.equal(
      pathOf('https://vibld.com/legal/privacy?utm_source=hn'),
      '/legal/privacy',
    );
  });

  it('falls back to / for an unparseable URL', () => {
    assert.equal(pathOf('???'), '/');
  });
});

describe('clean', () => {
  it('collapses whitespace and trims', () => {
    assert.equal(clean('  hacker   news \n'), 'hacker news');
  });

  it('caps length so one long field cannot crowd out the rest', () => {
    assert.equal(clean('x'.repeat(500)).length, 96);
  });

  it('maps null and undefined to an empty string', () => {
    assert.equal(clean(null), '');
    assert.equal(clean(undefined), '');
  });
});

describe('attributionFrom', () => {
  it('reads UTM parameters off the page URL', () => {
    const attribution = attributionFrom(
      'https://vibld.com/?utm_source=hn&utm_medium=social&utm_campaign=launch',
      'https://news.ycombinator.com/',
      'vibld.com',
    );
    assert.deepEqual(attribution, {
      referrer: 'news.ycombinator.com',
      source: 'hn',
      medium: 'social',
      campaign: 'launch',
    });
  });

  it('returns empty campaign fields rather than failing when there are none', () => {
    const attribution = attributionFrom('https://vibld.com/', '', 'vibld.com');
    assert.deepEqual(attribution, {
      referrer: 'direct',
      source: '',
      medium: '',
      campaign: '',
    });
  });
});

describe('dataPointFor', () => {
  const attribution = {
    referrer: 'news.ycombinator.com',
    source: 'hn',
    medium: 'social',
    campaign: 'launch',
  };

  it('indexes by event kind, so signups are never sampled away behind pageviews', () => {
    assert.deepEqual(dataPointFor('signup', attribution, '/', 'US').indexes, [
      'signup',
    ]);
    assert.deepEqual(dataPointFor('pageview', attribution, '/', 'US').indexes, [
      'pageview',
    ]);
  });

  it('records the promised fields and nothing more', () => {
    const point = dataPointFor('pageview', attribution, '/legal', 'US');
    assert.deepEqual(point.blobs, [
      'pageview',
      '/legal',
      'news.ycombinator.com',
      'hn',
      'social',
      'launch',
      'US',
    ]);
  });
});

describe('record', () => {
  it('does nothing when the binding is absent, as in local dev', () => {
    assert.doesNotThrow(() =>
      record(
        undefined,
        'pageview',
        new Request('https://vibld.com/api/hit'),
        {
          referrer: 'direct',
          source: '',
          medium: '',
          campaign: '',
        },
        '/',
      ),
    );
  });

  it('never lets a failing write break the request it rode in on', () => {
    const broken = {
      writeDataPoint() {
        throw new Error('dataset unavailable');
      },
    };
    assert.doesNotThrow(() =>
      record(
        broken,
        'signup',
        new Request('https://vibld.com/api/waitlist'),
        {
          referrer: 'direct',
          source: '',
          medium: '',
          campaign: '',
        },
        '/',
      ),
    );
  });

  it('never stores the visitor IP, only the country header', () => {
    const written: { blobs?: (string | null)[] }[] = [];
    const dataset = {
      writeDataPoint(point: { blobs?: (string | null)[] }) {
        written.push(point);
      },
    };
    const request = new Request('https://vibld.com/api/hit', {
      headers: { 'cf-connecting-ip': '203.0.113.9', 'cf-ipcountry': 'GB' },
    });
    record(
      dataset,
      'pageview',
      request,
      {
        referrer: 'direct',
        source: '',
        medium: '',
        campaign: '',
      },
      '/',
    );
    const blobs = written[0].blobs ?? [];
    assert.ok(blobs.includes('GB'), 'country should be recorded');
    assert.ok(
      !blobs.some(
        (value) => typeof value === 'string' && value.includes('203.0.113.9'),
      ),
      'the IP address must never reach the dataset',
    );
  });
});
