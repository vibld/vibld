import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previewMediaRoute } from '../worker/media-route.ts';

/**
 * Which preview a `/media/` request is for. Parsed exactly the way the
 * sandbox SDK parses a preview URL, and trusted for nothing: the token it
 * yields is checked by the sandbox before a byte is served.
 */
describe('previewMediaRoute', () => {
  it('reads the port, the sandbox and the token from a preview URL', () => {
    assert.deepEqual(
      previewMediaRoute(
        new URL(
          'https://5173-user-2abc-def-k3y_42.vibld-preview.dev/media/hero.mp4',
        ),
      ),
      {
        port: 5173,
        sandboxId: 'user-2abc-def',
        token: 'k3y_42',
        path: 'media/hero.mp4',
      },
    );
  });

  it('leaves everything that is not a media request to the proxy', () => {
    for (const url of [
      'https://5173-user-abc-tok.vibld-preview.dev/',
      'https://5173-user-abc-tok.vibld-preview.dev/src/App.tsx',
      'https://5173-user-abc-tok.vibld-preview.dev/media/../secret.mp4',
      'https://5173-user-abc-tok.vibld-preview.dev/media/logo.svg',
    ]) {
      assert.equal(previewMediaRoute(new URL(url)), null, url);
    }
  });

  it('refuses a hostname that is not a preview URL', () => {
    for (const url of [
      'https://share.vibld-preview.dev/media/hero.mp4',
      'https://abc-user-tok.vibld-preview.dev/media/hero.mp4',
      'https://5173-tok.vibld-preview.dev/media/hero.mp4',
      // Tokens are at most 63 characters, the DNS label limit.
      `https://5173-user-${'t'.repeat(64)}.vibld-preview.dev/media/hero.mp4`,
    ]) {
      assert.equal(previewMediaRoute(new URL(url)), null, url);
    }
  });
});
