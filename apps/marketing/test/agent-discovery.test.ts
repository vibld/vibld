import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  API_SPEC,
  API_STATUS,
  AUTHORIZATION_METADATA_PATHS,
  authorizationMetadata,
  HOME_LINKS,
} from '../worker/agent-discovery.ts';
import worker from '../worker/index.ts';

const html = (body: string) => ({
  async fetch() {
    return new Response(body, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
});

describe('the API catalog', () => {
  it('lists the builder API, its description, guide and status as a linkset', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/.well-known/api-catalog'),
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    assert.equal(
      response.headers.get('link'),
      '</.well-known/api-catalog>; rel="api-catalog"',
    );
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await response.json(), {
      linkset: [
        {
          anchor: 'https://app.vibld.com/api',
          'service-desc': [
            { href: API_SPEC, type: 'application/vnd.oai.openapi+json' },
          ],
          'service-doc': [
            { href: 'https://vibld.com/docs/api', type: 'text/html' },
          ],
          status: [{ href: API_STATUS, type: 'application/json' }],
        },
      ],
    });
  });

  it('answers HEAD with the headers and no body, and refuses a write', async () => {
    const head = await worker.fetch(
      new Request('https://vibld.com/.well-known/api-catalog', {
        method: 'HEAD',
      }),
      {},
    );
    assert.equal(head.status, 200);
    assert.match(head.headers.get('link') ?? '', /rel="api-catalog"/);
    assert.equal(await head.text(), '');

    const post = await worker.fetch(
      new Request('https://vibld.com/.well-known/api-catalog', {
        method: 'POST',
      }),
      {},
    );
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  });
});

describe("the home page's Link header", () => {
  it('points at the catalog, the description, the guide and llms.txt', async () => {
    const response = await worker.fetch(new Request('https://vibld.com/'), {
      ASSETS: html('<!doctype html>'),
    });
    const link = response.headers.get('link') ?? '';
    assert.equal(link, HOME_LINKS);
    for (const rel of [
      'api-catalog',
      'service-desc',
      'service-doc',
      'describedby',
    ]) {
      assert.match(link, new RegExp(`rel="${rel}"`));
    }
    // Still the security headers every response carries.
    assert.ok(response.headers.get('content-security-policy'));
  });

  it('is on the home page only', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/pricing'),
      { ASSETS: html('<!doctype html>') },
    );
    assert.equal(response.headers.get('link'), null);
  });
});

describe('the sign-in metadata', () => {
  for (const path of AUTHORIZATION_METADATA_PATHS) {
    it(`redirects ${path} to Clerk's own document`, () => {
      for (const method of ['GET', 'HEAD']) {
        const response = authorizationMetadata(
          new Request(`https://vibld.com${path}`, { method }),
        );
        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get('location'),
          `https://clerk.vibld.com${path}`,
        );
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
      }
    });
  }

  it('is routed by the Worker, and refuses a write', async () => {
    const post = await worker.fetch(
      new Request('https://vibld.com/.well-known/oauth-authorization-server', {
        method: 'POST',
      }),
      {},
    );
    assert.equal(post.status, 405);
  });
});
