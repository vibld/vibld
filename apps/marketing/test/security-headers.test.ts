import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SECURITY_HEADERS } from '@vibld/security-headers';

import worker from '../worker/index.ts';

/**
 * That vibld.com actually sends them (task #52).
 *
 * The package's own tests prove `secured` adds the headers to a response.
 * These prove this site's responses go through it, which is the part that
 * was missing: the site was sending none of HSTS, nosniff, Referrer-Policy,
 * frame-ancestors or Permissions-Policy, verified against the live origin.
 *
 * Every kind of response this Worker can produce is checked, not one of
 * them. A `_headers` file cannot cover any of them (Cloudflare never
 * applies one to a response a Worker generated) and `run_worker_first` is
 * `true` here, so every byte this site serves comes out of this handler.
 */

const ENV = { RESEND_API_KEY: 're_test_key' };

function assertSecured(response: Response, what: string) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(
      response.headers.get(name),
      value,
      `${what} is missing ${name}`,
    );
  }
}

describe('what vibld.com sends with every response', () => {
  it('secures a page served from the asset store', async () => {
    const response = await worker.fetch(new Request('https://vibld.com/'), {
      ...ENV,
      ASSETS: {
        fetch: async () =>
          new Response('<!doctype html><title>Vibld</title>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      },
    });
    assert.equal(response.status, 200);
    assertSecured(response, 'a page');
    // The asset store's own headers survive: this wraps the response rather
    // than replacing it.
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  });

  it('secures the www redirect', async () => {
    // The redirect is the first thing this Worker does, before any route, so
    // it is the response most likely to be reached by a path that forgot
    // something.
    const response = await worker.fetch(
      new Request('https://www.vibld.com/legal/privacy'),
      ENV,
    );
    assert.equal(response.status, 301);
    assert.equal(
      response.headers.get('location'),
      'https://vibld.com/legal/privacy',
    );
    assertSecured(response, 'the www redirect');
  });

  it('secures a 404', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/api/nope'),
      ENV,
    );
    assert.equal(response.status, 404);
    assertSecured(response, 'a 404');
  });

  it('secures an API answer', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/api/waitlist', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
      ENV,
    );
    assert.equal(response.status, 400);
    assertSecured(response, 'a rejected signup');
  });

  it('secures a preview’s noindex response too', async () => {
    // Two wrappers on one response, which is where an ordering mistake
    // would show: `noindex` rebuilds the response as well.
    const response = await worker.fetch(new Request('https://vibld.com/'), {
      ...ENV,
      VIBLD_NOINDEX: '1',
      ASSETS: { fetch: async () => new Response('<!doctype html>') },
    });
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assertSecured(response, 'a preview page');
  });
});
