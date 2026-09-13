import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractReadableText,
  fetchReferenceContext,
  parseReferenceTarget,
} from '../worker/reference-fetch.ts';

function htmlResponse(body: string, contentType = 'text/html; charset=utf-8') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('parseReferenceTarget', () => {
  it('accepts an https URL', () => {
    const result = parseReferenceTarget('https://example.com/pricing');
    assert.equal(result.ok, true);
  });

  it('rejects an unparseable string', () => {
    const result = parseReferenceTarget('not a url');
    assert.equal(result.ok, false);
  });

  it('rejects a non-http(s) protocol', () => {
    for (const url of [
      'ftp://example.com/file',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
    ]) {
      const result = parseReferenceTarget(url);
      assert.equal(result.ok, false, `${url} must be rejected`);
    }
  });

  it('rejects loopback and link-local hosts', () => {
    for (const url of [
      'http://localhost/',
      'http://127.0.0.1/',
      'http://127.5.5.5/',
      'http://169.254.169.254/latest/meta-data/',
      'http://a.internal/',
      'http://foo.localhost/',
    ]) {
      const result = parseReferenceTarget(url);
      assert.equal(result.ok, false, `${url} must be rejected`);
    }
  });
});

describe('extractReadableText', () => {
  it('strips tags, scripts and styles down to visible text', () => {
    const html = `<html><head><style>.a{color:red}</style></head>
      <body><script>alert(1)</script><h1>Hello&amp; welcome</h1>
      <p>Some <b>bold</b> text.</p></body></html>`;
    const text = extractReadableText(html);
    assert.ok(!text.includes('alert'));
    assert.ok(!text.includes('color:red'));
    assert.ok(!text.includes('<'));
    assert.match(text, /Hello& welcome/);
    assert.match(text, /Some\s+bold\s+text\./);
  });

  it('returns empty text for markup with no visible content', () => {
    const text = extractReadableText('<script>only(script)</script>');
    assert.equal(text, '');
  });

  it('strips a script/style element whatever its closing tag contains before ">"', () => {
    // CodeQL js/incomplete-html-attribute-sanitization, twice: a bare
    // `</script>` pattern missed `</script >`; requiring only whitespace
    // then missed `</script\t\n bar>` -- a real tokenizer closes the
    // element at the next `>` regardless of what comes before it.
    const text = extractReadableText(
      '<style>.a{color:red}</style ><script>alert(1)</script\t\n bar>Visible',
    );
    assert.ok(!text.includes('alert'));
    assert.ok(!text.includes('color:red'));
    assert.match(text, /Visible/);
  });

  it('does not double-unescape a page\'s own literal "&amp;lt;" into a real "<"', () => {
    // CodeQL js/double-escaping: decoding &amp; before &lt;/&gt; turns a
    // source page's doubly-encoded entity (which decodes once to the
    // literal text "&lt;") into an actual "<" -- reconstituting markup the
    // source page had safely escaped.
    const text = extractReadableText(
      '<p>Use &amp;lt;div&amp;gt; like this</p>',
    );
    assert.match(text, /&lt;div&gt;/);
    assert.ok(!text.includes('<div>'));
  });
});

