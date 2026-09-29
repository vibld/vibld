import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseUpdate as parseServiceUpdate,
  startPreview,
  updatePreview,
} from '../worker/preview-client.ts';
import type { ServiceBinding } from '../worker/preview-client.ts';
import {
  DEFAULT_LIMITS,
  MAX_PREVIEW_REVISION_CHARS,
  parsePreviewRevision,
} from '../worker/request-guard.ts';
import {
  parseUpdate,
  startSandboxPreview,
  updateSandboxPreview,
} from '../src/generation/preview-client.ts';
import {
  restartNote,
  servingOlderThan,
  shouldUpdateLive,
} from '../src/generation/use-preview-sandbox.ts';
import type { PreviewSandbox } from '../src/generation/use-preview-sandbox.ts';
import {
  MAX_REVISION_CHARS,
  MAX_UPDATE_CONTENT_CHARS,
  MAX_UPDATE_FILES,
  MAX_UPDATE_PATH_CHARS,
  MAX_UPDATE_TOTAL_PATH_CHARS,
} from '../../preview/worker/live-update.ts';

/**
 * Live-updating a running preview (D74), everywhere but the sandbox: the
 * builder's decision to update, the two clients that carry it, and the
 * bounds that have to agree with `@vibld/preview`'s own.
 */

const READY = {
  status: 'ready' as const,
  url: 'https://sandbox.example/app',
  expiresAt: Date.UTC(2026, 0, 1),
};

type Decision = Pick<
  PreviewSandbox,
  'status' | 'ranRevision' | 'ranProjectId' | 'pending' | 'updating'
>;

const IDLE: Decision = {
  status: READY,
  ranRevision: 'r1',
  ranProjectId: 'p1',
  pending: false,
  updating: false,
};

describe('when the builder updates a running preview by itself', () => {
  it('updates a ready preview of this project to a newer revision', () => {
    assert.equal(shouldUpdateLive(IDLE, { revision: 'r2' }, 'p1'), true);
  });

  it('leaves a preview alone that already serves the revision', () => {
    assert.equal(shouldUpdateLive(IDLE, { revision: 'r1' }, 'p1'), false);
  });

  it('never updates a preview of another project', () => {
    // Switching projects stops the sandbox; until that lands, the preview
    // is still the last project's and must not be given this one's files.
    assert.equal(shouldUpdateLive(IDLE, { revision: 'r2' }, 'p2'), false);
  });

  it('waits while the preview is starting, stopping or already updating', () => {
    for (const busy of [
      { ...IDLE, pending: true },
      { ...IDLE, updating: true },
      { ...IDLE, status: { status: 'installing' as const } },
      { ...IDLE, status: { status: 'starting' as const } },
      { ...IDLE, status: { status: 'failed' as const, error: 'x' } },
      { ...IDLE, status: null },
    ]) {
      assert.equal(shouldUpdateLive(busy, { revision: 'r2' }, 'p1'), false);
    }
  });

  it('does nothing without a revision to update to, or one it is behind', () => {
    assert.equal(shouldUpdateLive(IDLE, null, 'p1'), false);
    assert.equal(
      shouldUpdateLive(
        { ...IDLE, ranRevision: null },
        { revision: 'r2' },
        'p1',
      ),
      false,
    );
  });
});

describe('the "older checkpoint" notice', () => {
  it('is not shown while the update that fixes it is on its way', () => {
    assert.equal(
      servingOlderThan({ status: READY, ranRevision: 'r1' }, 'r2'),
      true,
    );
    assert.equal(
      servingOlderThan(
        { status: READY, ranRevision: 'r1', updating: true },
        'r2',
      ),
      false,
    );
  });

  it('is gone once an update moved the served revision on', () => {
    assert.equal(
      servingOlderThan({ status: READY, ranRevision: 'r2' }, 'r2'),
      false,
    );
  });
});

describe('what a restart nobody pressed says', () => {
  it('says it restarted, and why', () => {
    assert.equal(
      restartNote('The dev server was no longer running.'),
      'Restarted the preview: the change could not be applied to it in place. The dev server was no longer running.',
    );
    assert.equal(
      restartNote(''),
      'Restarted the preview: the change could not be applied to it in place.',
    );
  });
});

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

