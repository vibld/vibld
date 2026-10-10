import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { LAYERS } from '../app/layers.ts';
import {
  DOC_GUIDES,
  DOC_TRACKS,
  LEGAL_DOCS,
  PRODUCT_PAGES,
  ROUTES,
  ROUTE_PATHS,
  SITE,
  guidesIn,
} from '../app/site.ts';
import { PROVIDER_NAMES } from '@vibld/ai/select-client';
import { STYLE_GALLERY_INDEX } from '@vibld/ai/style-gallery-index';
import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import { LOG } from '../app/demo-script.ts';
import { dollars, priceLabel, readPlans } from '../app/plans.ts';
import { USE_CASES } from '../app/use-cases.ts';
import { STYLE_CARD_CHUNK, STYLE_CARD_PATHS } from '../app/style-cards.ts';
import { TEMPLATES } from '../app/templates.ts';
import { ROADMAP_GROUPS, ROADMAP_ITEMS, VOTABLE_IDS } from '../app/roadmap.ts';

/**
 * These tests read the built site, not the source -- see
 * templates/marketing/test/prerender.test.ts, which this is modeled on. A
 * passing compiler says nothing about whether a crawler or a static host
 * gets a usable page; only the emitted HTML does.
 */

const CLIENT = join(import.meta.dirname, '..', 'build', 'client');

/**
 * The loader's path, which is what these tests look for.
 *
 * Deliberately not the hostname. CodeQL reads `includes('<a host>')` as an
 * attempt to validate a URL, which is a real and dangerous mistake in
 * anything that makes a decision from the result, and it has no way to tell
 * that this one is a test asserting on a blob of HTML. The path is just as
 * unique to gtag.js, and it is not a hostname, so the assertion says the same
 * thing without impersonating a security check.
 */
