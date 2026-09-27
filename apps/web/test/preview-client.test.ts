import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  createShare,
  listShares,
  previewConfigured,
  previewStatus,
  outcomeResponse,
  revokeShare,
  startPreview,
  stopPreview,
} from '../worker/preview-client.ts';
import type { ServiceBinding } from '../worker/preview-client.ts';

function fakeBinding(handler: (request: Request) => Response): {
  binding: ServiceBinding;
  calls: Request[];
} {
  const calls: Request[] = [];
  return {
    binding: {
      fetch: async (request: Request) => {
        calls.push(request);
        return handler(request);
      },
    },
    calls,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('previewConfigured', () => {
  it('requires both the binding and the shared secret', () => {
    const { binding } = fakeBinding(() => jsonResponse({}));
    assert.equal(previewConfigured({}), false);
    assert.equal(previewConfigured({ PREVIEW: binding }), false);
    assert.equal(
      previewConfigured({ PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' }),
      true,
    );
  });
});

describe('startPreview', () => {
  it('posts the files and userId, with the shared secret attached', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({ status: 'installing' }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's3cr3t' },
      'user_abc',
      [{ path: 'src/App.tsx', content: 'x' }],
    );

    assert.deepEqual(result, { status: 'installing' });
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/start');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), 'Bearer s3cr3t');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
    assert.deepEqual(body.files, [{ path: 'src/App.tsx', content: 'x' }]);
  });

  it('parses a queued response, including position', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ status: 'queued', position: 3 }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, { status: 'queued', position: 3 });
  });

  it('parses a ready response', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({
        status: 'ready',
        url: 'https://5173-abc-def.vibld-preview.dev',
        expiresAt: 1_800_000_000_000,
      }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, {
      status: 'ready',
      url: 'https://5173-abc-def.vibld-preview.dev',
      expiresAt: 1_800_000_000_000,
    });
  });

  it('treats a ready response missing url/expiresAt as a failure, not a crash', async () => {
    const { binding } = fakeBinding(() => jsonResponse({ status: 'ready' }));
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.equal(result.status, 'failed');
  });

  it('surfaces the service error message on failure', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ status: 'failed', error: 'npm install failed' }, 200),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, { status: 'failed', error: 'npm install failed' });
  });

  it('does not crash on an unreadable response body', async () => {
    // A start answers the person who pressed the button, so unlike the
    // status poll it has to say something rather than nothing.
    for (const answer of [
      () => new Response('not json', { status: 200 }),
      () => jsonResponse({ status: 'ready' }),
      () => jsonResponse({}),
    ]) {
      const { binding } = fakeBinding(answer);
      const result = await startPreview(
        { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
        'user_abc',
        [],
      );
      assert.equal(result.status, 'failed');
      assert.match(
        result.status === 'failed' ? result.error : '',
        /unreadable/,
      );
    }
  });
});

describe('previewStatus', () => {
  it('is null for an answer it cannot read, not a failed sandbox', async () => {
    // The browser acts on the difference: a failed status stops its poll,
    // takes the Stop control away, and settles whether a sandbox survived
    // a stop whose reply was lost. Synthesising one here would announce all
    // three from a shape nobody could parse, and it would do it upstream of
    // the browser's own parser where the same fault was just fixed.
    for (const answer of [
      () => jsonResponse({ status: 'ready' }),
      () => jsonResponse({ status: 'ready', url: 'https://x' }),
      () => jsonResponse({ status: 'nonsense' }),
      () => jsonResponse({}),
      () => new Response('not json', { status: 200 }),
    ]) {
      const { binding } = fakeBinding(answer);
      assert.equal(
        await previewStatus(
          { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
          'user_abc',
        ),
        null,
      );
    }
  });

  it('still reports a failure the service actually reported', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ status: 'failed', error: 'No preview has been started.' }),
    );
    assert.deepEqual(
      await previewStatus(
        { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
        'user_abc',
      ),
      { status: 'failed', error: 'No preview has been started.' },
    );
  });

  it('gets the status endpoint with the userId in the query string', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({ status: 'ready-to-start' }),
    );
    const result = await previewStatus(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user abc',
    );
    assert.deepEqual(result, { status: 'ready-to-start' });
    const request = calls[0]!;
    assert.equal(request.method, 'GET');
    assert.equal(new URL(request.url).searchParams.get('userId'), 'user abc');
  });
});

