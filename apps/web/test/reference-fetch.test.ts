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

  it('strips a script/style element whose closing tag has whitespace before ">"', () => {
    // CodeQL js/incomplete-html-attribute-sanitization: a bare `</script>`
    // pattern misses this real-world closing-tag shape and lets the
    // script's contents leak through as "text".
    const text = extractReadableText(
      '<style>.a{color:red}</style ><script>alert(1)</script\n>Visible',
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