const GA4_PATH = '/gtag/js';

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
  //
  // The build's errors go to the test's own stderr: with nothing shown, a
  // failed build in CI said only "Command failed: npm run build" (internal PR 356).
  execFileSync('npm', ['run', 'build'], {
    cwd: join(import.meta.dirname, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
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
    // `assets` is Vite's output and `fonts` is the self-hosted type
    // (public/fonts). Both are directories of files, never pages, and the
    // fonts test below checks the second holds nothing else. `layers` holds
    // the layers' reference pages (app/layers.ts), copied from public/
    // rather than prerendered; the links test checks each one is there.
    // `og` holds the templates' share images (template-preview.test.ts).
    const emitted = readdirSync(CLIENT).filter(
      (entry) =>
        statSync(join(CLIENT, entry)).isDirectory() &&
        entry !== 'assets' &&
        entry !== 'fonts' &&
        entry !== 'layers' &&
        entry !== 'og' &&
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

  it('gives every page a way to see what the product makes', () => {
    // The same gap one page along. /styles was prerendered, in the sitemap,
    // and linked only from the builder's style legend, which is behind the
    // sign-in the catalogue exists to precede: a crawler could find the
    // answer to "what does this actually do" and a visitor could not.
    //
    // On the built HTML for the same reason as above. A header link is
    // exactly the kind of thing that quietly stops being rendered.
    for (const route of ROUTES) {
      if (route.path === '/styles') continue;
      assert.ok(
        read(route.path).includes('href="/styles"'),
        `${route.path} has no link to the style catalogue`,
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

  it('lists every model provider a run can be sent to as a subprocessor', () => {
    // A provider added to packages/ai receives prompts and project files the
    // day it is configured, so the page has to name it before then.
    const shown: Record<string, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      deepseek: 'DeepSeek',
    };
    const html = read('/legal/subprocessors');
    for (const provider of PROVIDER_NAMES) {
      // A local model is a server the owner of a self-hosted copy runs
      // (D124). The hosted service sets none, so nothing is sent to one.
      if (provider === 'local') continue;
      const name = shown[provider];
      assert.ok(name, `no display name for the ${provider} provider`);
      assert.ok(
        html.includes(name),
        `${name} is not on the Subprocessors page`,
      );
    }
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
        !html.includes(GA4_PATH),
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
    assert.ok(bundle.includes(GA4_PATH), 'the client has no loader for GA4');
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
    // The page used to split current from planned, and this checked Google
    // sat above the planned table. With the paid beta every service it named
    // as planned is in use, so the planned table is gone and the check is
    // that Google is listed and nothing is still described as planned.
    const html = read('/legal/subprocessors');
    assert.notEqual(
      html.indexOf('Google LLC'),
      -1,
      'Google is not listed as a subprocessor',
    );
    assert.doesNotMatch(html, /Planned for product launch/);
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
    assert.match(body, /^# vibld$/m);
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

describe('internal links', () => {
  /** Every root-relative href in the built HTML, fragment and query stripped. */
  function internalLinks(html: string): string[] {
    return [...html.matchAll(/href="(\/[^"]*)"/g)]
      .map((match) => match[1]!)
      .map((href) => href.split('#')[0]!.split('?')[0]!)
      .filter((href) => href !== '');
  }

  /**
   * A link to a page that does not exist is the way documentation rots, and
   * it is invisible in a diff: the page it points at was renamed somewhere
   * else entirely. Asset paths are exempt because they are files rather than
   * routes, and they are checked by existing on disk.
   */
  it('never points at a page that was not built', () => {
    const declared = new Set(ROUTE_PATHS);
    // A layer's reference page is a file from public/, not a route: it
    // counts when the file it is served from was copied into the build.
    for (const layer of LAYERS) {
      if (existsSync(join(CLIENT, layer.livePath.slice(1), 'index.html'))) {
        declared.add(layer.livePath);
      }
    }
    const broken: string[] = [];

    for (const route of ROUTES) {
      for (const href of internalLinks(read(route.path))) {
        if (/\.[a-z0-9]+$/i.test(href)) {
          if (!existsSync(join(CLIENT, href.replace(/^\//, '')))) {
            broken.push(`${route.path} -> ${href} (no such file)`);
          }
          continue;
        }
        const normalised =
          href.endsWith('/') && href !== '/' ? href.slice(0, -1) : href;
        if (!declared.has(normalised)) {
          broken.push(`${route.path} -> ${href} (no such route)`);
        }
      }
    }

    assert.deepEqual(
      broken,
      [],
      `broken internal links:\n${broken.join('\n')}`,
    );
  });

  /**
   * The host answers "/how-it-works/" with a redirect to "/how-it-works",
   * so a link written with the slash costs a crawler a hop and points at
   * an address the sitemap does not list. The rule above strips the slash
   * before comparing, which is why it never saw the stepper on
   * /how-it-works doing exactly that.
   */
  it('never points at a page by an address the host redirects', () => {
    const redirected: string[] = [];
    for (const route of ROUTES) {
      for (const href of internalLinks(read(route.path))) {
        if (href !== '/' && href.endsWith('/')) {
          redirected.push(`${route.path} -> ${href}`);
        }
      }
    }
    assert.deepEqual(
      redirected,
      [],
      `links with a trailing slash:\n${redirected.join('\n')}`,
    );
  });

  it('checks enough pages to mean something', () => {
    // The rule above passes trivially if the walk finds nothing, which is
    // exactly what a wrong CLIENT path would produce.
    const total = ROUTES.reduce(
      (count, route) => count + internalLinks(read(route.path)).length,
      0,
    );
    assert.ok(total > 50, `only ${total} internal links found`);
  });
});

describe('the docs index', () => {
  it('reaches every guide', () => {
    // A guide in DOC_GUIDES whose track is not one of DOC_TRACKS builds its
    // own page and is listed from nowhere, which is worse than not shipping
    // it: it is reachable only by somebody who already knows the URL.
    const html = read('/docs');
    for (const guide of DOC_GUIDES) {
      assert.ok(
        html.includes(`/docs/${guide.slug}`),
        `the docs index does not link ${guide.slug}`,
      );
    }
  });

  it('gives every track something to show', () => {
    for (const track of DOC_TRACKS) {
      assert.ok(
        guidesIn(track.id).length > 0,
        `the ${track.id} track has no guides, so its section is a heading over nothing`,
      );
    }
  });

  it('puts every guide in a declared track', () => {
    const tracks = new Set(DOC_TRACKS.map((track) => track.id));
    for (const guide of DOC_GUIDES) {
      assert.ok(tracks.has(guide.track), `${guide.slug} is in no known track`);
    }
  });
});

describe('the roadmap, at rest', () => {
  // What a crawler and a reader without JavaScript get, and what everyone
  // sees before the counts arrive: every group and every item, and buttons
  // that say "Vote" rather than a number nobody has fetched yet.
  it('prerenders every group and every item, with no counts', () => {
    const html = read('/roadmap');
    const text = html.replace(/<[^>]+>/g, ' ');
    for (const group of ROADMAP_GROUPS) {
      assert.ok(text.includes(group.label), `no group ${group.label}`);
      assert.ok(html.includes(`id="roadmap-${group.status}"`));
    }
    for (const item of ROADMAP_ITEMS) {
      // React escapes the apostrophe in "app’s" as itself, so the title is
      // matched as written.
      assert.ok(html.includes(item.title), `no item ${item.title}`);
      assert.ok(html.includes(item.description), `no text for ${item.id}`);
    }
    const buttons = html.match(/<button[^>]*class="lb-vote"[^>]*>/g) ?? [];
    assert.equal(buttons.length, VOTABLE_IDS.length);
    for (const button of buttons) {
      assert.match(button, /aria-pressed="false"/);
      assert.match(button, /aria-label="Vote for [^",]+"/);
    }
    assert.doesNotMatch(html, /\d+ votes?"/, 'a count was prerendered');
  });

  it('says the counts are indicative', () => {
    assert.match(read('/roadmap'), /Counts are indicative/);
  });

  it('is in the sitemap at its canonical URL', () => {
    const body = readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8');
    assert.ok(body.includes(`<loc>${new URL('/roadmap', SITE.url)}</loc>`));
  });
});

describe('the Live Build home page, at rest', () => {
  // What a crawler, a reader without JavaScript and a reader who asked for
  // less motion all get: the finished build, not a stage of it.
  it('prerenders the finished build rather than a stage of it', () => {
    const html = read('/');
    for (const entry of LOG) {
      assert.ok(html.includes(entry), `the run log is missing "${entry}"`);
    }
    assert.match(html, /aria-current="step"[^>]*>Preview</);
    assert.ok(html.includes('Throw your first pot this weekend.'));
    // The code pane, highlighted token by token, so matched on a string token.
    assert.ok(html.includes('&#x27;motion/react&#x27;'));
    assert.doesNotMatch(html, /data-building|data-wire/);
  });

  it('hides nothing behind an opacity waiting for a script', () => {
    for (const route of ROUTES) {
      assert.doesNotMatch(
        read(route.path),
        /style="[^"]*opacity:\s*0(?:[;"]|\.0*[;"])/,
        `${route.path} ships content at opacity 0`,
      );
    }
  });

  it('says beside the builder that it is a drawing, not the product', () => {
    const html = read('/');
    assert.ok(html.includes('It does not call a model.'));
    assert.ok(html.includes('Pause the demonstration'));
    assert.ok(html.includes('Replay the demonstration'));
    assert.match(html, /aria-live="polite"/);
  });
});

describe('the way in, now the beta is open', () => {
  // Chris, 2026-09-27: an open paid beta. Anybody can sign up, so every call
  // to action that said "Join the waitlist" is a link to the builder's
  // sign-up form, and nothing outside the legal pages still promises an
  // invitation. The legal pages are left as they are on purpose: their
  // wording is Chris's to change, not a side effect of this one.
  const isLegal = (path: string) =>
    path === '/legal' || path.startsWith('/legal/');

  it('gives every page a link to the sign-up form', () => {
    assert.equal(SITE.signUpUrl, `${SITE.appUrl}/sign-up`);
    for (const route of ROUTES) {
      assert.ok(
        read(route.path).includes(`href="${SITE.signUpUrl}"`),
        `${route.path} has no way to sign up`,
      );
    }
  });

  it('renders no waitlist form and no link to one', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.doesNotMatch(html, /action="\/api\/waitlist"/, route.path);
      assert.ok(!html.includes('href="/#waitlist"'), route.path);
      assert.ok(!html.includes('id="waitlist"'), route.path);
    }
  });

  // The template catalog quotes designs whose subject is a waitlist or an
  // invitation ("Pre-launch waitlist page"), so those pages are held to the
  // rule on vibld's own words: the route modules that write every sentence
  // around the quoted designs. The header and footer they share with every
  // other page are checked on those pages.
  const quotesTheCatalog = (path: string) =>
    path === '/templates' ||
    path.startsWith('/templates/') ||
    path === '/inspiration';

  it('no longer says the product is invite-only, outside the legal pages', () => {
    for (const route of ROUTES) {
      if (isLegal(route.path) || quotesTheCatalog(route.path)) continue;
      const text = read(route.path)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      assert.doesNotMatch(
        text,
        /invite-only|join the waitlist|invitations go out|waitlist/i,
        `${route.path} still describes a closed product`,
      );
    }
  });

  it('says nothing closed in its own words on the pages that quote the catalog', () => {
    for (const module of ['templates.tsx', 'template.tsx', 'inspiration.tsx']) {
      const source = readFileSync(
        new URL(`../app/routes/${module}`, import.meta.url),
        'utf8',
      );
      assert.doesNotMatch(
        source,
        /invite-only|join the waitlist|invitations go out|waitlist/i,
        module,
      );
    }
  });

  it('says it is a public beta where it used to say invite-only', () => {
    const text = read('/').replace(/<[^>]+>/g, ' ');
    assert.ok(text.includes(SITE.stage));
    assert.equal(SITE.stage, 'Public beta');
  });

  it('tells assistants the same thing', () => {
    const body = readFileSync(join(CLIENT, 'llms.txt'), 'utf8');
    assert.ok(body.includes(SITE.signUpUrl));
    assert.doesNotMatch(body, /no open signup|invitation-only/i);
  });
});

describe('the product pages', () => {
  it('links every product page from every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      for (const page of PRODUCT_PAGES) {
        assert.ok(
          html.includes(`href="${page.path}"`),
          `${route.path} does not link ${page.path}`,
        );
      }
    }
  });

  it('prints the plans the builder enforces on /pricing and the home page', () => {
    const worker = (file: string) =>
      readFileSync(
        join(import.meta.dirname, '..', '..', 'web', 'worker', file),
        'utf8',
      );
    const { plans, signupCents, signupRequiresCard, topup } = readPlans({
      entitlement: worker('entitlement.ts'),
      signupCredit: worker('signup-credit.ts'),
      stripeClient: worker('stripe-client.ts'),
      modelAccess: worker('model-access.ts'),
    });
    for (const path of ['/pricing', '/']) {
      // Text only: the figures sit in separate elements.
      const text = read(path)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      for (const plan of plans) {
        // The allowance is always labelled as spend, never left to read as
        // the price.
        assert.ok(
          text.includes(
            `${dollars(plan.monthlyCents)} of model spend included each month`,
          ),
          `${path} does not show ${plan.name}'s included spend`,
        );
        if (plan.price) {
          assert.ok(
            text.includes(`${priceLabel(plan.price.monthly)} a month`),
            `${path} does not show ${plan.name}'s monthly price`,
          );
          assert.ok(
            text.includes(`or ${priceLabel(plan.price.annual)} a year`),
            `${path} does not show ${plan.name}'s yearly price`,
          );
        }
      }
      // D163: a retired welcome credit is offered nowhere.
      if (signupCents <= 0) {
        assert.doesNotMatch(text, /of build credit\. The card is saved/);
        assert.doesNotMatch(text, /once, when a new account adds a card/);
      } else {
        assert.ok(text.includes(dollars(signupCents)));
      }
      // The condition goes wherever the amount does. A dollar promised on
      // sign-up alone, while the builder waits for a card, is a promise the
      // product breaks on the first day (Chris, 2026-09-27).
      if (signupCents > 0 && signupRequiresCard) {
        assert.ok(
          text.includes(
            `${dollars(signupCents)} once, when a new account adds a card`,
          ),
          `${path} states the new-account grant without its card condition`,
        );
        assert.match(text, /saved, not charged/);
      }
      assert.ok(
        text.includes(
          `${priceLabel(topup.priceCents)} adds ${dollars(topup.creditCents)} of model spend`,
        ),
      );
    }
  });

  it('links each use case to its real examples, and the index to each case', () => {
    const index = read('/use-cases');
    for (const useCase of USE_CASES) {
      assert.ok(index.includes(`href="/use-cases/${useCase.slug}"`));
      const html = read(`/use-cases/${useCase.slug}`);
      assert.ok(useCase.examples.length > 0, `${useCase.slug} has no example`);
      for (const slug of useCase.examples) {
        assert.ok(
          html.includes(`href="/examples#example-${slug}"`),
          `/use-cases/${useCase.slug} does not link the example ${slug}`,
        );
      }
    }
    const examples = read('/examples');
    for (const slug of USE_CASES.flatMap((useCase) => useCase.examples)) {
      assert.ok(
        examples.includes(`id="example-${slug}"`),
        `/examples has no anchor for ${slug}`,
      );
    }
  });

  it('draws every style on /styles, and says which colours are a demonstration', () => {
    const html = read('/styles');
    for (const preset of STYLE_PRESETS) {
      assert.ok(
        html.includes(`data-look="${preset.id}"`),
        `/styles does not draw ${preset.id}`,
      );
    }
    assert.match(html, /demonstration palette/);
    // Drawn, never pictured.
    assert.doesNotMatch(html.slice(html.indexOf('<main')), /<img\b/);
  });
});

describe('the self-hosted fonts, as served', () => {
  it('preloads the display and body faces on every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      for (const face of ['bricolage-grotesque-', 'hanken-grotesk-']) {
        assert.match(
          html,
          new RegExp(
            `<link[^>]*rel="preload"[^>]*href="/fonts/${face}[^"]+\\.woff2"[^>]*as="font"[^>]*type="font/woff2"[^>]*crossorigin="anonymous"`,
          ),
          `${route.path} does not preload ${face}`,
        );
      }
    }
  });

  it('copies the fonts and their licences into the build', () => {
    const served = readdirSync(join(CLIENT, 'fonts')).sort();
    const source = readdirSync(
      join(import.meta.dirname, '..', 'public', 'fonts'),
    ).sort();
    assert.deepEqual(served, source);
    const licences = read('/legal/licenses');
    for (const name of source.filter((file) => file.endsWith('.txt'))) {
      assert.ok(licences.includes(`href="/fonts/${name}"`));
    }
  });
});

describe('the templates on /examples', () => {
  // The page promises that its examples are vibld's output with no hand
  // edits. Hand-built templates may sit on the same page only after all of
  // them, in their own section, and marked as what they are.
  const generated = (
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          'examples',
          'catalogue.json',
        ),
        'utf8',
      ),
    ) as { examples: { slug: string }[] }
  ).examples.map((example) => example.slug);

  it('lists every template after every generated example, marked', () => {
    const html = read('/examples');
    const section = html.indexOf('id="templates-title"');
    assert.notEqual(section, -1, '/examples has no templates section');
    for (const slug of generated) {
      const at = html.indexOf(`id="example-${slug}"`);
      assert.ok(
        at !== -1 && at < section,
        `${slug} is not above the templates`,
      );
    }
    const after = html.slice(section);
    assert.match(after, /not vibld output/);
    for (const template of TEMPLATES) {
      const card = after.slice(
        after.indexOf(`aria-labelledby="template-${template.slug}"`),
      );
      assert.ok(card.includes('Template, hand-built'), template.slug);
      assert.ok(card.includes('MIT license'), template.slug);
      assert.ok(card.includes(`href="${template.source}"`), template.slug);
      assert.ok(card.includes(`src="${template.screenshot}"`), template.slug);
      assert.ok(
        existsSync(join(CLIENT, template.screenshot.replace(/^\//, ''))),
        `${template.screenshot} was not built`,
      );
    }
  });

  it('keeps templates out of the generated catalogue', () => {
    for (const template of TEMPLATES) {
      assert.ok(!generated.includes(template.slug), template.slug);
    }
  });

  it('keeps each thumbnail a reasonable size', () => {
    for (const template of TEMPLATES) {
      const size = statSync(
        join(import.meta.dirname, '..', 'public', template.screenshot),
      ).size;
      assert.ok(size < 150_000, `${template.screenshot} is ${size} bytes`);
    }
  });
});

describe('the style cards on /templates, drawn as a reader reaches them', () => {
  // A style card past the first page carries no preview in the page's data;
  // the page fetches it from these files (D162). Every style has to be in
  // exactly one of them, the one its place in the gallery names, or its card
  // stays a blank page.
  it('puts every style in the file its place in the gallery names', () => {
    const seen = new Set<string>();
    STYLE_CARD_PATHS.forEach((path, n) => {
      const file = join(CLIENT, path.replace(/^\//, ''));
      assert.ok(existsSync(file), `${path} was not built`);
      const ids = Object.keys(JSON.parse(readFileSync(file, 'utf8')));
      for (const id of ids) {
        assert.ok(!seen.has(id), `${id} is in more than one file`);
        seen.add(id);
        const at = STYLE_GALLERY_INDEX.findIndex((entry) => entry.id === id);
        assert.equal(Math.floor(at / STYLE_CARD_CHUNK), n, `${id} in ${path}`);
      }
    });
    assert.equal(seen.size, STYLE_GALLERY_INDEX.length);
  });

  it('keeps the previews out of the page data', () => {
    // With every preview inline the data was 1.7 MB.
    const size = statSync(join(CLIENT, 'templates.data')).size;
    assert.ok(size < 1_200_000, `templates.data is ${size} bytes`);
  });
});

describe('structured data a search engine or an assistant reads', () => {
  /** Every JSON-LD block on a page, parsed. */
  function schemas(path: string): Record<string, unknown>[] {
    return [
      ...read(path).matchAll(
        /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g,
      ),
    ].map((match) => JSON.parse(match[1]!));
  }

  function ofType(path: string, type: string) {
    return schemas(path).find((block) => block['@type'] === type) as
      Record<string, any> | undefined;
  }

  const worker = (file: string) =>
    readFileSync(
      join(import.meta.dirname, '..', '..', 'web', 'worker', file),
      'utf8',
    );
  const PLANS_NOW = readPlans({
    entitlement: worker('entitlement.ts'),
    signupCredit: worker('signup-credit.ts'),
    stripeClient: worker('stripe-client.ts'),
    modelAccess: worker('model-access.ts'),
  });

  it('gives every page below the home page a breadcrumb that ends at its canonical URL', () => {
    for (const route of ROUTES.filter((candidate) => candidate.path !== '/')) {
      const crumbs = ofType(route.path, 'BreadcrumbList');
      assert.ok(crumbs, `no BreadcrumbList on ${route.path}`);
      const items = crumbs!.itemListElement as {
        item: string;
        position: number;
      }[];
      assert.equal(items[0]!.item, new URL('/', SITE.url).toString());
      assert.equal(
        items.at(-1)!.item,
        new URL(route.path, SITE.url).toString(),
        route.path,
      );
      items.forEach((item, index) => assert.equal(item.position, index + 1));
    }
  });

  it('states only the prices the builder charges, on the home page and /pricing', () => {
    const expected = new Set<string>([
      '0.00',
      (PLANS_NOW.topup.priceCents / 100).toFixed(2),
    ]);
    for (const plan of PLANS_NOW.plans) {
      if (!plan.price) continue;
      expected.add((plan.price.monthly / 100).toFixed(2));
      expected.add((plan.price.annual / 100).toFixed(2));
    }
    for (const path of ['/', '/pricing']) {
      const app = ofType(path, 'WebApplication');
      assert.ok(app, `no WebApplication schema on ${path}`);
      const prices = new Set(
        (app!.offers as { price: string; priceCurrency: string }[]).map(
          (offer) => {
            assert.equal(offer.priceCurrency, 'USD');
            return offer.price;
          },
        ),
      );
      assert.deepEqual([...prices].sort(), [...expected].sort(), path);
      // A rating or a review would have to be invented: the site has none.
      assert.equal(app!.aggregateRating, undefined);
      assert.equal(app!.review, undefined);
    }
  });

  it('marks up as FAQ only questions the page shows, word for word', () => {
    for (const path of ['/', '/features']) {
      const faq = ofType(path, 'FAQPage');
      assert.ok(faq, `no FAQPage on ${path}`);
      const text = read(path)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ');
      for (const entry of faq!.mainEntity as {
        name: string;
        acceptedAnswer: { text: string };
      }[]) {
        assert.ok(
          text.includes(entry.name),
          `${path} does not show "${entry.name}"`,
        );
        assert.ok(
          text.includes(entry.acceptedAnswer.text),
          `${path} does not show the answer to "${entry.name}"`,
        );
      }
    }
  });

  it('answers what vibld costs with the prices the builder charges', () => {
    const faq = ofType('/', 'FAQPage')!;
    const cost = (
      faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[]
    ).find((entry) => /cost/.test(entry.name));
    assert.ok(cost, 'no answer to what vibld costs');
    for (const plan of PLANS_NOW.plans) {
      if (!plan.price) continue;
      assert.ok(
        cost!.acceptedAnswer.text.includes(
          `${priceLabel(plan.price.monthly)} a month or ${priceLabel(plan.price.annual)} a year`,
        ),
        plan.name,
      );
    }
  });

  it('gives the Organization a raster logo that was built, and only real profiles', () => {
    const org = (schemas('/')[0]!['@graph'] as Record<string, any>[]).find(
      (node) => node['@type'] === 'Organization',
    )!;
    const logo = new URL(org.logo.url);
    assert.match(logo.pathname, /\.png$/);
    assert.ok(
      existsSync(join(CLIENT, logo.pathname)),
      `${logo.pathname} did not build`,
    );
    assert.deepEqual(org.sameAs, [...SITE.sameAs]);
  });

  it('names who built vibld, in the schema and in every footer (D113)', () => {
    const org = (schemas('/')[0]!['@graph'] as Record<string, any>[]).find(
      (node) => node['@type'] === 'Organization',
    )!;
    assert.equal(org.founder['@type'], 'Person');
    assert.equal(org.founder.name, SITE.founder.name);
    assert.deepEqual(org.founder.sameAs, [...SITE.founder.sameAs]);
    for (const path of [
      'index.html',
      'pricing/index.html',
      'templates/index.html',
    ]) {
      const html = readFileSync(join(CLIENT, path), 'utf8');
      assert.ok(
        html.includes(`href="${SITE.founder.url}" rel="author"`),
        `${path} has no founder credit`,
      );
    }
  });
});

describe('what AI crawlers are told', () => {
  it('writes every page in the sitemap as Markdown, and no layer demo', () => {
    const sitemap = readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8');
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1]!,
    );
    assert.ok(urls.length > 100);
    for (const url of urls) {
      const path = new URL(url).pathname;
      const file = join(
        CLIENT,
        path === '/' ? 'index.md' : `${path.slice(1)}.md`,
      );
      assert.ok(existsSync(file), `no Markdown for ${path}`);
      assert.match(
        readFileSync(file, 'utf8'),
        new RegExp(
          `^---\\n[\\s\\S]*?\\nurl: "${url.replace(/[.?]/g, '\\$&')}"\\n---\\n\\n\\S`,
        ),
        `front matter of ${path}`,
      );
    }
    assert.ok(!existsSync(join(CLIENT, 'layers.md')));
    assert.equal(
      readdirSync(join(CLIENT, 'layers')).filter((name) => name.endsWith('.md'))
        .length,
      0,
    );
    const pricing = readFileSync(join(CLIENT, 'pricing.md'), 'utf8');
    assert.match(pricing, /^title: "Pricing \| vibld"$/m);
    assert.match(pricing, /^- ## Build$/m);
    assert.doesNotMatch(pricing, /<[a-z]/);
  });

  it('names the AI crawlers in the same group as every other crawler', () => {
    const body = readFileSync(join(CLIENT, 'robots.txt'), 'utf8');
    // One group: a crawler obeys only the most specific group naming it, so
    // a separate group would have to repeat every rule or drop /api/.
    const groups = body
      .split(/\n\s*\n/)
      .filter((block) => /^User-agent:/m.test(block));
    assert.equal(groups.length, 1, 'robots.txt must keep a single group');
    for (const agent of [
      'GPTBot',
      'ClaudeBot',
      'PerplexityBot',
      'Google-Extended',
    ]) {
      assert.match(body, new RegExp(`^User-agent: ${agent}$`, 'm'));
    }
    assert.match(body, /^Disallow: \/api\/$/m);
    assert.doesNotMatch(body, /^Disallow: \/$/m);
  });

  it('declares a Content Signal for every use, the same as the builder host', () => {
    // D179. Inside the one group, so every crawler named there reads it.
    const signal = (file: string) =>
      readFileSync(file, 'utf8').match(/^Content-Signal: (.+)$/gm);
    const site = signal(join(CLIENT, 'robots.txt'));
    assert.deepEqual(site, [
      'Content-Signal: ai-train=yes, search=yes, ai-input=yes',
    ]);
    assert.deepEqual(
      signal(
        join(import.meta.dirname, '..', '..', 'web', 'public', 'robots.txt'),
      ),
      site,
      'app.vibld.com says something different from vibld.com',
    );
  });

  it('publishes llms-full.txt with every product page, doc and policy', () => {
    const body = readFileSync(join(CLIENT, 'llms-full.txt'), 'utf8');
    const paths = [
      ...PRODUCT_PAGES.map((page) => page.path),
      ...DOC_GUIDES.map((guide) => `/docs/${guide.slug}`),
      ...LEGAL_DOCS.map((doc) => `/legal/${doc.slug}`),
    ];
    for (const path of paths) {
      assert.ok(
        body.includes(`Source: ${new URL(path, SITE.url).toString()}\n`),
        `llms-full.txt is missing ${path}`,
      );
    }
    // Placeholders such as <revision> are prose and stay; tags are not.
    assert.doesNotMatch(
      body,
      /<\/?(p|div|span|a|h[1-6]|li|ul|ol|script|section|small)\b[^>]*>/,
      'llms-full.txt still has markup',
    );
    const llms = readFileSync(join(CLIENT, 'llms.txt'), 'utf8');
    assert.ok(llms.includes(new URL('/llms-full.txt', SITE.url).toString()));
  });
});

describe('files a crawler should not find', () => {
  it('does not ship the SPA fallback, which would answer 200 with no title', () => {
    assert.ok(!existsSync(join(CLIENT, '__spa-fallback.html')));
  });

  it('dates sitemap entries only in a form a crawler accepts', () => {
    const body = readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8');
    for (const match of body.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) {
      assert.match(match[1]!, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(new Date(match[1]!).getTime() <= Date.now());
    }
  });
});
