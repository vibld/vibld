import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
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

function decode(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'");
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
    const emitted = readdirSync(CLIENT).filter(
      (entry) =>
        statSync(join(CLIENT, entry)).isDirectory() && entry !== 'assets',
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
    const ids = [...html.matchAll(/<(?:input|textarea)[^>]*id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.ok(ids.length >= 4, 'expected the demonstration fields');
    for (const id of ids) {
      assert.ok(
        html.includes(`for="${id}"`),
        `field ${id} has no associated label`,
      );
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

after(() => {});
