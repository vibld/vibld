import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withClientAddress } from '../worker/client-address.ts';

const URL_ = 'https://build.example.com/api/owner/session';

describe('the client address behind a proxy (D141)', () => {
  it('leaves the request alone without a proxy header named', () => {
    const request = new Request(URL_, {
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    });
    assert.equal(withClientAddress(request, {}), request);
  });

  it('takes the proxy’s address over one the client sent', async () => {
    const request = new Request(URL_, {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '198.51.100.1',
        'X-Real-Ip': '203.0.113.9',
        origin: 'https://build.example.com',
      },
      body: '{"password":"x"}',
    });
    const out = withClientAddress(request, {
      VIBLD_CLIENT_IP_HEADER: 'X-Real-Ip',
    });
    assert.equal(out.headers.get('CF-Connecting-IP'), '203.0.113.9');
    assert.equal(out.headers.get('origin'), 'https://build.example.com');
    assert.equal(out.method, 'POST');
    assert.equal(out.url, URL_);
    assert.equal(await out.text(), '{"password":"x"}');
  });

  it('never keeps the client’s own when the proxy names none', () => {
    const request = new Request(URL_, {
      headers: { 'CF-Connecting-IP': '198.51.100.1' },
    });
    const out = withClientAddress(request, {
      VIBLD_CLIENT_IP_HEADER: 'X-Real-Ip',
    });
    assert.equal(out.headers.get('CF-Connecting-IP'), 'unknown');
  });
});
