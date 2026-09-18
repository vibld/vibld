import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SECURITY_HEADERS, headersFile, secured } from '../src/index.ts';

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
