import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLocalHost, subdomainOrigin } from '../src/site-host.ts';

/** Hosts served over HTTPS on Cloudflare, or HTTP on this machine (D126). */
describe('where previews, shares and published sites are served', () => {
  it('is plain HTTP on this machine, port and all', () => {
    assert.equal(
      subdomainOrigin('acme', 'localhost:8789'),
      'http://acme.localhost:8789',
    );
    assert.equal(
      subdomainOrigin('acme', '127.0.0.1:8789'),
      'http://acme.127.0.0.1:8789',
    );
    assert.equal(isLocalHost('box.localhost'), true);
  });

  it('is HTTPS anywhere else', () => {
    assert.equal(
      subdomainOrigin('acme', 'vibld-preview.dev'),
      'https://acme.vibld-preview.dev',
    );
    assert.equal(isLocalHost('localhost.example.com'), false);
    assert.equal(isLocalHost('notlocalhost'), false);
  });
});
