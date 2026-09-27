import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';

import { ROUTES } from '../app/site.ts';

/**
 * These tests read the built site, not the source.
 *
 * A passing compiler says the code is well formed; it says nothing about
 * whether a crawler, a static host or someone with JavaScript disabled gets a
 * usable page. Everything asserted here is a property of the emitted HTML,
 * because that is the artefact a visitor actually receives.
 */

const CLIENT = join(import.meta.dirname, '..', 'build', 'client');
const PUBLIC = join(import.meta.dirname, '..', 'public');

/** Where a static host looks for a given route. */
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

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
};

/**
 * Decode HTML entities in one pass.
 *
 * Chained replacements decode twice: `&amp;lt;` becomes `&lt;` when the first
 * one runs, and the next one then turns that into `<`. A title containing the
 * literal text `&lt;` would compare wrong, and the test would be asserting
 * against something the page never said. Matching each entity once, and never
 * re-reading what a substitution produced, is the only version that is right.
 */
function decode(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|#x27|#39);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );
}

before(() => {
  // Building here rather than assuming a build exists: a test that silently
  // reads a stale artefact proves nothing about the current source.
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

  it('serves deep links as their own files, not as one shell', () => {
    // A static host maps /pricing to /pricing/index.html. If deep routes
    // shared a single file, every one of them would need a rewrite rule the
    // host may not have.
    const deep = ROUTES.filter((route) => route.path !== '/');
    const bodies = deep.map((route) => read(route.path));
    assert.equal(new Set(bodies).size, deep.length, 'each page is distinct');
  });

  it('prerenders nothing that is not a declared route', () => {
    const declared = new Set(
      ROUTES.filter((route) => route.path !== '/').map((route) =>
        route.path.replace(/^\//, ''),
      ),
    );
    // Folders copied verbatim from public/ (the fonts) and Vite's assets
    // folder are files, not pages.
    const staticDirs = new Set([
      'assets',
      ...readdirSync(PUBLIC).filter((entry) =>
        statSync(join(PUBLIC, entry)).isDirectory(),
      ),
    ]);
    const emitted = readdirSync(CLIENT).filter(
      (entry) =>
        statSync(join(CLIENT, entry)).isDirectory() && !staticDirs.has(entry),
    );
    for (const dir of emitted) {
      assert.ok(declared.has(dir), `unexpected prerendered route: ${dir}`);
    }
  });
});

describe('page metadata', () => {
  it('gives every page its own title and description', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();

    for (const route of ROUTES) {
      const html = read(route.path);
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      const description = tagContent(html, 'name', 'description');

      assert.equal(decode(title ?? ''), route.title, `title for ${route.path}`);
      assert.equal(
        decode(description ?? ''),
        route.description,
        `description for ${route.path}`,
      );
      titles.add(title ?? '');
      descriptions.add(description ?? '');
    }

    // Shared metadata across pages is the failure mode that looks fine in a
    // browser and ruins every search result and shared link.
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
      assert.match(
        ogUrl!,
        /^https?:\/\//,
        'a relative social URL resolves against the wrong host',
      );
      assert.match(html, /rel="canonical"/, `canonical missing ${route.path}`);
    }
  });

  it('carries a complete social card on every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      for (const property of ['og:title', 'og:description', 'og:type']) {
        assert.ok(
          tagContent(html, 'property', property),
          `${property} missing for ${route.path}`,
        );
      }
    }
  });
});

describe('content is in the HTML, not only in the bundle', () => {
  it('renders each page heading without JavaScript', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.match(
        html,
        /<h1[^>]*>/,
        `${route.path} has no server-rendered heading`,
      );
    }
  });

  it('renders the navigation on every page', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      for (const other of ROUTES) {
        assert.ok(
          html.includes(`href="${other.path}"`),
          `${route.path} does not link to ${other.path}`,
        );
      }
    }
  });

  it('puts the skip link ahead of the navigation', () => {
    const html = read('/');
    const skip = html.indexOf('Skip to main content');
    const nav = html.indexOf('<nav');
    assert.ok(skip !== -1, 'no skip link');
    assert.ok(skip < nav, 'the skip link must come before the navigation');
  });
});

describe('the demonstration form does not pretend to work', () => {
  it('says so in the HTML, before the fields', () => {
    const html = read('/contact');
    const notice = html.indexOf('This form is a demonstration');
    const firstField = html.indexOf('<input');
    assert.ok(notice !== -1, 'no demonstration notice in the prerendered HTML');
    assert.ok(
      notice < firstField,
      'the notice must be readable before someone starts typing',
    );
  });

  it('has no action pointing at a backend that does not exist', () => {
    const html = read('/contact');
    assert.doesNotMatch(
      html,
      /<form[^>]*\saction=/,
      'a form action implies a submission endpoint',
    );
  });

  it('labels every field', () => {
    const html = read('/contact');
    const ids = [
      ...html.matchAll(/<(?:input|textarea|select)[^>]*id="([^"]+)"/g),
    ].map((match) => match[1]);
    assert.ok(ids.length >= 4, 'expected the demonstration fields');
    for (const id of ids) {
      assert.ok(
        html.includes(`for="${id}"`),
        `field ${id} has no associated label`,
      );
    }
  });
});

