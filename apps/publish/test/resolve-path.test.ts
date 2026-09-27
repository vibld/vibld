import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  candidatePaths,
  fallbackPaths,
  isNavigation,
} from '../worker/resolve-path.ts';

describe('candidatePaths', () => {
  it('resolves the root to index.html', () => {
    assert.deepEqual(candidatePaths('/'), ['index.html']);
    assert.deepEqual(candidatePaths(''), ['index.html']);
  });

  it('tries the literal path, then an extensionless route, then a directory index', () => {
    assert.deepEqual(candidatePaths('/pricing'), [
      'pricing',
      'pricing.html',
      'pricing/index.html',
    ]);
  });

  it('strips leading and trailing slashes', () => {
    assert.deepEqual(candidatePaths('/about/'), [
      'about',
      'about.html',
      'about/index.html',
    ]);
  });

  it('leaves an asset path with an extension as its own first candidate', () => {
    assert.deepEqual(candidatePaths('/assets/app.js'), [
      'assets/app.js',
      'assets/app.js.html',
      'assets/app.js/index.html',
    ]);
  });
});

describe('fallbackPaths', () => {
  it("offers React Router's shell, then a static 404 page, then an SPA's index", () => {
    assert.deepEqual(fallbackPaths('/pricing'), [
      { path: '__spa-fallback.html', status: 200 },
      { path: '404.html', status: 404 },
      { path: 'index.html', status: 200 },
    ]);
  });

  it('falls back for nested routes and trailing slashes', () => {
    assert.equal(fallbackPaths('/docs/setup/').length, 3);
  });

  it('never answers a missing file with a page', () => {
    assert.deepEqual(fallbackPaths('/assets/app.js'), []);
    assert.deepEqual(fallbackPaths('/favicon.ico'), []);
  });

  it('treats a dotted route as a page when the browser is navigating to it', () => {
    // /releases/v1.2 is a client-side route; the dot does not make it a file.
    assert.equal(fallbackPaths('/releases/v1.2', true).length, 3);
    assert.deepEqual(fallbackPaths('/releases/v1.2', false), []);
  });

  it("answers a missing .html page with the site's own 404 page, and only that", () => {
    const expected = [{ path: '404.html', status: 404 }];
    assert.deepEqual(fallbackPaths('/missing.html'), expected);
    assert.deepEqual(fallbackPaths('/missing.htm', true), expected);
  });
});

describe('isNavigation', () => {
  it('believes Sec-Fetch-Mode, and an Accept that asks for HTML', () => {
    assert.equal(
      isNavigation(new Headers({ 'sec-fetch-mode': 'navigate' })),
      true,
    );
    assert.equal(
      isNavigation(
        new Headers({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }),
      ),
      true,
    );
  });

  it('does not mistake a script, an image or a bare fetch for a page', () => {
    assert.equal(isNavigation(new Headers({ accept: '*/*' })), false);
    assert.equal(
      isNavigation(new Headers({ accept: 'image/avif,image/webp' })),
      false,
    );
    assert.equal(
      isNavigation(new Headers({ 'sec-fetch-mode': 'no-cors' })),
      false,
    );
    assert.equal(isNavigation(new Headers()), false);
  });
});
