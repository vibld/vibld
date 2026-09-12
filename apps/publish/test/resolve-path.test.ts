import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { candidatePaths } from '../worker/resolve-path.ts';

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
