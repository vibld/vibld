import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sourceRoot, transformFor } from './harness/transform-target.ts';

/**
 * The component harness stays out of the way of everything else.
 *
 * `test/harness/components.mjs` is loaded with `--import` for every test
 * file, and does nothing unless the file being run is a `*.test.tsx`. This
 * is that condition, asserted from the other side.
 *
 * It matters for the worker. Its code runs on Cloudflare Workers, where
 * there is no `document`, and a suite that handed one to every test would
 * let a browser global slip into worker code and pass here before failing
 * in production. The same goes for the transform: outside a component test
 * the runner's own type stripping is what runs, so this suite is not
 * quietly being rebuilt on a different toolchain.
 */
describe('the component harness', () => {
  it('gives no DOM to a test that is not a component test', () => {
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof globalThis.window, 'undefined');
  });

  it('leaves this file to the runner rather than transforming it', () => {
    // The harness sets this when it installs a DOM. Its absence is how a
    // reader can tell which half of the suite they are in.
    assert.equal(
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT,
      undefined,
    );
  });
});

describe('which files the harness transforms', () => {
  const ROOT = '/home/someone/vibld/apps/web/src/';

  it('takes every .tsx, because the runner cannot load one at all', () => {
    assert.equal(transformFor('/anywhere/Button.tsx', ROOT), 'tsx');
    assert.equal(transformFor(`${ROOT}components/Button.tsx`, ROOT), 'tsx');
  });

  it('takes .ts under src, where the env define has to reach', () => {
    assert.equal(transformFor(`${ROOT}auth/clerk-token.ts`, ROOT), 'ts');
  });

  it('leaves .ts elsewhere to the runner', () => {
    // The worker and the tests keep node's own type stripping. Taking them
    // would rebuild the whole suite on a different transform for no reason.
    assert.equal(
      transformFor('/home/someone/vibld/apps/web/worker/index.ts', ROOT),
      null,
    );
    assert.equal(transformFor('/home/someone/vibld/x.json', ROOT), null);
  });

  it('finds the source root as a path, not as a URL', () => {
    // `new URL(...).pathname` keeps the escapes and `fileURLToPath` does
    // not, so on a checkout with a space in it the two never matched and
    // nothing under src was transformed. `clerkConfigured` then read false
    // and the component tests exercised an early return.
    const root = sourceRoot('file:///home/a%20b/apps/web/test/harness/x.mjs');
    assert.equal(root, '/home/a b/apps/web/src/');
    assert.equal(transformFor(`${root}auth/clerk-token.ts`, root), 'ts');
  });
});
