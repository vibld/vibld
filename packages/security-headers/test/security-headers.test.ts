import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PUBLISHED_SITE_HEADERS,
  SECURITY_HEADERS,
  headersFile,
  secured,
  withDefaultHeaders,
} from '../src/index.ts';

describe('the headers both sites send', () => {
  it('names every header in lower case', () => {
    // Not a style rule: `secured` reads them back off a `Headers`, which
    // lower-cases, and `headersFile` writes them into a text file that
    // nothing normalises. One spelling is what lets both do that.
    for (const name of Object.keys(SECURITY_HEADERS)) {
      assert.equal(name, name.toLowerCase());
    }
  });

  it('promises nothing on behalf of a subdomain that does not exist yet', () => {
    // `includeSubDomains` and `preload` are close to irreversible. If either
    // is ever wanted it should be a decision somebody makes, not something
    // that arrives with a tidy-up.
    const hsts = SECURITY_HEADERS['strict-transport-security'];
    assert.ok(hsts);
    assert.ok(!hsts.includes('includeSubDomains'));
    assert.ok(!hsts.includes('preload'));
  });

  it('restricts framing and nothing else', () => {
    // The policy is deliberately not a script policy (see the module's own
    // note). This fails if one arrives without the verification that would
    // make it safe, which is the failure mode worth catching: a blank
    // production site is more expensive than a missing directive.
    const csp = SECURITY_HEADERS['content-security-policy'];
    assert.equal(csp, "frame-ancestors 'none'");
  });
});

describe('securing a response', () => {
  it('adds every header', async () => {
    const secure = secured(new Response('hello'));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(secure.headers.get(name), value);
    }
    assert.equal(await secure.text(), 'hello');
  });

  it('keeps the status, the status text and the other headers', () => {
    const secure = secured(
      new Response(null, {
        status: 301,
        statusText: 'Moved Permanently',
        headers: { location: 'https://vibld.com/' },
      }),
    );
    assert.equal(secure.status, 301);
    assert.equal(secure.statusText, 'Moved Permanently');
    assert.equal(secure.headers.get('location'), 'https://vibld.com/');
  });

  it('works on a response whose headers cannot be written', () => {
    // What a binding hands back: `Response.redirect` produces immutable
    // headers, the same as `env.ASSETS.fetch` does. Mutating in place threw
    // here, which is why this rebuilds.
    const fromBinding = Response.redirect('https://vibld.com/', 302);
    assert.throws(() => fromBinding.headers.set('x-test', '1'));
    assert.equal(
      secured(fromBinding).headers.get('x-content-type-options'),
      'nosniff',
    );
  });

  it('does not read a streamed body', async () => {
    // A generation streams for minutes. Reading it here to rebuild the
    // response would buffer the whole run before the first byte reached the
    // browser.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
        controller.close();
      },
    });
    const secure = secured(new Response(stream));
    assert.equal(await secure.text(), 'chunk');
  });
});

describe('the asset store’s copy', () => {
  it('carries the same headers as the Worker sends', () => {
    const file = headersFile();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.ok(
        file.includes(`\n  ${name}: ${value}\n`),
        `${name} is missing from the _headers file`,
      );
    }
  });

  it('applies them to every path', () => {
    // `not_found_handling` is single-page-application, so an unknown path is
    // the shell rather than a miss. A narrower pattern would leave the
    // shell's own URLs uncovered.
    assert.match(headersFile(), /^\/\*$/m);
  });
});

describe('the defaults a published site gets (D64)', () => {
  it('names every header in lower case', () => {
    for (const name of Object.keys(PUBLISHED_SITE_HEADERS)) {
      assert.equal(name, name.toLowerCase());
    }
  });

  it('restricts neither what the page loads nor who frames it', () => {
    // A user's site embeds videos, maps and forms, loads fonts and scripts
    // from wherever it likes, and may itself be embedded. Any of these would
    // break some of them.
    assert.equal(PUBLISHED_SITE_HEADERS['content-security-policy'], undefined);
    assert.equal(
      PUBLISHED_SITE_HEADERS['content-security-policy-report-only'],
      undefined,
    );
    assert.equal(PUBLISHED_SITE_HEADERS['x-frame-options'], undefined);
    assert.equal(
      PUBLISHED_SITE_HEADERS['cross-origin-embedder-policy'],
      undefined,
    );
    assert.equal(
      PUBLISHED_SITE_HEADERS['cross-origin-opener-policy'],
      undefined,
    );
    assert.equal(
      PUBLISHED_SITE_HEADERS['cross-origin-resource-policy'],
      undefined,
    );
  });

  it('sends HSTS for the site alone', () => {
    const hsts = PUBLISHED_SITE_HEADERS['strict-transport-security'];
    assert.equal(hsts, 'max-age=31536000');
  });

  it('denies the device and payment features, and nothing an embed uses', () => {
    const policy = PUBLISHED_SITE_HEADERS['permissions-policy'] ?? '';
    const denied = new Set(
      policy.split(',').map((entry) => entry.trim().replace(/=\(\)$/, '')),
    );
    for (const feature of [
      'camera',
      'microphone',
      'geolocation',
      'payment',
      'usb',
    ]) {
      assert.ok(denied.has(feature), `${feature} is not denied`);
    }
    // What a YouTube, Vimeo, Spotify or 3D-viewer iframe asks its page to
    // delegate. The top-level policy binds every frame on the page, so
    // denying one of these here would break the embed.
    for (const feature of [
      'autoplay',
      'fullscreen',
      'encrypted-media',
      'picture-in-picture',
      'clipboard-write',
      'web-share',
      'accelerometer',
      'gyroscope',
      'xr-spatial-tracking',
    ]) {
      assert.ok(!denied.has(feature), `${feature} would break embeds`);
    }
    // Every entry is a denial; an allowlist here would be a decision about
    // somebody else's site.
    assert.ok(policy.split(',').every((entry) => /=\(\)$/.test(entry.trim())));
  });
});

describe('adding defaults to a response', () => {
  it('adds each one the response does not carry', async () => {
    const response = withDefaultHeaders(
      new Response('hello'),
      PUBLISHED_SITE_HEADERS,
    );
    for (const [name, value] of Object.entries(PUBLISHED_SITE_HEADERS)) {
      assert.equal(response.headers.get(name), value);
    }
    assert.equal(await response.text(), 'hello');
  });

  it('keeps one the response already carries, whatever its case', () => {
    const response = withDefaultHeaders(
      new Response('hello', {
        headers: {
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'geolocation=(self)',
        },
      }),
      PUBLISHED_SITE_HEADERS,
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(
      response.headers.get('permissions-policy'),
      'geolocation=(self)',
    );
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  it('keeps the status and works on headers that cannot be written', () => {
    const fromBinding = Response.redirect(
      'https://acme.vibld-preview.dev/',
      302,
    );
    const response = withDefaultHeaders(fromBinding, PUBLISHED_SITE_HEADERS);
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get('location'),
      'https://acme.vibld-preview.dev/',
    );
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});
