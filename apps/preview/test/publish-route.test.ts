import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPublishedHost } from '../worker/publish-route.ts';
import { shareIdFromHost } from '../worker/share-route.ts';

const HOST = 'vibld-preview.dev';

describe('which hosts go to a published site', () => {
  it('forwards a slug one label under the preview domain', () => {
    for (const slug of ['acme', 'example-coffee-roaster-opus-5-5', 'a1']) {
      assert.equal(isPublishedHost(`${slug}.${HOST}`, HOST), true, slug);
    }
  });

  it('keeps sandbox previews and shares for this Worker', () => {
    for (const label of [
      '8080-abc123-tok_en',
      '5173-my-sandbox-id-t0ken',
      '12345-x-y',
      'share',
      'sh-3f2a9c1e-0b7d-4e6a-9c52-1d8e7f604ab3',
    ]) {
      assert.equal(isPublishedHost(`${label}.${HOST}`, HOST), false, label);
    }
  });

  it('never forwards a host shareIdFromHost reads as a share', () => {
    const host = `sh-3f2a9c1e-0b7d-4e6a-9c52-1d8e7f604ab3.${HOST}`;
    assert.ok(shareIdFromHost(host, HOST));
    assert.equal(isPublishedHost(host, HOST), false);
  });

  it('forwards nothing off the preview domain, deeper than one label, or unconfigured', () => {
    assert.equal(isPublishedHost(HOST, HOST), false);
    assert.equal(isPublishedHost(`a.b.${HOST}`, HOST), false);
    assert.equal(isPublishedHost('acme.example.com', HOST), false);
    assert.equal(isPublishedHost('internal.invalid', HOST), false);
    assert.equal(isPublishedHost(`acme.${HOST}`, undefined), false);
  });
});

describe('published hosts on this machine under Docker (D126)', () => {
  it('match with the port, as the request’s host carries it', () => {
    assert.equal(
      isPublishedHost('acme.localhost:8788', 'localhost:8788'),
      true,
    );
    assert.equal(
      isPublishedHost('5173-owner-tok.localhost:8788', 'localhost:8788'),
      false,
    );
    assert.equal(isPublishedHost('acme.localhost', 'localhost:8788'), false);
  });
});
