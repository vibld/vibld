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

describe('preview deployments', () => {
  /** Stands in for the asset binding wrangler.preview.jsonc provides. */
  const assets = (
    body = '<!doctype html><title>Vibld | Vibe. Build. Ship.</title>',
  ) => ({
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  });

  it('serves pages with a noindex header when VIBLD_NOINDEX is set', async () => {
    // The property the preview exists or dies on. A byte-for-byte copy of
    // vibld.com on a public hostname, left indexable, competes with the real
    // site for a name that already returns other things when searched.
    const response = await worker.fetch(
      new Request('https://preview.workers.dev/'),
      {
        ...ENV,
        VIBLD_NOINDEX: '1',
        ASSETS: assets(),
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(await response.text(), /Vibe\. Build\. Ship\./);
  });

  it('keeps the response otherwise intact', async () => {
    // Rebuilding the response must not lose what the asset store said about
    // it, or a preview stops being a faithful copy of what it previews.
    const response = await worker.fetch(
      new Request('https://preview.workers.dev/'),
      {
        ...ENV,
        VIBLD_NOINDEX: '1',
        ASSETS: assets(),
      },
    );
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    );
  });

  it('changes nothing in production, where the flag is unset', async () => {
    // Production routes pages straight from the asset store and never invokes
    // this Worker for them, so this branch must stay unreachable there even
    // if an ASSETS binding exists.
    const response = await worker.fetch(new Request('https://vibld.com/'), {
      ...ENV,
      ASSETS: assets(),
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-robots-tag'), null);
  });

  it('still routes the waitlist on a preview rather than serving it as a page', async () => {
    // The asset fallthrough is added after the /api/waitlist branch, not
    // before it. A preview that swallowed its own API would look fine and be
    // broken in the one place anyone would click.
    const response = await worker.fetch(
      jsonRequest({ email: 'someone@example.com' }),
      { VIBLD_NOINDEX: '1', ASSETS: assets() },
    );
    // No RESEND_API_KEY on a preview, so this is the configured 503 rather
    // than a 200 page. That it is not 200-with-HTML is the point.
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-robots-tag'), null);
  });
});

/**
 * What the dataset actually receives.
 *
 * The waitlist endpoint answered correctly in every case below before these
 * tests existed. What it got wrong was the datapoint it wrote alongside the
 * answer, which no status-code assertion can see.
 */
function recordingEnv() {
  const points: { blobs: (string | null)[]; indexes: string[] }[] = [];
  return {
    env: {
      ...ENV,
      ANALYTICS: {
        writeDataPoint(point: {
          blobs?: (string | null)[];
          indexes?: string[];
        }) {
          points.push({
            blobs: point.blobs ?? [],
            indexes: point.indexes ?? [],
          });
        },
      },
    },
    points,
    signups: () => points.filter((point) => point.indexes[0] === 'signup'),
  };
}

describe('what the waitlist records', () => {
  it('counts a contact Resend created', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 201 }),
    );
    const { env, signups } = recordingEnv();
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(signups().length, 1);
  });

  it('does not count a duplicate, while still telling the person they are on the list', async () => {
    // A returning visitor re-submitting an address that is already on the list
    // created no contact. Counting it inflates the conversion rate and files
    // an old contact under whatever campaign brought them back, which are the
    // two numbers this dataset exists to answer.
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('{"message":"Contact already exists"}', { status: 409 }),
    );
    const { env, signups } = recordingEnv();
    const response = await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      env,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(signups(), []);
  });

  it('does not count a signup that failed', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{"message":"internal error"}', { status: 500 }),
    );
    const { env, signups } = recordingEnv();
    await worker.fetch(
      jsonRequest({ email: 'chris@example.com', company: '' }),
      env,
    );
    assert.deepEqual(signups(), []);
  });

  it('files a no-JavaScript form post under the page it was posted from', async () => {
    // The supported fallback: without JavaScript the hidden page_url is the
    // empty value the page was prerendered with. Falling back to the Worker's
    // own URL filed every such signup under /api/waitlist, a path nobody
    // visited, splitting the home page's numbers rather than rounding them.
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 201 }),
    );
    const { env, signups } = recordingEnv();
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        referer: 'https://vibld.com/?utm_source=newsletter',
      },
      body: new URLSearchParams({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': '',
        page_url: '',
        page_referrer: '',
      }).toString(),
    });
    await worker.fetch(request, env);
    const [signup] = signups();
    assert.ok(signup, 'the signup was not recorded at all');
    // blobs: [kind, path, referrer, source, medium, campaign, country]
    assert.equal(signup.blobs[1], '/');
    assert.equal(signup.blobs[3], 'newsletter');
  });

  it('never takes a path from another site', async () => {
    // Referer is whatever the caller sends. Trusting a cross-origin one would
    // let anyone write paths into our own traffic report by posting a form.
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 201 }),
    );
    const { env, signups } = recordingEnv();
    const request = new Request('https://vibld.com/api/waitlist', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        referer: 'https://elsewhere.example/their/page',
      },
      body: new URLSearchParams({
        email: 'chris@example.com',
        company: '',
        'cf-turnstile-response': '',
      }).toString(),
    });
    await worker.fetch(request, env);
    const [signup] = signups();
    assert.ok(signup);
    assert.equal(signup.blobs[1], '/');
  });
});

describe('attribution a caller cannot forge', () => {
  it('refuses a page_url pointing at another site', async () => {
    // /api/hit and /api/waitlist both take unauthenticated posts, so a
    // page_url that is trusted on sight lets anyone write paths and campaigns
    // into this site's traffic report from anywhere.
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{}', { status: 201 }),
    );
    const { env, signups } = recordingEnv();
    await worker.fetch(
      jsonRequest({
        email: 'chris@example.com',
        company: '',
        page_url: 'https://elsewhere.example/their/page?utm_source=fake',
      }),
      env,
    );
    const [signup] = signups();
    assert.ok(signup);
    // blobs: [kind, path, referrer, source, medium, campaign, country]
    assert.equal(signup.blobs[1], '/');
    assert.equal(signup.blobs[3], '');
  });

  it('refuses a forged page_url on the pageview beacon too', async () => {
    const { env, points } = recordingEnv();
    const request = new Request('https://vibld.com/api/hit', {
      method: 'POST',
      body: new URLSearchParams({
        page_url: 'https://elsewhere.example/their/page?utm_campaign=fake',
        page_referrer: '',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 204);
    const [hit] = points.filter((point) => point.indexes[0] === 'pageview');
    assert.ok(hit);
    assert.equal(hit.blobs[1], '/');
    assert.equal(hit.blobs[5], '');
  });

  it('still believes a page_url on this site', async () => {
    // The check must not cost the real case, which is every genuine visitor.
    const { env, points } = recordingEnv();
    const request = new Request('https://vibld.com/api/hit', {
      method: 'POST',
      body: new URLSearchParams({
        page_url: 'https://vibld.com/legal/privacy?utm_campaign=launch',
        page_referrer: '',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await worker.fetch(request, env);
    const [hit] = points.filter((point) => point.indexes[0] === 'pageview');
    assert.ok(hit);
    assert.equal(hit.blobs[1], '/legal/privacy');
    assert.equal(hit.blobs[5], 'launch');
  });
});
