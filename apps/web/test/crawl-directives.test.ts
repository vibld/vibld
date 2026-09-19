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
 * For an invite-only product that is the wrong default in the one direction
 * that cannot be taken back: a URL, once indexed, stays indexed.
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
    assert.match(
      robots,
      /^Disallow: \/$/m,
      'the builder host invites crawling of a product that needs an account',
    );
  });

  it('also asks not to be indexed, which robots.txt does not cover', async () => {
    // The two fail independently. robots.txt asks a crawler not to fetch;
    // a URL shared anywhere can still be indexed without ever being
    // fetched, and only the meta tag speaks to that.
    const html = await readFile(webFile('index.html'), 'utf8');
    assert.match(
      html,
      /<meta\s+name="robots"\s+content="noindex, nofollow"\s*\/>/,
      'the shell can be indexed from a shared link without being crawled',
    );
  });

  it('sends the crawler where the public product actually is', async () => {
    // A refusal with nowhere to go is worse than it needs to be: the
    // marketing site welcomes crawlers and carries the sitemap.
    const robots = await readFile(webFile('public', 'robots.txt'), 'utf8');
    assert.match(robots, /Sitemap: https:\/\/vibld\.com\/sitemap\.xml/);
  });
});
