import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import worker, { canonicalHost, isLayerDemo } from '../worker/index.ts';

const ENV = {};

afterEach(() => {
  mock.restoreAll();
});

describe('routing', () => {
  /**
   * Stands in for production's asset binding, which is always present
   * there: Static Assets serves GET and HEAD and answers anything else 405.
   */
  const staticAssets = () => {
    const seen: string[] = [];
    return {
      seen,
      fetch: async (request: Request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response(null, {
          status:
            request.method === 'GET' || request.method === 'HEAD' ? 200 : 405,
        });
      },
    };
  };

  it('answers 404 for an /api path it does not know', async () => {
    const ASSETS = staticAssets();
    const response = await worker.fetch(
      new Request('https://vibld.com/api/nope'),
      { ...ENV, ASSETS },
    );
    assert.equal(response.status, 404);
    assert.deepEqual(ASSETS.seen, []);
  });

  it('answers POST /api/waitlist like any unknown path, since D168 retired it', async () => {
    const ASSETS = staticAssets();
    const response = await worker.fetch(
      new Request('https://vibld.com/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'chris@example.com' }),
      }),
      { ...ENV, ASSETS },
    );
    assert.equal(response.status, 404);
    assert.deepEqual(ASSETS.seen, []);
  });
});

describe('preview deployments', () => {
  /** Stands in for the asset binding wrangler.preview.jsonc provides. */
  const assets = (
    body = '<!doctype html><title>Vibld | Vibe. Build. Ship.</title>',
  ) => ({
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  });

  it('serves pages with a noindex header when VIBLD_NOINDEX is set', async () => {
    // The property the preview exists or dies on. A byte-for-byte copy of
    // vibld.com on a public hostname, left indexable, competes with the real
    // site for a name that already returns other things when searched.
    const response = await worker.fetch(
      new Request('https://preview.workers.dev/'),
      {
        ...ENV,
        VIBLD_NOINDEX: '1',
        ASSETS: assets(),
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(await response.text(), /Vibe\. Build\. Ship\./);
  });

  it('keeps the response otherwise intact', async () => {
    // Rebuilding the response must not lose what the asset store said about
    // it, or a preview stops being a faithful copy of what it previews.
    const response = await worker.fetch(
      new Request('https://preview.workers.dev/'),
      {
        ...ENV,
        VIBLD_NOINDEX: '1',
        ASSETS: assets(),
      },
    );
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    );
  });

  it('serves production the same page without the noindex header', async () => {
    // This used to assert a 404, on the grounds that production never
    // invoked the Worker for a page at all. That premise is gone:
    // `run_worker_first` is now true so the www redirect can happen, and
    // production pages come through this handler and out of the same asset
    // binding.
    //
    // The half of the old assertion that was about the risk rather than the
    // routing is kept and is the reason this test still exists. Telling
    // crawlers not to index vibld.com is the one mistake in this file that
    // would be invisible in every check and fatal to the thing the marketing
    // site is for.
    const response = await worker.fetch(new Request('https://vibld.com/'), {
      ...ENV,
      ASSETS: assets(),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), null);
    assert.match(await response.text(), /Vibe\. Build\. Ship\./);
  });

  it('keeps a layer demo page out of search results in production', async () => {
    // /layers/<slug> is a made-up product's page (app/layers.ts, D101); its
    // page on /templates is the one that belongs in an index.
    const response = await worker.fetch(
      new Request('https://vibld.com/layers/nocturne'),
      { ...ENV, ASSETS: assets() },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
  });

  it('leaves the layer pages on /templates indexable', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/templates/nocturne'),
      { ...ENV, ASSETS: assets() },
    );
    assert.equal(response.headers.get('x-robots-tag'), null);
    assert.equal(isLayerDemo('/layersmith'), false);
  });

  it('still routes the API on a preview rather than serving it as a page', async () => {
    // The asset fallthrough is added after the /api/ branches, not before
    // them. A preview that swallowed its own API would look fine and be
    // broken in the one place anyone would click.
    const response = await worker.fetch(
      new Request('https://preview.workers.dev/api/roadmap/votes'),
      { VIBLD_NOINDEX: '1', ASSETS: assets() },
    );
    // No ROADMAP_DB on a preview, so this is the configured 503 rather than
    // a 200 page. That it is not 200-with-HTML is the point.
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-robots-tag'), null);
  });
});

/**
 * What the dataset actually receives: the datapoint written alongside the
 * answer, which no status-code assertion can see.
 */
