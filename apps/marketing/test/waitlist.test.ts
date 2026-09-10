import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isPlausibleEmail,
  parseWaitlistSubmission,
  resendContactRequest,
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
      pageUrl: '',
      pageReferrer: '',
    });
    assert.deepEqual(result, { ok: true, email: 'chris@example.com' });
  });

  it('trims and lowercases the accepted email', () => {
    const result = validateSubmission({
      email: '  Chris@Example.com  ',
      company: '',
      pageUrl: '',
      pageReferrer: '',
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.email, 'chris@example.com');
  });

  it('rejects an implausible email', () => {
    const result = validateSubmission({
      email: 'nope',
      company: '',
      pageUrl: '',
      pageReferrer: '',
    });
    assert.deepEqual(result, { ok: false, reason: 'invalid-email' });
  });

  it('rejects a filled honeypot even with a valid email', () => {
    const result = validateSubmission({
      email: 'chris@example.com',
      company: 'a bot filled this',
      pageUrl: '',
      pageReferrer: '',
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
  it('reads a JSON body', async () => {
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'chris@example.com', company: '' }),
    });
    const submission = await parseWaitlistSubmission(request);
    assert.deepEqual(submission, {
      email: 'chris@example.com',
      company: '',
      pageUrl: '',
      pageReferrer: '',
    });
  });

  it('reads a form-encoded body', async () => {
    const body = new URLSearchParams({
      email: 'chris@example.com',
      company: '',
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
      pageUrl: '',
      pageReferrer: '',
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
      pageUrl: '',
      pageReferrer: '',
    });
  });

  it('reads the attribution fields the form reports', async () => {
    // The Worker only ever sees its own /api/waitlist URL, so the page has to
    // report where the visitor actually was -- see WaitlistForm.tsx.
    const body = new URLSearchParams({
      email: 'chris@example.com',
      company: '',
      page_url: 'https://vibld.com/?utm_source=hn',
      page_referrer: 'https://news.ycombinator.com/',
    });
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const submission = await parseWaitlistSubmission(request);
    assert.equal(submission?.pageUrl, 'https://vibld.com/?utm_source=hn');
    assert.equal(submission?.pageReferrer, 'https://news.ycombinator.com/');
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
