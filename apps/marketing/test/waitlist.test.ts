import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isPlausibleEmail,
  isTurnstileVerified,
  parseWaitlistSubmission,
  resendContactRequest,
  turnstileVerifyRequest,
  validateSubmission,
} from '../worker/waitlist.ts';

describe('isPlausibleEmail', () => {
  it('accepts an ordinary address', () => {
    assert.ok(isPlausibleEmail('chris@example.com'));
  });

  it('rejects a value with no @', () => {
    assert.ok(!isPlausibleEmail('not-an-email'));
  });

  it('rejects a value with no dot in the domain', () => {
    assert.ok(!isPlausibleEmail('chris@example'));
  });

  it('rejects a value containing whitespace', () => {
    assert.ok(!isPlausibleEmail('chris @example.com'));
  });

  it('rejects an empty string', () => {
    assert.ok(!isPlausibleEmail(''));
  });

  it('rejects an address over 254 characters', () => {
    const local = 'a'.repeat(250);
    assert.ok(!isPlausibleEmail(`${local}@example.com`));
  });
});

describe('validateSubmission', () => {
  it('accepts a plausible email with an empty honeypot', () => {
    const result = validateSubmission({
      email: 'Chris@Example.com',
      company: '',
      turnstileToken: 'token',
    });
    assert.deepEqual(result, { ok: true, email: 'chris@example.com' });
  });

  it('trims and lowercases the accepted email', () => {
    const result = validateSubmission({
      email: '  Chris@Example.com  ',
      company: '',
      turnstileToken: 'token',
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.email, 'chris@example.com');
  });

  it('rejects an implausible email', () => {
    const result = validateSubmission({
      email: 'nope',
      company: '',
      turnstileToken: 'token',
    });
    assert.deepEqual(result, { ok: false, reason: 'invalid-email' });
  });

  it('rejects a filled honeypot even with a valid email', () => {
    const result = validateSubmission({
      email: 'chris@example.com',
      company: 'a bot filled this',
      turnstileToken: 'token',
    });
    assert.deepEqual(result, { ok: false, reason: 'spam-honeypot' });
  });

  it('rejects a null submission as an invalid body', () => {
    assert.deepEqual(validateSubmission(null), {
      ok: false,
      reason: 'invalid-body',
    });
  });
});

describe('parseWaitlistSubmission', () => {
  it('reads a JSON body, including the Turnstile token', async () => {
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': 'a-token',
      }),
    });
    const submission = await parseWaitlistSubmission(request);
    assert.deepEqual(submission, {
      email: 'chris@example.com',
      company: '',
      turnstileToken: 'a-token',
    });
  });

  it('reads a form-encoded body, including the Turnstile token', async () => {
    const body = new URLSearchParams({
      email: 'chris@example.com',
      company: '',
      'cf-turnstile-response': 'a-token',
    });
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const submission = await parseWaitlistSubmission(request);
    assert.deepEqual(submission, {
      email: 'chris@example.com',
      company: '',
      turnstileToken: 'a-token',
    });
  });

  it('defaults missing fields to empty strings rather than throwing', async () => {
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const submission = await parseWaitlistSubmission(request);
    assert.deepEqual(submission, {
      email: '',
      company: '',
      turnstileToken: '',
    });
  });

  it('returns null for an unparseable body', async () => {
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const submission = await parseWaitlistSubmission(request);
    assert.equal(submission, null);
  });
});

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
      isTurnstileVerified({
        success: true,
        action: 'waitlist',
        hostname: 'vibld.com',
      }),
      true,
    );
    assert.equal(
      isTurnstileVerified({
        success: true,
        action: 'waitlist',
        hostname: 'www.vibld.com',
      }),
      true,
    );
  });

  it('rejects success: false', () => {
    assert.equal(
      isTurnstileVerified({
        success: false,
        action: 'waitlist',
        hostname: 'vibld.com',
      }),
      false,
    );
  });

  it('rejects a token issued for a different action', () => {
    assert.equal(
      isTurnstileVerified({
        success: true,
        action: 'something-else',
        hostname: 'vibld.com',
      }),
      false,
    );
  });

  it('rejects a token issued for a different hostname', () => {
    assert.equal(
      isTurnstileVerified({
        success: true,
        action: 'waitlist',
        hostname: 'evil.example.com',
      }),
      false,
    );
  });

  it('rejects a response missing the hostname entirely', () => {
    assert.equal(
      isTurnstileVerified({ success: true, action: 'waitlist' }),
      false,
    );
  });
});

describe('resendContactRequest', () => {
  it('targets the contacts endpoint with the segment and a bearer token', () => {
    const { url, init } = resendContactRequest(
      'chris@example.com',
      'segment-id',
      're_test_key',
    );
    assert.equal(url, 'https://api.resend.com/contacts');
    assert.equal(init.method, 'POST');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer re_test_key');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body as string), {
      email: 'chris@example.com',
      segments: [{ id: 'segment-id' }],
    });
  });
});