describe('fetchReferenceContext', () => {
  it('extracts and returns text from a fetched page', async () => {
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async () =>
        htmlResponse(
          '<html><body><h1>Acme</h1><p>We sell widgets.</p></body></html>',
        )) as unknown as typeof fetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.text, /Acme/);
      assert.match(result.text, /We sell widgets\./);
    }
  });

  it('sends a real browser User-Agent -- a Worker default reads as a script to many WAFs', async () => {
    // Reproduces the reported bug: an ordinary marketing site 403ing every
    // request because a bare Worker fetch carries no User-Agent at all.
    let sentHeaders: Record<string, string> | undefined;
    await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        sentHeaders = init?.headers as Record<string, string>;
        return htmlResponse('<p>x</p>');
      }) as unknown as typeof fetch,
    });
    assert.ok(sentHeaders?.['user-agent']);
    assert.match(sentHeaders!['user-agent'], /Mozilla/);
  });

  it('rejects an invalid URL before ever fetching', async () => {
    let called = false;
    const result = await fetchReferenceContext('not a url', {
      fetchImpl: (async () => {
        called = true;
        return htmlResponse('<p>x</p>');
      }) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  it('reports a non-2xx response rather than proceeding with nothing', async () => {
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async () =>
        new Response('not found', { status: 404 })) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /404/);
  });

  it('reports a network failure', async () => {
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /could not be reached/);
  });

  it('refuses a non-HTML, non-text content type', async () => {
    const result = await fetchReferenceContext('https://example.com/logo.png', {
      fetchImpl: (async () =>
        htmlResponse('binary', 'image/png')) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /HTML or text/);
  });

  it('reports a page with no extractable text rather than an empty success', async () => {
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async () =>
        htmlResponse(
          '<script>only(script)</script>',
        )) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /No readable text/);
  });

  function redirectTo(location: string, status = 302) {
    return new Response(null, { status, headers: { location } });
  }

  const PAGE_WITH_SHEET =
    '<html><head><link rel="stylesheet" href="theme.css"></head>' +
    '<body><p>Widgets for everyone.</p></body></html>';

  it('resolves stylesheets against where the response landed, not where it was asked', async () => {
    // A reference URL that really redirects into a subdirectory: resolving
    // `href="theme.css"` against the requested URL gives /theme.css, which
    // is not where the file is.
    const asked: string[] = [];
    await fetchReferenceContext('https://example.com/old', {
      fetchImpl: (async (url: string) => {
        asked.push(url);
        if (url === 'https://example.com/old') {
          return redirectTo('https://example.com/products/page/');
        }
        if (url.endsWith('.css')) return htmlResponse('a{color:#c0392b}');
        return htmlResponse(PAGE_WITH_SHEET);
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(asked, [
      'https://example.com/old',
      'https://example.com/products/page/',
      'https://example.com/products/page/theme.css',
    ]);
  });

  it('refuses a page redirect into a host it would not have fetched', async () => {
    // `fetch` follows redirects itself unless told not to, which undoes the
    // guard entirely: the only URL checked would be the one before the
    // redirect. The metadata address is why this matters.
    const asked: string[] = [];
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async (url: string) => {
        asked.push(url);
        if (url === 'https://example.com/') {
          return redirectTo('http://169.254.169.254/latest/meta-data/');
        }
        return htmlResponse('<p>secrets</p>');
      }) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(asked, ['https://example.com/']);
  });

  it('refuses a stylesheet redirect into a host it would not have fetched', async () => {
    const asked: string[] = [];
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async (url: string) => {
        asked.push(url);
        if (url.endsWith('theme.css')) {
          return redirectTo('http://127.0.0.1/admin');
        }
        if (url.includes('127.0.0.1')) return htmlResponse('a{color:#c0392b}');
        return htmlResponse(PAGE_WITH_SHEET);
      }) as unknown as typeof fetch,
    });
    // The page still succeeds: a stylesheet is a bonus, never a reason to
    // fail a run.
    assert.equal(result.ok, true);
    assert.ok(
      !asked.some((url) => url.includes('127.0.0.1')),
      `fetched ${asked.join(', ')}`,
    );
  });

  it('gives up on a redirect loop rather than following it forever', async () => {
    let asked = 0;
    const result = await fetchReferenceContext('https://example.com/a', {
      fetchImpl: (async (url: string) => {
        asked += 1;
        return redirectTo(url.endsWith('/a') ? '/b' : '/a');
      }) as unknown as typeof fetch,
    });
    assert.equal(result.ok, false);
    assert.ok(asked <= 7, `made ${asked} requests`);
  });

  it('follows an ordinary same-site redirect', async () => {
    const result = await fetchReferenceContext('https://example.com/old', {
      fetchImpl: (async (url: string) =>
        url.endsWith('/old')
          ? redirectTo('https://example.com/new')
          : htmlResponse(
              '<p>Widgets for everyone.</p>',
            )) as unknown as typeof fetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.text, /Widgets/);
  });

  it('fetches the stylesheets together, so their timeouts do not stack', async () => {
    // Two sheets under one deadline, not two deadlines in sequence. Proven
    // by both requests being in flight before either has answered: a
    // sequential loop cannot produce that ordering.
    const started: string[] = [];
    let firstSettled = false;
    let secondStartedBeforeFirstSettled = false;
    await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async (url: string) => {
        if (url.endsWith('.css')) {
          started.push(url);
          if (started.length === 2 && !firstSettled) {
            secondStartedBeforeFirstSettled = true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          firstSettled = true;
          return htmlResponse('a{color:#c0392b}');
        }
        return htmlResponse(
          '<html><head>' +
            '<link rel="stylesheet" href="/one.css">' +
            '<link rel="stylesheet" href="/two.css">' +
            '</head><body><p>Widgets for everyone.</p></body></html>',
        );
      }) as unknown as typeof fetch,
    });
    assert.equal(started.length, 2);
    assert.ok(secondStartedBeforeFirstSettled, 'sheets were fetched in series');
  });

  it('truncates text longer than maxChars', async () => {
    const long = 'word '.repeat(2000);
    const result = await fetchReferenceContext('https://example.com/', {
      fetchImpl: (async () =>
        htmlResponse(`<p>${long}</p>`)) as unknown as typeof fetch,
      maxChars: 100,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.text.length <= 101);
      assert.ok(result.text.endsWith('…'));
    }
  });
});
