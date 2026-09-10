import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import worker from '../worker/index.ts';

const ENV = {
  RESEND_API_KEY: 're_test_key',
  VIBLD_WAITLIST_SEGMENT_ID: 'segment-id',
};

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('https://vibld.com/api/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    // Every test's ENV omits TURNSTILE_SECRET_KEY, so the check is skipped
    // and no request needs a real token -- this just documents the field.
    body: JSON.stringify({ 'cf-turnstile-response': '', ...body }),
  });
}

function htmlFormRequest(fields: Record<string, string>): Request {
  const body = new URLSearchParams({ 'cf-turnstile-response': '', ...fields });
  return new Request('https://vibld.com/api/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
    },
    body: body.toString(),
  });
}

afterEach(() => {
  mock.restoreAll();
});

describe('routing', () => {
  it('answers 404 for a path other than /api/waitlist', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/api/nope'),
      ENV,
    );
    assert.equal(response.status, 404);
  });

  it('answers 404 for GET /api/waitlist', async () => {
    const response = await worker.fetch(
      new Request('https://vibld.com/api/waitlist'),
      ENV,
    );
    assert.equal(response.status, 404);
  });
});

describe('POST /api/waitlist, JSON caller', () => {
  it('adds the contact to Resend and returns ok', async () => {
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 200 }),
    );
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      ENV,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, init] = fetchMock.mock.calls[0].arguments as [
      string,
      RequestInit,
    ];
    assert.equal(url, 'https://api.resend.com/contacts');
    assert.deepEqual(JSON.parse(init.body as string), {
      email: 'chris@example.com',
      segments: [{ id: 'segment-id' }],
    });
  });

  it('rejects an invalid email without calling Resend', async () => {
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 200 }),
    );
    const response = await worker.fetch(
      jsonRequest({ email: 'not-an-email', company: '' }),
      ENV,
    );
    assert.equal(response.status, 400);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it('reports success for a filled honeypot without calling Resend', async () => {
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 200 }),
    );
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: 'a bot' }),
      ENV,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it('answers 503 when the Worker has no Resend key configured', async () => {
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      {},
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, false);
  });

  it('treats a duplicate-email response from Resend as success', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('{"message":"Contact already exists"}', {
          status: 409,
        }),
    );
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      ENV,
    );
    assert.equal(response.status, 200);
  });

  it('answers 502 when Resend fails for an unrelated reason', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{"message":"internal error"}', { status: 500 }),
    );
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      ENV,
    );
    assert.equal(response.status, 502);
  });

  it('answers 502 when the Resend request itself throws', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      ENV,
    );
    assert.equal(response.status, 502);
  });
});

describe('POST /api/waitlist, Turnstile configured', () => {
  const ENV_WITH_TURNSTILE = { ...ENV, TURNSTILE_SECRET_KEY: 'ts_secret' };

  it('verifies the token, then adds the contact when it checks out', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.includes('siteverify')) {
        return new Response(
          JSON.stringify({
            success: true,
            action: 'waitlist',
            hostname: 'vibld.com',
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    const response = await worker.fetch(
      jsonRequest({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': 'a-token',
      }),
      ENV_WITH_TURNSTILE,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);

    assert.equal(fetchMock.mock.calls.length, 2);
    const [verifyUrl, verifyInit] = fetchMock.mock.calls[0].arguments as [
      string,
      RequestInit,
    ];
    assert.equal(
      verifyUrl,
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    const verifyBody = verifyInit.body as URLSearchParams;
    assert.equal(verifyBody.get('response'), 'a-token');
    assert.equal(verifyBody.get('secret'), 'ts_secret');
  });

  it('reports success without calling Resend when verification fails', async () => {
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const response = await worker.fetch(
      jsonRequest({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': 'bad-token',
      }),
      ENV_WITH_TURNSTILE,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    // Only the siteverify call happened -- never a Resend call.
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('reports success without calling Resend when the token is for the wrong hostname', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            action: 'waitlist',
            hostname: 'evil.example.com',
          }),
          { status: 200 },
        ),
    );
    const response = await worker.fetch(
      jsonRequest({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': 'replayed-token',
      }),
      ENV_WITH_TURNSTILE,
    );
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it('reports success without calling Resend when the siteverify request throws', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });
    const response = await worker.fetch(
      jsonRequest({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': 'a-token',
      }),
      ENV_WITH_TURNSTILE,
    );
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    assert.equal(fetchMock.mock.calls.length, 1);
  });
});

describe('POST /api/waitlist, plain HTML form post', () => {
  it('returns a real HTML confirmation page, not JSON', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 200 }),
    );
    const response = await worker.fetch(
      htmlFormRequest({ email: 'chris@example.com', company: '' }),
      ENV,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const body = await response.text();
    assert.match(body, /<!doctype html>/i);
    assert.match(body, /You're on the list/);
  });
});