describe('stopPreview', () => {
  it('posts the userId to the stop endpoint', async () => {
    const { binding, calls } = fakeBinding(() => jsonResponse({ ok: true }));
    const result = await stopPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, { ok: true });
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/stop');
    assert.equal(request.method, 'POST');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
  });

  it('reports a stop the service refused', async () => {
    // Discarded, this reads as a preview that is gone while it is still
    // running, and the next start is handed that same sandbox back under a
    // newer checkpoint's name.
    const { binding } = fakeBinding(() =>
      jsonResponse({ error: 'The sandbox is busy.' }, 503),
    );
    const result = await stopPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, { ok: false, error: 'The sandbox is busy.' });
  });

  it('still reports a refusal it cannot read a reason from', async () => {
    const { binding } = fakeBinding(
      () => new Response('nope', { status: 500 }),
    );
    const result = await stopPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'Could not stop the preview.',
    });
  });
});

describe('createShare', () => {
  it('posts the userId and returns the parsed grant', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({
        shareId: 'share_1',
        expiresAt: 1_800_000_000_000,
        url: 'https://share.vibld-preview.dev/user_abc/share_1?exp=1&sig=x',
      }),
    );
    const result = await createShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, {
      ok: true,
      shareId: 'share_1',
      expiresAt: 1_800_000_000_000,
      url: 'https://share.vibld-preview.dev/user_abc/share_1?exp=1&sig=x',
    });
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/share');
    assert.equal(request.method, 'POST');
    assert.equal((await request.json()).userId, 'user_abc');
  });

  it('surfaces the service error message when the preview cannot be shared', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ error: 'This preview is not currently running.' }, 409),
    );
    const result = await createShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'This preview is not currently running.',
    });
  });

  it('does not crash on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const result = await createShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.equal(result.ok, false);
  });
});

describe('listShares', () => {
  it('gets the share endpoint with the userId in the query string', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({
        shares: [
          {
            shareId: 'share_1',
            createdAt: 1,
            expiresAt: 1_800_000_000_000,
            revoked: false,
            url: 'https://share.vibld-preview.dev/user_abc/share_1?exp=1&sig=x',
          },
          {
            shareId: 'share_2',
            createdAt: 2,
            expiresAt: 3,
            revoked: true,
          },
        ],
      }),
    );
    const shares = await listShares(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user abc',
    );
    assert.equal(shares.length, 2);
    assert.equal(shares[1]!.revoked, true);
    assert.equal(shares[1]!.url, undefined);
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/share');
    assert.equal(new URL(request.url).searchParams.get('userId'), 'user abc');
  });

  it('filters out anything not shaped like a share', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ shares: [{ shareId: 'share_1' }, 'garbage', null] }),
    );
    const shares = await listShares(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(shares, []);
  });

  it('is an empty list on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const shares = await listShares(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(shares, []);
  });
});

describe('revokeShare', () => {
  it('reports a revoke the service refused', async () => {
    // The sharpest case of the same rule: reported as done, the link comes
    // out of the caller's list while anyone holding it can still view the
    // running app, which is the opposite of what the Share warning says.
    const { binding } = fakeBinding(() =>
      jsonResponse({ error: 'That grant could not be revoked.' }, 502),
    );
    const result = await revokeShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      'share_1',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'That grant could not be revoked.',
    });
  });

  it('sends the userId and shareId to the share endpoint as a DELETE', async () => {
    const { binding, calls } = fakeBinding(() => jsonResponse({ ok: true }));
    const result = await revokeShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      'share_1',
    );
    assert.deepEqual(result, { ok: true });
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/share');
    assert.equal(request.method, 'DELETE');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
    assert.equal(body.shareId, 'share_1');
  });
});

describe('outcomeResponse', () => {
  it('answers a refusal 502, carrying the reason', async () => {
    // 200 here is what made a stop that never happened look like one that
    // did, all the way up to the browser.
    const response = outcomeResponse({
      ok: false,
      error: 'The sandbox is busy.',
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'The sandbox is busy.' });
  });

  it('answers a success 200', async () => {
    const response = outcomeResponse({ ok: true });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

describe('what the router does with a status it could not read', () => {
  /**
   * The half `previewStatus` cannot prove on its own: whether the route
   * passes the distinction on. A 502 is read by the browser as "ask again";
   * a synthesised `failed` body would be read as "the sandbox is not
   * running", and only one of those follows from an unreadable answer.
   *
   * Read from the source because `worker/index.ts` imports
   * `cloudflare:workers` and cannot be loaded under `node --test` at all,
   * the same constraint the router-ordering rules work around.
   */
  it('answers 502 rather than inventing a failed sandbox', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );
    const start = source.indexOf('const status = await previewStatus(');
    assert.ok(start > 0, 'the route no longer asks for a status');
    const block = source.slice(start, start + 400);

    assert.match(block, /502/, 'an unreadable status is not refused');
    assert.match(block, /status\s*\?/, 'the null answer is not branched on');
  });
});
