import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { LEGAL_DOCS, ROUTES, SITE } from '../app/site.ts';

/**
 * These tests read the built site, not the source -- see
 * templates/marketing/test/prerender.test.ts, which this is modeled on. A
 * passing compiler says nothing about whether a crawler or a static host
 * gets a usable page; only the emitted HTML does.
 */

const CLIENT = join(import.meta.dirname, '..', 'build', 'client');

function htmlPathFor(routePath: string): string {
  return routePath === '/'
    ? join(CLIENT, 'index.html')
    : join(CLIENT, routePath.replace(/^\//, ''), 'index.html');
}

function read(routePath: string): string {
  return readFileSync(htmlPathFor(routePath), 'utf8');
}

function tagContent(html: string, attr: string, value: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]*${attr}="${value}"[^>]*content="([^"]*)"|<meta[^>]*content="([^"]*)"[^>]*${attr}="${value}"`,
  );
  const match = pattern.exec(html);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

before(() => {
  // Building here rather than assuming a build exists: a test that silently
  // reads a stale artefact proves nothing about the current source. This runs
  // the package's own build script, not `react-router build` directly, so the
  // postbuild step (robots.txt, sitemap.xml, llms.txt, 404.html) is covered
  // by everything below.
  execFileSync('npm', ['run', 'build'], {
    cwd: join(import.meta.dirname, '..'),
    stdio: 'ignore',
  });
});

describe('every declared route is prerendered', () => {
  for (const route of ROUTES) {
    it(`emits HTML for ${route.path}`, () => {
      const html = read(route.path);
      assert.ok(
        html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'),
        'a static host must receive a complete document',
      );
    });
  }

  it('prerenders nothing that is not a declared top-level route', () => {
    const declared = new Set(
      ROUTES.filter((route) => route.path !== '/' && route.path !== '/legal')
        .map((route) => route.path.replace(/^\//, ''))
        .map((path) => path.split('/')[0]),
    );
    declared.add('legal');
    const emitted = readdirSync(CLIENT).filter(
      (entry) =>
        statSync(join(CLIENT, entry)).isDirectory() &&
        entry !== 'assets' &&
        !entry.startsWith('.'),
    );
    for (const dir of emitted) {
      assert.ok(declared.has(dir), `unexpected prerendered route: ${dir}`);
    }
  });
});

describe('page metadata', () => {
  it('gives every page a unique title and description', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const route of ROUTES) {
      const html = read(route.path);
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
      const description = tagContent(html, 'name', 'description') ?? '';
      assert.ok(title.length > 0, `no title for ${route.path}`);
      assert.ok(description.length > 0, `no description for ${route.path}`);
      titles.add(title);
      descriptions.add(description);
    }
    assert.equal(titles.size, ROUTES.length, 'titles must be unique');
    assert.equal(
      descriptions.size,
      ROUTES.length,
      'descriptions must be unique',
    );
  });

  it('uses absolute URLs in canonical and social metadata', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      const ogUrl = tagContent(html, 'property', 'og:url');
      assert.ok(ogUrl, `og:url missing for ${route.path}`);
      assert.match(ogUrl!, /^https?:\/\//);
      assert.match(html, /rel="canonical"/, `canonical missing ${route.path}`);
    }
  });
});

describe('accessibility basics', () => {
  it('puts the skip link ahead of the header', () => {
    const html = read('/');
    const skip = html.indexOf('Skip to main content');
    const header = html.indexOf('<header');
    assert.ok(skip !== -1, 'no skip link');
    assert.ok(skip < header, 'the skip link must come before the header');
  });

  it('renders a server-rendered heading on every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.match(html, /<h1[^>]*>/, `${route.path} has no <h1>`);
    }
  });
});

describe('the waitlist form', () => {
  it('degrades to a real form post without JavaScript', () => {
    const html = read('/');
    assert.match(html, /<form[^>]*action="\/api\/waitlist"/);
    assert.match(html, /<form[^>]*method="post"/i);
  });

  it('labels the email field', () => {
    const html = read('/');
    // Attribute order follows JSX declaration order (id before name in
    // WaitlistForm.tsx), so this matches the input tag first and pulls id
    // out of it, rather than assuming a fixed attribute order.
    const inputTag = /<input\b[^>]*name="email"[^>]*>/.exec(html)?.[0] ?? '';
    const id = /\bid="([^"]+)"/.exec(inputTag)?.[1];
    assert.ok(id, 'no id on the email input');
    assert.ok(html.includes(`for="${id}"`), 'email input has no label');
  });
});

describe('legal pages', () => {
  it('carries the entity name and mailing address on the Terms page', () => {
    const html = read('/legal/terms');
    assert.ok(html.includes(SITE.legalEntity));
    assert.ok(html.includes('285 W Wieuca Rd NE'));
  });

  it('names Gwinnett County as venue on the Terms page', () => {
    const html = read('/legal/terms');
    assert.match(html, /Gwinnett County/);
  });

  it('links every legal document from the /legal index', () => {
    const html = read('/legal');
    for (const doc of LEGAL_DOCS) {
      assert.ok(
        html.includes(`href="/legal/${doc.slug}"`),
        `/legal does not link to ${doc.slug}`,
      );
    }
  });

  it('links every legal document from the footer on every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      for (const doc of LEGAL_DOCS) {
        assert.ok(
          html.includes(`href="/legal/${doc.slug}"`),
          `${route.path} footer does not link to ${doc.slug}`,
        );
      }
    }
  });
});

describe('security.txt', () => {
  it('is published at the well-known path, per RFC 9116', () => {
    const path = join(CLIENT, '.well-known', 'security.txt');
    assert.ok(
      existsSync(path),
      'public/.well-known/security.txt did not build',
    );
    const body = readFileSync(path, 'utf8');
    assert.match(body, /^Contact: mailto:security@vibld\.com$/m);
    assert.match(body, /^Expires: \d{4}-\d{2}-\d{2}T/m);
  });
});

describe('crawler-facing files', () => {
  it('serves a real robots.txt that points at the sitemap', () => {
    const body = readFileSync(join(CLIENT, 'robots.txt'), 'utf8');
    assert.match(body, /^User-agent: \*$/m);
    assert.match(body, /^Allow: \/$/m);
    assert.match(body, /^Sitemap: https:\/\/[^\s]+\/sitemap\.xml$/m);
  });

  it('lists every declared route in the sitemap, and nothing else', () => {
    const body = readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8');
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locs.length, ROUTES.length);
    for (const route of ROUTES) {
      assert.ok(
        locs.includes(new URL(route.path, SITE.url).toString()),
        `sitemap is missing ${route.path}`,
      );
    }
  });

  it('keeps the 404 page out of the sitemap', () => {
    const body = readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8');
    assert.ok(
      !body.includes('/404'),
      '404 must never be advertised to crawlers',
    );
  });

  it('emits sitemap URLs that match the canonical tags exactly', () => {
    // A sitemap entry that redirects to the canonical URL is a crawl-budget
    // leak; both must name the same, slash-free form.
    const body = readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8');
    for (const route of ROUTES) {
      const canonical =
        /rel="canonical"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*rel="canonical"/.exec(
          read(route.path),
        );
      const href = canonical?.[1] ?? canonical?.[2];
      assert.ok(href, `no canonical on ${route.path}`);
      assert.ok(
        body.includes(`<loc>${href}</loc>`),
        `sitemap/canonical mismatch for ${route.path}`,
      );
    }
  });

  it('publishes llms.txt naming the product and disambiguating the name', () => {
    const body = readFileSync(join(CLIENT, 'llms.txt'), 'utf8');
    assert.match(body, /^# Vibld$/m);
    // The brand is read by search engines as a misspelling of "Bible"; the
    // file has to say plainly what the word means.
    assert.match(body, /vibe/i);
    assert.match(body, /Bible/);
  });
});

describe('the 404 page', () => {
  it('is emitted where not_found_handling can serve it', () => {
    const html = readFileSync(join(CLIENT, '404.html'), 'utf8');
    assert.match(html, /Page not found/);
  });

  it('is marked noindex', () => {
    const html = readFileSync(join(CLIENT, '404.html'), 'utf8');
    assert.match(
      html,
      /name="robots"[^>]*content="noindex"|content="noindex"[^>]*name="robots"/,
    );
  });

  it('leaves no /404 route behind that would answer 200', () => {
    assert.ok(
      !existsSync(join(CLIENT, '404', 'index.html')),
      'postbuild must remove the prerendered /404 directory',
    );
  });
});

describe('social and structured metadata', () => {
  it('gives every page an og:image that was actually built', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      const image = tagContent(html, 'property', 'og:image');
      assert.ok(image, `og:image missing for ${route.path}`);
      assert.match(image!, /^https?:\/\//);
    }
    // twitter:card promises a large image; it has to exist on disk.
    assert.ok(
      existsSync(join(CLIENT, 'og.png')),
      'public/og.png did not build',
    );
  });

  it('publishes Organization and WebSite schema on the home page', () => {
    const html = read('/');
    const block =
      /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/.exec(html);
    assert.ok(block, 'no JSON-LD on the home page');
    const graph = JSON.parse(block![1]);
    const types = graph['@graph'].map(
      (node: { '@type': string }) => node['@type'],
    );
    assert.deepEqual(types.sort(), ['Organization', 'WebSite']);
  });

  it('links the source repository via sameAs, the entity signal for the name', () => {
    const html = read('/');
    const block =
      /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/.exec(html);
    const org = JSON.parse(block![1])['@graph'].find(
      (node: { '@type': string }) => node['@type'] === 'Organization',
    );
    assert.ok(org.sameAs.includes(SITE.github));
  });
});
