import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * What a crawler is told about the builder host.
 *
 * Found by asking production rather than by reading the code:
 * `app.vibld.com/robots.txt` answered `200 text/html`, because the Worker's
 * SPA fallback serves the application shell for any path it does not
 * recognise. A crawler reading that gets a page of markup where the rules
 * should be, which it treats as "no rules" rather than as "no".
 *
 * The first fix was `Disallow: /` beside a `noindex` meta, which is
 * self-defeating and was defended here with a comment that had the
 * dependency backwards (#192 review). A crawler that obeys the refusal
 * never fetches the page, so it never reads the tag, and a URL found from a
 * shared link stays listed with no description. Refusing the fetch protects
 * the bytes and leaves the listing.
 *
 * So the rule under test is the opposite of what it looks like: crawling is
 * allowed, and the directive travels with the response.
 */

function webFile(...parts: string[]): string {
  return join(fileURLToPath(new URL('../', import.meta.url)), ...parts);
}

describe('what the builder host tells a crawler', () => {
  it('serves a real robots.txt rather than the application shell', async () => {
    // A file in `public/` is served as an asset, which is what stops the
    // SPA fallback from answering this path with HTML.
    const robots = await readFile(webFile('public', 'robots.txt'), 'utf8');
    assert.match(robots, /^User-agent: \*$/m);
  });

  it('lets a crawler fetch, so the directive can be read at all', async () => {
    // The correction (#192 review). `Disallow: /` would stop a compliant
    // crawler fetching the page, and the noindex it would have found there
    // is the only thing that removes an existing listing.
    const robots = await readFile(webFile('public', 'robots.txt'), 'utf8');
    assert.doesNotMatch(
      robots,
      /^Disallow: \/\s*$/m,
      'the refusal is back, and it blocks the directive that does the work',
    );
    assert.match(robots, /^Allow: \/$/m);
  });

  it('sends the directive with the response, not only in the markup', async () => {
    // A header does not depend on the crawler parsing HTML and covers the
    // responses that are not HTML at all.
    const headers = await readFile(webFile('public', '_headers'), 'utf8');
    assert.match(
      headers,
      /^\s*x-robots-tag: noindex, nofollow$/m,
      'the asset store serves the shell without an indexing directive',
    );
  });

  it('keeps the meta as a second copy for whatever reads the document', async () => {
    const html = await readFile(webFile('index.html'), 'utf8');
    assert.match(
      html,
      /<meta\s+name="robots"\s+content="noindex, nofollow"\s*\/>/,
    );
  });

  it('does not tell the marketing site not to be indexed', async () => {
    // The reason this lives in the app rather than in SECURITY_HEADERS:
    // that object is shared, and vibld.com wants to be found.
    const shared = await readFile(
      join(
        fileURLToPath(
          new URL('../../../packages/security-headers/src/', import.meta.url),
        ),
        'index.ts',
      ),
      'utf8',
    );
    assert.doesNotMatch(
      shared,
      /'x-robots-tag'/,
      'the indexing directive is in the set both sites send',
    );
  });

  it('sends the crawler where the public product actually is', async () => {
    // A refusal with nowhere to go is worse than it needs to be: the
    // marketing site welcomes crawlers and carries the sitemap.
    const robots = await readFile(webFile('public', 'robots.txt'), 'utf8');
    assert.match(robots, /Sitemap: https:\/\/vibld\.com\/sitemap\.xml/);
  });
});
