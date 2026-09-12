import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentTypeFor } from '../worker/content-type.ts';

describe('contentTypeFor', () => {
  it('maps common extensions', () => {
    assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
    assert.equal(contentTypeFor('app.js'), 'text/javascript; charset=utf-8');
    assert.equal(contentTypeFor('styles.css'), 'text/css; charset=utf-8');
    assert.equal(contentTypeFor('logo.svg'), 'image/svg+xml');
    assert.equal(
      contentTypeFor('manifest.webmanifest'),
      'application/manifest+json',
    );
  });

  it('is case-insensitive on the extension', () => {
    assert.equal(contentTypeFor('IMAGE.PNG'), 'image/png');
  });

  it('falls back to a generic binary type for an unknown or missing extension', () => {
    assert.equal(contentTypeFor('README'), 'application/octet-stream');
    assert.equal(contentTypeFor('data.unknownext'), 'application/octet-stream');
  });
});