function recordingEnv() {
  const points: { blobs: (string | null)[]; indexes: string[] }[] = [];
  return {
    env: {
      ...ENV,
      ANALYTICS: {
        writeDataPoint(point: {
          blobs?: (string | null)[];
          indexes?: string[];
        }) {
          points.push({
            blobs: point.blobs ?? [],
            indexes: point.indexes ?? [],
          });
        },
      },
    },
    points,
  };
}

describe('attribution a caller cannot forge', () => {
  it('refuses a page_url pointing at another site', async () => {
    // /api/hit takes unauthenticated posts, so a page_url that is trusted on
    // sight lets anyone write paths and campaigns into this site's traffic
    // report from anywhere.
    const { env, points } = recordingEnv();
    const request = new Request('https://vibld.com/api/hit', {
      method: 'POST',
      body: new URLSearchParams({
        page_url: 'https://elsewhere.example/their/page?utm_campaign=fake',
        page_referrer: '',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 204);
    const [hit] = points.filter((point) => point.indexes[0] === 'pageview');
    assert.ok(hit);
    assert.equal(hit.blobs[1], '/');
    assert.equal(hit.blobs[5], '');
  });

  it('still believes a page_url on this site', async () => {
    // The check must not cost the real case, which is every genuine visitor.
    const { env, points } = recordingEnv();
    const request = new Request('https://vibld.com/api/hit', {
      method: 'POST',
      body: new URLSearchParams({
        page_url: 'https://vibld.com/legal/privacy?utm_campaign=launch',
        page_referrer: '',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await worker.fetch(request, env);
    const [hit] = points.filter((point) => point.indexes[0] === 'pageview');
    assert.ok(hit);
    assert.equal(hit.blobs[1], '/legal/privacy');
    assert.equal(hit.blobs[5], 'launch');
  });
  it('falls back to a same-site Referer when page_url is empty', async () => {
    // The last resort is deliberately not the Worker's own URL, which would
    // file the hit under /api/hit, a path nobody visited.
    const { env, points } = recordingEnv();
    const request = new Request('https://vibld.com/api/hit', {
      method: 'POST',
      body: new URLSearchParams({ page_url: '', page_referrer: '' }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://vibld.com/?utm_source=newsletter',
      },
    });
    await worker.fetch(request, env);
    const [hit] = points.filter((point) => point.indexes[0] === 'pageview');
    assert.ok(hit);
    // blobs: [kind, path, referrer, source, medium, campaign, country]
    assert.equal(hit.blobs[1], '/');
    assert.equal(hit.blobs[3], 'newsletter');
  });

  it('never takes a path from another site', async () => {
    // Referer is whatever the caller sends. Trusting a cross-origin one would
    // let anyone write paths into our own traffic report by posting a form.
    const { env, points } = recordingEnv();
    const request = new Request('https://vibld.com/api/hit', {
      method: 'POST',
      body: new URLSearchParams({ page_url: '', page_referrer: '' }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://elsewhere.example/their/page',
      },
    });
    await worker.fetch(request, env);
    const [hit] = points.filter((point) => point.indexes[0] === 'pageview');
    assert.ok(hit);
    assert.equal(hit.blobs[1], '/');
  });
});

describe('one canonical hostname', () => {
  /**
   * www.vibld.com used to serve the whole site at 200, because
   * wrangler.jsonc routed only /api/* to this Worker and everything else came
   * straight from the asset store. Two hostnames serving one product is the
   * duplicate-content split the canonical tags were written to avoid, and the
   * canonical tags cannot fix it on their own: they name vibld.com while www
   * kept answering.
   */
  it('sends a www page request to the apex, permanently', async () => {
    const response = await worker.fetch(
      new Request('https://www.vibld.com/legal/privacy'),
      ENV,
    );
    assert.equal(response.status, 301);
    assert.equal(
      response.headers.get('location'),
      'https://vibld.com/legal/privacy',
    );
  });

  it('keeps the query string, so a campaign link survives the hop', async () => {
    // A www link in an ad or an email carries the UTM parameters that say
    // where it came from. Redirecting to the bare path throws that away and
    // files the visit under nothing.
    const response = await worker.fetch(
      new Request('https://www.vibld.com/?utm_source=x&utm_campaign=launch'),
      ENV,
    );
    assert.equal(
      response.headers.get('location'),
      'https://vibld.com/?utm_source=x&utm_campaign=launch',
    );
  });

  it('does not turn a www post into a GET', async () => {
    // 301 and 302 both let a client re-issue a POST as a GET, which for
    // /api/roadmap/vote means the body is dropped and somebody's vote
    // silently does not happen. 308 is the same permanent redirect with the
    // method preserved.
    const response = await worker.fetch(
      new Request('https://www.vibld.com/api/roadmap/vote', {
        method: 'POST',
        body: JSON.stringify({ id: 'cli-sync' }),
      }),
      ENV,
    );
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get('location'),
      'https://vibld.com/api/roadmap/vote',
    );
  });

  it('leaves the apex alone', async () => {
    // The redirect must not fire on the hostname it redirects to, or every
    // request loops until the browser gives up.
    const response = await worker.fetch(
      new Request('https://vibld.com/api/nope'),
      ENV,
    );
    assert.equal(response.status, 404);
  });

  it('leaves a preview hostname serving itself', async () => {
    // A reviewer opening the preview must see the preview, not be sent to
    // production. Only a leading "www." is stripped, so a workers.dev host
    // is untouched.
    assert.equal(
      canonicalHost(new URL('https://vibld-marketing-preview.workers.dev/')),
      null,
    );
    assert.equal(canonicalHost(new URL('https://vibld.com/')), null);
  });
});

describe('the self-hosted fonts', () => {
  /** An asset store that answers every path with one response. */
  const store = (status: number, contentType: string) => ({
    fetch: async () =>
      new Response('wOF2', {
        status,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=0, must-revalidate',
        },
      }),
  });

  it('caches a font for a year, typed as a font', async () => {
    // Every page preloads two of these. Revalidating them on every page view
    // is a round trip per font per navigation for a file that cannot change
    // at its URL, because the filename carries the package version.
    const response = await worker.fetch(
      new Request(
        'https://vibld.com/fonts/hanken-grotesk-5.3.0-latin-wght-normal.woff2',
      ),
      { ...ENV, ASSETS: store(200, 'application/octet-stream') },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/woff2');
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    // Still carries the headers every response does.
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  it('never caches a missing font for a year', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/fonts/nope.woff2'),
      { ...ENV, ASSETS: store(404, 'text/html; charset=utf-8') },
    );
    assert.equal(response.status, 404);
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=0, must-revalidate',
    );
  });

  it('leaves pages and other files on the asset store’s own caching', async () => {
    for (const path of ['/', '/pricing', '/fonts/JetBrainsMono-OFL.txt']) {
      const response = await worker.fetch(
        new Request(`https://vibld.com${path}`),
        { ...ENV, ASSETS: store(200, 'text/html; charset=utf-8') },
      );
      assert.equal(
        response.headers.get('cache-control'),
        'public, max-age=0, must-revalidate',
        path,
      );
    }
  });
});

describe('the build’s hashed scripts and stylesheets', () => {
  const store = (status: number) => ({
    fetch: async () =>
      new Response('/* built */', {
        status,
        headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
      }),
  });

  it('caches a hashed file for a year', async () => {
    for (const path of [
      '/assets/entry.client-CESUXnr0.js',
      '/assets/root-DpPZ_TgP.css',
    ]) {
      const response = await worker.fetch(
        new Request(`https://vibld.com${path}`),
        { ...ENV, ASSETS: store(200) },
      );
      assert.equal(
        response.headers.get('cache-control'),
        'public, max-age=31536000, immutable',
        path,
      );
    }
  });

  it('leaves a missing file and an unhashed name alone', async () => {
    const cases: [string, number][] = [
      ['/assets/entry.client-CESUXnr0.js', 404],
      ['/assets/readme.js', 200],
      ['/og-image.png', 200],
    ];
    for (const [path, status] of cases) {
      const response = await worker.fetch(
        new Request(`https://vibld.com${path}`),
        { ...ENV, ASSETS: store(status) },
      );
      assert.equal(
        response.headers.get('cache-control'),
        'public, max-age=0, must-revalidate',
        path,
      );
    }
  });
});

describe('the asset store’s redirects', () => {
  /** What html_handling answers for /pricing/ and /pricing/index.html. */
  const store = {
    fetch: async () =>
      new Response(null, { status: 307, headers: { location: '/pricing' } }),
  };

  it('are permanent for a page request', async () => {
    for (const method of ['GET', 'HEAD']) {
      const response = await worker.fetch(
        new Request('https://vibld.com/pricing/', { method }),
        { ...ENV, ASSETS: store },
      );
      assert.equal(response.status, 301, method);
      assert.equal(response.headers.get('location'), '/pricing');
      // Still carries the headers every response does.
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
  });

  it('keep the method for anything else', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/pricing/', { method: 'POST' }),
      { ...ENV, ASSETS: store },
    );
    assert.equal(response.status, 307);
  });
});
