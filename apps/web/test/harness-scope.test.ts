import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

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
    //
    // Built from a native path through `pathToFileURL` rather than written
    // as a literal `file://` URL: a POSIX-shaped literal has no drive
    // letter, so on Windows `fileURLToPath` throws before the assertion is
    // reached and this test fails for a reason that has nothing to do with
    // what it is checking.
    const checkout = join(process.cwd(), 'a b');
    const harness = join(checkout, 'apps', 'web', 'test', 'harness', 'x.mjs');

    const root = sourceRoot(pathToFileURL(harness));
    assert.equal(root, join(checkout, 'apps', 'web', 'src') + sep);
    // The space survived, which is the whole point.
    assert.ok(root.includes('a b'), root);
    assert.equal(
      transformFor(join(root, 'auth', 'clerk-token.ts'), root),
      'ts',
    );
  });
});
