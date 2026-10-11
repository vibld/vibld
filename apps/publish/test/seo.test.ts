import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalUrl,
  injectHead,
  pagePath,
  imageUrl,
  robotsTxt,
  shadowsOf,
  sitemapXml,
} from '../worker/seo.ts';

const ORIGIN = 'https://acme.vibld-preview.dev';

describe('canonicalUrl', () => {
  it('drops a trailing slash and repeated slashes', () => {
    assert.equal(canonicalUrl(ORIGIN, '/'), `${ORIGIN}/`);
    assert.equal(canonicalUrl(ORIGIN, '/menu/'), `${ORIGIN}/menu`);
    assert.equal(canonicalUrl(ORIGIN, '//menu'), `${ORIGIN}/menu`);
  });
});

describe('pagePath', () => {
  const none = () => false;

  it('names a page by its shortest address', () => {
    assert.equal(pagePath('index.html', none), '/');
    assert.equal(pagePath('about.html', none), '/about');
    assert.equal(pagePath('docs/index.html', none), '/docs');
    assert.equal(pagePath('a/b.html', none), '/a/b');
  });

  it('keeps the full name of a page another file shadows', () => {
    const has = (path: string) => path === 'about.html';
    assert.equal(pagePath('about/index.html', has), '/about/index.html');
    assert.equal(pagePath('about.html', has), '/about');
    assert.deepEqual(shadowsOf('about/index.html'), ['about', 'about.html']);
    assert.deepEqual(shadowsOf('index.html'), []);
  });
});

describe('injectHead', () => {
  const canonical = `${ORIGIN}/`;

  it('returns a page without a head as it is', () => {
    assert.equal(injectHead('<h1>Hi</h1>', canonical), '<h1>Hi</h1>');
  });

  it('adds nothing the page already has', () => {
    const page =
      '<html><head><title>T</title>' +
      `<link rel="canonical" href="https://elsewhere.example/">` +
      '<meta property="og:type" content="article">' +
      `<meta property="og:url" content="https://elsewhere.example/">` +
      '<meta property="og:title" content="Own">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '</head></html>';
    assert.equal(injectHead(page, canonical), page);
  });

  it('skips a description the page does not have', () => {
    const out = injectHead('<head><title>T</title></head>', canonical);
    assert.doesNotMatch(out, /og:description/);
    assert.match(out, /<meta property="og:title" content="T">/);
  });

  it('escapes what it copies into an attribute', () => {
    const out = injectHead(
      `<HEAD><title> A "quoted" &lt;b&gt;\n title </title>` +
        `<meta content='x &amp; "y"' name='description'></HEAD>`,
      canonical,
    );
    assert.match(
      out,
      /<meta property="og:title" content="A &quot;quoted&quot; &lt;b&gt; title">/,
    );
    assert.match(
      out,
      /<meta property="og:description" content="x &amp; &quot;y&quot;">/,
    );
    assert.ok(out.endsWith('</HEAD>'));
  });

  it('keeps character references as the page wrote them', () => {
    const out = injectHead(
      '<head><title>A&nbsp;B &#38; C &#x26; D</title></head>',
      canonical,
    );
    assert.match(
      out,
      /<meta property="og:title" content="A&nbsp;B &#38; C &#x26; D">/,
    );
  });

  it("uses the page's own canonical address for og:url", () => {
    const out = injectHead(
      '<head><link rel="canonical" href="https://acme.com/a?x=1&amp;y=2"></head>',
      canonical,
    );
    assert.doesNotMatch(out, /vibld-preview/);
    assert.match(
      out,
      /<meta property="og:url" content="https:\/\/acme\.com\/a\?x=1&amp;y=2">/,
    );
  });

  it('picks the large card when the page has an image', () => {
    const out = injectHead(
      '<head><meta property="og:image" content="/a.png"></head>',
      canonical,
    );
    assert.match(out, /twitter:card" content="summary_large_image"/);
  });
});

describe("injectHead with the owner's fields", () => {
  const PAGE =
    '<html><head><title>Old</title>' +
    '<meta name="description" content="Old text">' +
    '<meta property="og:title" content="Old">' +
    '<meta property="og:image" content="https://x.test/old.png">' +
    '<meta property="og:image:width" content="1200">' +
    '<meta name="twitter:card" content="summary">' +
    '</head><body></body></html>';

  it("replaces the page's title, description and image, not adds beside them", () => {
    const html = injectHead(PAGE, 'https://a.test/', {
      title: 'Acme <Bakery> & "Co"',
      description: 'Fresh bread',
      image: 'https://a.test/og.png',
    });
    assert.equal(html.match(/<title>/g)?.length, 1);
    assert.match(
      html,
      /<title>Acme &lt;Bakery&gt; &amp; &quot;Co&quot;<\/title>/,
    );
    assert.equal(html.match(/name="description"/g)?.length, 1);
    assert.match(html, /<meta name="description" content="Fresh bread">/);
    assert.match(
      html,
      /<meta property="og:title" content="Acme &lt;Bakery&gt; &amp; &quot;Co&quot;">/,
    );
    assert.match(
      html,
      /<meta property="og:description" content="Fresh bread">/,
    );
    assert.doesNotMatch(html, /old\.png|og:image:width|Old/);
    assert.match(
      html,
      /<meta property="og:image" content="https:\/\/a\.test\/og\.png">/,
    );
    assert.match(
      html,
      /<meta name="twitter:card" content="summary_large_image">/,
    );
  });

  it('leaves what the owner did not set as the page wrote it', () => {
    const html = injectHead(PAGE, 'https://a.test/', {
      image: 'https://a.test/og.png',
    });
    assert.match(html, /<title>Old<\/title>/);
    assert.match(html, /<meta property="og:title" content="Old">/);
    assert.match(html, /<meta property="og:description" content="Old text">/);
    assert.doesNotMatch(html, /old\.png/);
    assert.equal(html.match(/twitter:card/g)?.length, 1);
    assert.match(
      html,
      /<meta name="twitter:card" content="summary_large_image">/,
    );
  });

  it('makes a path on the site absolute on the canonical origin', () => {
    assert.equal(
      imageUrl('https://a.test', '/og.png'),
      'https://a.test/og.png',
    );
    assert.equal(
      imageUrl('https://a.test', 'https://cdn.test/x.png'),
      'https://cdn.test/x.png',
    );
  });
});

describe('robotsTxt and sitemapXml', () => {
  it('names no sitemap for a site its owner keeps out of search, and blocks nothing', () => {
    assert.equal(robotsTxt(ORIGIN, false), 'User-agent: *\nAllow: /\n');
  });

  it('welcomes crawlers and names the sitemap', () => {
    assert.equal(
      robotsTxt(ORIGIN),
      `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
    );
  });

  it('lists each page once under its own address', () => {
    const xml = sitemapXml(ORIGIN, [
      'index.html',
      'about.html',
      'about/index.html',
      'old.htm',
      '__spa-fallback.html',
      '404.html',
      'a&b.html',
      'Team.HTML',
    ]);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, [
      `${ORIGIN}/`,
      `${ORIGIN}/Team.HTML`,
      `${ORIGIN}/a&amp;b`,
      `${ORIGIN}/about`,
      `${ORIGIN}/about/index.html`,
    ]);
    assert.match(
      sitemapXml(ORIGIN, ['app.js']),
      new RegExp(`<loc>${ORIGIN}/</loc>`),
    );
  });
});