describe('the page is complete before any script runs', () => {
  it('ships the light field as an enhancement that starts switched off', () => {
    // The canvas only becomes visible once the script has drawn a frame into
    // it. Until then, and forever without WebGL or with reduced motion, the
    // hero's own CSS gradient is what shows.
    const html = read('/');
    const canvas = /<canvas[^>]*>/.exec(html)?.[0];
    assert.ok(canvas, 'no canvas for the light field');
    assert.match(canvas!, /class="glow-canvas"/);
    assert.doesNotMatch(canvas!, /is-live/, 'the field must not start visible');
    assert.match(canvas!, /aria-hidden="true"/);
  });

  it('hides nothing at opacity 0 waiting for a script', () => {
    for (const route of ROUTES) {
      const html = read(route.path);
      assert.doesNotMatch(
        html,
        /style="[^"]*opacity:\s*0[;"]/,
        `${route.path} hides content inline until a script reveals it`,
      );
    }
  });

  it('renders the sample inbox, every step and every tile in the HTML', () => {
    const html = read('/');
    assert.ok(html.includes('One inbox, four ways in'));
    assert.equal(
      [...html.matchAll(/class="message"/g)].length,
      4,
      'one sample message per source',
    );
    for (const step of [
      'Connect',
      'Collect',
      'Group',
      'Rank',
      'Close the loop',
    ]) {
      assert.ok(html.includes(`>${step}</span>`), `step ${step} missing`);
    }
    assert.equal(
      [...html.matchAll(/class="tile"/g)].length,
      12,
      'twelve source and destination tiles',
    );
  });

  it('prerenders the illustration at its final step, captioned as one', () => {
    const html = read('/');
    assert.match(html, /class="stage" data-step="5"[^>]*aria-hidden="true"/);
    assert.ok(html.includes('Illustration, not a screenshot'));
  });
});

describe('the site makes no third-party requests', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [join(dir, entry.name)],
    );

  it('loads nothing from another origin', () => {
    // Canonical links name the site's own address; they are not a request.
    for (const route of ROUTES) {
      const html = read(route.path);
      const tags = html.match(/<[^>]+(?:src|href)="https?:\/\/[^"]*"[^>]*>/g);
      for (const tag of tags ?? []) {
        assert.match(tag, /rel="canonical"/, `${route.path}: ${tag}`);
      }
    }
    for (const file of walk(join(CLIENT, 'assets'))) {
      if (!file.endsWith('.css')) continue;
      const css = readFileSync(file, 'utf8');
      assert.doesNotMatch(css, /@import\s+url\(\s*["']?https?:/, file);
      assert.doesNotMatch(css, /url\(\s*["']?https?:/, file);
    }
  });

  it('self-hosts every font face, with swap and a unicode range', () => {
    const css = walk(join(CLIENT, 'assets'))
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    assert.ok(faces.length >= 4, 'expected the four self-hosted faces');
    for (const face of faces) {
      const src = /url\(\s*["']?([^"')]+)/.exec(face)?.[1] ?? '';
      assert.match(src, /^\/fonts\/[^/]+\.woff2$/, `${src} is not local`);
      assert.ok(
        statSync(join(CLIENT, src)).isFile(),
        `${src} is not in the build`,
      );
      assert.match(face, /font-display:\s*swap/, `${src} blocks text`);
      assert.match(face, /unicode-range:/, `${src} has no unicode range`);
    }
  });

  it('ships the licence text beside every font file', () => {
    const fonts = readdirSync(join(PUBLIC, 'fonts'));
    const licences: Record<string, string> = {
      'schibsted-grotesk': 'SchibstedGrotesk-OFL.txt',
      'instrument-serif': 'InstrumentSerif-OFL.txt',
      'jetbrains-mono': 'JetBrainsMono-OFL.txt',
    };
    for (const file of fonts.filter((name) => name.endsWith('.woff2'))) {
      const family = Object.keys(licences).find((prefix) =>
        file.startsWith(prefix),
      );
      assert.ok(family, `${file} has no licence file mapped to it`);
      const text = readFileSync(
        join(PUBLIC, 'fonts', licences[family!]!),
        'utf8',
      );
      assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/);
    }
  });
});

describe('the export is independent of Vibld', () => {
  it('ships no Vibld runtime dependency', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { dependencies: object; devDependencies: object };
    const names = [
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.devDependencies),
    ];
    for (const name of names) {
      assert.ok(
        !name.startsWith('@vibld/') && !name.startsWith('vibld'),
        `${name} would tie the exported project to Vibld`,
      );
    }
  });

  it('imports no provenance metadata into application code', () => {
    // vibld.json may sit beside the project. The moment something imports it,
    // deleting it breaks the build -- and the metadata has stopped being
    // optional.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [join(dir, entry.name)],
      );
    const root = join(import.meta.dirname, '..');
    for (const file of walk(join(root, 'app'))) {
      const body = readFileSync(file, 'utf8');
      assert.ok(
        !body.includes('vibld.json'),
        `${file} reads the provenance file, making it required`,
      );
    }
  });

  it('mentions Vibld nowhere in the built output', () => {
    // Optional provenance metadata may sit beside the project. It must not
    // reach the site a visitor loads.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [join(dir, entry.name)],
      );
    for (const file of walk(CLIENT)) {
      const body = readFileSync(file, 'utf8');
      assert.ok(
        !/vibld/i.test(body),
        `${file} references Vibld in the shipped site`,
      );
    }
  });
});