describe('the Worker side of an update', () => {
  it('posts the files and the revision to the internal update route', async () => {
    const { binding, calls } = fakeBinding(
      () =>
        new Response(
          JSON.stringify({
            outcome: 'applied',
            status: { ...READY, revision: 'r2' },
          }),
        ),
    );
    const result = await updatePreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's3cr3t' },
      'user_1',
      [{ path: 'src/App.tsx', content: 'x' }],
      'r2',
    );
    assert.deepEqual(result, {
      ok: true,
      update: { outcome: 'applied', status: { ...READY, revision: 'r2' } },
    });
    assert.equal(new URL(calls[0]!.url).pathname, '/internal/preview/update');
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.headers.get('authorization'), 'Bearer s3cr3t');
    assert.deepEqual(await calls[0]!.json(), {
      userId: 'user_1',
      files: [{ path: 'src/App.tsx', content: 'x' }],
      revision: 'r2',
    });
  });

  it('reports a refusal or an unreadable answer as not ok, so the builder restarts', async () => {
    const refused = fakeBinding(
      () =>
        new Response(JSON.stringify({ error: 'bad path' }), { status: 400 }),
    );
    assert.deepEqual(
      await updatePreview(
        { PREVIEW: refused.binding, PREVIEW_INTERNAL_SECRET: 's' },
        'u',
        [],
        'r2',
      ),
      { ok: false, error: 'bad path' },
    );
    const garbled = fakeBinding(() => new Response('{"outcome":"maybe"}'));
    const result = await updatePreview(
      { PREVIEW: garbled.binding, PREVIEW_INTERNAL_SECRET: 's' },
      'u',
      [],
      'r2',
    );
    assert.equal(result.ok, false);
  });

  it('carries the revision on a start, and leaves it out when there is none', async () => {
    const { binding, calls } = fakeBinding(
      () => new Response(JSON.stringify({ status: 'installing' })),
    );
    const env = { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' };
    await startPreview(env, 'u', [], undefined, 'r1');
    await startPreview(env, 'u', []);
    assert.equal(
      ((await calls[0]!.json()) as { revision?: string }).revision,
      'r1',
    );
    assert.equal('revision' in ((await calls[1]!.json()) as object), false);
  });

  it('reads each outcome, and nothing that is not one', () => {
    assert.deepEqual(parseServiceUpdate({ outcome: 'installing' }), {
      outcome: 'installing',
    });
    assert.deepEqual(parseServiceUpdate({ outcome: 'busy' }), {
      outcome: 'busy',
    });
    assert.deepEqual(
      parseServiceUpdate({ outcome: 'restart', reason: 'why' }),
      {
        outcome: 'restart',
        reason: 'why',
      },
    );
    // Applied means ready on the new files; anything else is not believed.
    assert.equal(
      parseServiceUpdate({
        outcome: 'applied',
        status: { status: 'installing' },
      }),
      null,
    );
    assert.equal(parseServiceUpdate({ outcome: 'invalid' }), null);
    assert.equal(parseServiceUpdate(null), null);
  });
});

describe('the browser side of an update', () => {
  it('PATCHes /api/preview with the files and revision, and reads the outcome', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ outcome: 'busy' }));
    }) as unknown as typeof fetch;
    const result = await updateSandboxPreview(
      [{ path: 'a.ts', content: '1' }],
      'r2',
      fetchImpl,
      async () => 'tok',
    );
    assert.deepEqual(result, { outcome: 'busy' });
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview');
    assert.equal(init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      files: [{ path: 'a.ts', content: '1' }],
      revision: 'r2',
    });
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer tok',
    );
  });

  it('throws for a refusal and for an answer it cannot read', async () => {
    const refused = (async () =>
      new Response(JSON.stringify({ error: 'Too big.' }), {
        status: 413,
      })) as unknown as typeof fetch;
    await assert.rejects(
      updateSandboxPreview([], 'r2', refused, async () => null),
      /Too big/,
    );
    const garbled = (async () =>
      new Response('not json')) as unknown as typeof fetch;
    await assert.rejects(
      updateSandboxPreview([], 'r2', garbled, async () => null),
      /unreadable/,
    );
  });

  it('names the revision when it starts a preview', async () => {
    let body = '';
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ status: 'installing' }));
    }) as unknown as typeof fetch;
    await startSandboxPreview([], fetchImpl, async () => null, 'r7');
    assert.equal(JSON.parse(body).revision, 'r7');
  });

  it('reads the revision a ready preview serves', () => {
    assert.deepEqual(
      parseUpdate({ outcome: 'applied', status: { ...READY, revision: 'r2' } }),
      { outcome: 'applied', status: { ...READY, revision: 'r2' } },
    );
  });
});

describe('the revision a preview request names', () => {
  it('is optional on a start and required on an update', () => {
    assert.deepEqual(parsePreviewRevision({}, false), {
      ok: true,
      value: null,
    });
    assert.equal(parsePreviewRevision({}, true).ok, false);
    assert.deepEqual(parsePreviewRevision({ revision: 'r1' }, true), {
      ok: true,
      value: 'r1',
    });
  });

  it('is a short single-line name', () => {
    for (const revision of [
      '',
      7,
      'x'.repeat(MAX_PREVIEW_REVISION_CHARS + 1),
      'r1\nr2',
    ]) {
      assert.equal(parsePreviewRevision({ revision }, false).ok, false);
    }
  });
});

describe("the preview service's bounds and this Worker's", () => {
  // apps/web refuses first, and @vibld/preview refuses again where the
  // path becomes a file. If they drifted apart, an update the builder was
  // allowed to send would be refused in the sandbox and turn every
  // follow-up into a restart, with nothing but this test to say why.
  it('agree on how big a previewed project may be', () => {
    assert.equal(MAX_UPDATE_FILES, DEFAULT_LIMITS.maxFiles);
    assert.equal(MAX_UPDATE_PATH_CHARS, DEFAULT_LIMITS.maxPathChars);
    assert.equal(MAX_UPDATE_TOTAL_PATH_CHARS, DEFAULT_LIMITS.maxTotalPathChars);
    assert.equal(MAX_UPDATE_CONTENT_CHARS, DEFAULT_LIMITS.maxTotalContentChars);
    assert.equal(MAX_REVISION_CHARS, MAX_PREVIEW_REVISION_CHARS);
  });
});
