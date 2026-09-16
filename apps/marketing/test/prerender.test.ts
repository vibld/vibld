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
  it('gives every page a way into the product', () => {
    // The gap this closes: the site had four calls to join the waitlist,
    // nine legal pages, and no link to app.vibld.com anywhere. Someone who
    // already had an account had no way in from the front door.
    //
    // Asserted on the built HTML of every route rather than on the component,
    // because the header is what would quietly stop being rendered.
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.ok(
        html.includes(`href="${SITE.appUrl}"`),
        `${route.path} has no link to the app`,
      );
    }
  });

  it('names the site in every title, with nothing dangling', () => {
    // The check that was missing. An em-dash sweep rewrote
    // `X -- ${SITE.name}` as `X | `, which removed the site name from all
    // ten titles rather than replacing the separator. Every title stayed
    // non-empty and unique, so the assertions below passed while the home
    // page's title no longer contained the word Vibld at all.
    //
    // The <title> is the strongest on-page signal that this site is the
    // Vibld entity, and searching the name already returns other things, so
    // losing it is not cosmetic.
    for (const route of ROUTES) {
      const title = /<title>([^<]*)<\/title>/.exec(read(route.path))?.[1] ?? '';
      assert.ok(
        title.includes(SITE.name),
        `title for ${route.path} does not name the site: "${title}"`,
      );
      assert.equal(
        title,
        title.trim(),
        `title for ${route.path} has surrounding whitespace: "${title}"`,
      );
      for (const separator of ['|', '-', ':']) {
        assert.ok(
          !title.startsWith(separator) && !title.endsWith(separator),
          `title for ${route.path} has a dangling "${separator}": "${title}"`,
        );
      }
    }
  });

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

  it('names the brand in every page title', () => {
    // Searching "vibld" returns Bible-study sites, so the <title> is the
    // strongest on-page signal that this site is the Vibld entity. A sweep
    // over the title strings once dropped ${SITE.name} from all ten of them
    // and left a dangling separator; nothing caught it, because the titles
    // were still present and still unique.
    for (const route of ROUTES) {
      const title = /<title>([^<]*)<\/title>/.exec(read(route.path))?.[1] ?? '';
      assert.ok(
        title.includes(SITE.name),
        `${route.path} title does not name ${SITE.name}: ${JSON.stringify(title)}`,
      );
      assert.ok(
        !/^[\s|]|[\s|]$/.test(title),
        `${route.path} title has a dangling separator: ${JSON.stringify(title)}`,
      );
    }
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

describe('Google Analytics', () => {
  it('requests nothing from Google before the visitor has agreed', () => {
    // The guarantee the Cookie Notice makes, checked against the bytes a
    // visitor actually receives. A prerendered page is what everyone gets
    // before any script of ours has decided anything, so a tag in here is a
    // tag that loaded without consent.
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.ok(
        !html.includes('googletagmanager.com'),
        `${route.path} loads gtag.js before anyone has agreed`,
      );
      assert.ok(
        !html.includes(SITE.ga4MeasurementId),
        `${route.path} carries the GA4 property id in its static HTML`,
      );
    }
  });

  it('still has the tag to load once somebody does agree', () => {
    // The pair that matters: the assertion above passes just as well if GA4
    // was deleted, so this one fails if it was. Both together say "not
    // before consent", rather than "not at all".
    const assets = join(CLIENT, 'assets');
    const bundle = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assets, name), 'utf8'))
      .join('\n');
    assert.ok(
      bundle.includes(SITE.ga4MeasurementId),
      'nothing in the client can load GA4 at all',
    );
    assert.ok(
      bundle.includes('googletagmanager.com'),
      'the client has no loader for GA4',
    );
  });

  it('denies every advertising signal wherever consent is declared', () => {
    const assets = join(CLIENT, 'assets');
    const bundle = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assets, name), 'utf8'))
      .join('\n');
    for (const signal of ['ad_storage', 'ad_user_data', 'ad_personalization']) {
      assert.ok(bundle.includes(signal), `${signal} is never declared`);
    }
    assert.ok(
      !bundle.includes('ad_storage:"granted"') &&
        !bundle.includes("ad_storage:'granted'"),
      'an advertising signal is granted somewhere',
    );
  });

  it('sends no page_view of its own, which would double-count', () => {
    // GA4's Enhanced Measurement counts page changes made through the History
    // API, which is how React Router's Link navigates. An explicit page_view
    // beside it records every internal navigation twice, and the site is nine
    // legal pages reachable only by internal link, so the inflation would be
    // most of the traffic.
    const assets = join(CLIENT, 'assets');
    const scripts = readdirSync(assets).filter((name) => name.endsWith('.js'));
    assert.ok(scripts.length > 0, 'no client bundle to check');
    for (const name of scripts) {
      const code = readFileSync(join(assets, name), 'utf8');
      assert.ok(
        !code.includes('page_view'),
        `${name} sends a page_view, which GA4 Enhanced Measurement already sends`,
      );
    }
  });

  it('offers a way to change the answer on every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.ok(
        html.includes('Cookie preferences'),
        `${route.path} has no way to reopen the consent choice`,
      );
    }
  });

  it('prerenders no banner, since the stored answer is not knowable here', () => {
    // A banner baked into the static HTML is one a crawler reads and one that
    // flashes for every visitor who already answered.
    const html = read('/');
    assert.ok(
      !html.includes('aria-label="Analytics cookies"'),
      'the consent banner was server-rendered',
    );
  });

  // These two are here rather than with the legal pages on purpose. The Cookie
  // Notice describes when GA4 loads, and that description is only true because
  // of the code above, so it is part of shipping the tag rather than a
  // separate chore.
  it('is disclosed in the Cookie Notice, cookies and identifier named', () => {
    const html = read('/legal/cookies');
    assert.match(html, /Google Analytics/);
    assert.match(html, /sets cookies in your browser/);
    assert.match(html, /client identifier/);
    assert.match(html, /we do not load it at all/);
  });

  it('names Google as a current subprocessor, not a planned one', () => {
    const html = read('/legal/subprocessors');
    const google = html.indexOf('Google LLC');
    const planned = html.indexOf('Planned for product launch');
    assert.notEqual(google, -1, 'Google is not listed as a subprocessor');
    assert.notEqual(planned, -1, 'the planned table is gone, so this is stale');
    assert.ok(
      google < planned,
      'Google is processing data today, so it belongs in the current table',
    );
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
    // This file is read by assistants answering questions about Vibld, so a
    // claim in it going stale is the same kind of problem as a stale legal
    // page. It said there was no product to sign up for while every page
    // header linked to the builder.
    assert.ok(
      body.includes(SITE.appUrl),
      'llms.txt does not name the builder that every page links to',
    );
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
      existsSync(join(CLIENT, 'og-image.png')),
      'public/og-image.png did not build',
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
    assert.ok(org.sameAs.includes(SITE.repoUrl));
  });
});
