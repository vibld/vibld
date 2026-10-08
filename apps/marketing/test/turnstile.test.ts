import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isTurnstileVerified,
  turnstileVerifyRequest,
} from '../worker/turnstile.ts';

const ACTION = 'an-action';

describe('turnstileVerifyRequest', () => {
  it('targets the siteverify endpoint with the secret, token and remote IP', () => {
    const { url, init } = turnstileVerifyRequest(
      'a-token',
      'ts_secret',
      '203.0.113.5',
    );
    assert.equal(
      url,
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    assert.equal(init.method, 'POST');
    const body = init.body as URLSearchParams;
    assert.equal(body.get('secret'), 'ts_secret');
    assert.equal(body.get('response'), 'a-token');
    assert.equal(body.get('remoteip'), '203.0.113.5');
  });

  it('omits remoteip when no IP is available', () => {
    const { init } = turnstileVerifyRequest('a-token', 'ts_secret');
    const body = init.body as URLSearchParams;
    assert.equal(body.has('remoteip'), false);
  });
});

describe('isTurnstileVerified', () => {
  it('accepts success for the right action and hostname', () => {
    assert.equal(
      isTurnstileVerified(
        { success: true, action: ACTION, hostname: 'vibld.com' },
        ACTION,
      ),
      true,
    );
    assert.equal(
      isTurnstileVerified(
        { success: true, action: ACTION, hostname: 'www.vibld.com' },
        ACTION,
      ),
      true,
    );
  });

  it('rejects success: false', () => {
    assert.equal(
      isTurnstileVerified(
        { success: false, action: ACTION, hostname: 'vibld.com' },
        ACTION,
      ),
      false,
    );
  });

  it('rejects a token issued for a different action', () => {
    assert.equal(
      isTurnstileVerified(
        { success: true, action: 'something-else', hostname: 'vibld.com' },
        ACTION,
      ),
      false,
    );
  });

  it('rejects a token issued for a different hostname', () => {
    assert.equal(
      isTurnstileVerified(
        { success: true, action: ACTION, hostname: 'evil.example.com' },
        ACTION,
      ),
      false,
    );
  });

  it('rejects a response missing the hostname entirely', () => {
    assert.equal(
      isTurnstileVerified({ success: true, action: ACTION }, ACTION),
      false,
    );
  });
});
