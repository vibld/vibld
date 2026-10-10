import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isCustomHost, isPublishedHost } from '../worker/publish-route.ts';
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

describe("an owner's own domain (D189)", () => {
  it('is a published site where the route catches custom hostnames', () => {
    assert.equal(isCustomHost('www.bakery.com', HOST, 'on'), true);
    assert.equal(isCustomHost('WWW.Bakery.com', HOST, 'on'), true);
  });

  it("never takes the preview domain's own hosts or this Worker's", () => {
    for (const host of [
      HOST,
      `acme.${HOST}`,
      `5173-abc-tok.${HOST}`,
      'internal.invalid',
      'localhost:8788',
    ]) {
      assert.equal(isCustomHost(host, HOST, 'on'), false, host);
    }
  });

  it('is off unless the deployment says so', () => {
    assert.equal(isCustomHost('www.bakery.com', HOST, undefined), false);
    assert.equal(isCustomHost('preview', HOST, undefined), false);
  });
});
