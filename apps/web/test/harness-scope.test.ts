import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
