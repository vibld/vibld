import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setProjectShared } from '../src/projects/projects-client.ts';
import {
  openShared,
  peekPendingIntent,
  rememberIntent,
  remixShared,
  sharedPreview,
  takePendingIntent,
} from '../src/projects/share-client.ts';
import type { ShareStorage } from '../src/projects/share-client.ts';
import {
  intentFromSearch,
  isShareToken,
  shareIntentPath,
  sharePath,
  shareTokenFromLink,
  shareTokenFromPath,
  shareUrl,
} from '../src/projects/share-route.ts';
import {
  publishProject,
  unpublishProject,
} from '../src/generation/publish-client.ts';
import { holdSite, releaseSite } from '../src/generation/takedown-client.ts';
import { newShareToken } from '../worker/share-link.ts';

/**
 * The builder's half of sharing and of one site per project: the share
 * page's address, what it sends and what it sends nothing with, the remix
 * carried across a sign-in, the publish and takedown naming their project,
 * and the operator's panel naming a share link.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function server(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { calls, deps: { fetchImpl, getToken: async () => 'token-1' } };
}

const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const TOKEN = newShareToken();

describe("a share link's address", () => {
  it('is /s/<token>, and only a token of the right shape is one', () => {
    assert.equal(sharePath(TOKEN), `/s/${TOKEN}`);
    assert.equal(
      shareUrl('https://app.vibld.com', TOKEN),
      `https://app.vibld.com/s/${TOKEN}`,
    );
    assert.equal(shareTokenFromPath(`/s/${TOKEN}`), TOKEN);
    assert.equal(shareTokenFromPath(`/s/${TOKEN}/`), TOKEN);
    for (const path of ['/s/', '/s/short', `/s/${TOKEN}/more`, '/p/abc']) {
      assert.equal(shareTokenFromPath(path), null, path);
    }
    assert.ok(isShareToken(TOKEN));
  });

  it('is read from whatever a report carried', () => {
    for (const pasted of [
      TOKEN,
      `https://app.vibld.com/s/${TOKEN}`,
      `app.vibld.com/s/${TOKEN}/`,
      `  https://app.vibld.com/s/${TOKEN}?remix=1  `,
    ]) {
      assert.equal(shareTokenFromLink(pasted), TOKEN, pasted);
    }
    for (const pasted of ['acme-site', 'https://acme.vibld-preview.dev/']) {
      assert.equal(shareTokenFromLink(pasted), null, pasted);
    }
  });
});

describe('the share page', () => {
  it("reads the project without sending anybody's credentials", async () => {
    const { calls, deps } = server(() =>
      reply({
        project: { name: 'Bakery' },
        snapshot: { revision: 'r1', files: [{ path: 'a', content: 'b' }] },
        livePreview: true,
      }),
    );
    const opened = await openShared(TOKEN, deps);
    assert.deepEqual(opened, {
      ok: true,
      value: {
        name: 'Bakery',
        snapshot: { revision: 'r1', files: [{ path: 'a', content: 'b' }] },
        livePreview: true,
      },
    });
    assert.equal(calls[0]!.url, `/api/share/${TOKEN}`);
    assert.equal(calls[0]!.headers.Authorization, undefined);
  });

  it('says a dead link is gone', async () => {
    const { deps } = server(() =>
      reply({ error: 'This link is not active.' }, 404),
    );
    const opened = await openShared(TOKEN, deps);
    assert.deepEqual(opened, {
      ok: false,
      failure: { kind: 'gone', message: 'This link is not active.' },
    });
  });

  it('starts the live preview signed, and asks after it unsigned', async () => {
    const { calls, deps } = server((call) =>
      reply(
        call.method === 'POST'
          ? { status: 'installing' }
          : {
              status: 'ready',
              url: 'https://8080-shared-abc-tok.vibld-preview.dev/',
              expiresAt: 1,
            },
      ),
    );
    const started = await sharedPreview(TOKEN, true, deps);
    assert.deepEqual(started, { ok: true, value: { status: 'installing' } });
    const ready = await sharedPreview(TOKEN, false, deps);
    assert.ok(ready.ok && ready.value.status === 'ready');
    assert.deepEqual(
      calls.map((call) => [call.method, call.url, call.headers.Authorization]),
      [
        // Starting needs somebody signed in (docs/decisions.md,
        // 2026-09-28); its state is anybody's.
        ['POST', `/api/share/${TOKEN}/preview`, 'Bearer token-1'],
        ['GET', `/api/share/${TOKEN}/preview`, undefined],
      ],
    );
  });

  it('remixes signed, and reads the limit as the limit', async () => {
    const { calls, deps } = server(() =>
      reply(
        {
          error: 'A free account can have 3.',
          code: 'project-limit',
          limit: 3,
        },
        403,
      ),
    );
    const refused = await remixShared(TOKEN, deps);
    assert.deepEqual(refused, {
      ok: false,
      failure: { kind: 'limit', message: 'A free account can have 3.' },
    });
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.headers.Authorization, 'Bearer token-1');

    const made = server(() =>
      reply({ project: { id: 'p9', name: 'Remix of Bakery' } }, 201),
    );
    const remixed = await remixShared(TOKEN, made.deps);
    assert.ok(remixed.ok && remixed.value.id === 'p9');
  });
});

describe('what was asked for before signing in', () => {
  function storage(): ShareStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('is kept for the tab, a remix or a preview, and forgotten once taken', () => {
    const store = storage();
    rememberIntent(store, { token: TOKEN, intent: 'remix' });
    assert.deepEqual(peekPendingIntent(store), {
      token: TOKEN,
      intent: 'remix',
    });
    assert.ok(peekPendingIntent(store), 'peeking took it');
    assert.deepEqual(takePendingIntent(store), {
      token: TOKEN,
      intent: 'remix',
    });
    assert.equal(takePendingIntent(store), null);

    rememberIntent(store, { token: TOKEN, intent: 'preview' });
    assert.deepEqual(takePendingIntent(store), {
      token: TOKEN,
      intent: 'preview',
    });
  });

  it('comes back on the link as a query, one for each', () => {
    assert.equal(shareIntentPath(TOKEN, 'remix'), `/s/${TOKEN}?remix=1`);
    assert.equal(shareIntentPath(TOKEN, 'preview'), `/s/${TOKEN}?preview=1`);
    assert.equal(intentFromSearch('?remix=1'), 'remix');
    assert.equal(intentFromSearch('?preview=1'), 'preview');
    assert.equal(intentFromSearch(''), null);
  });

  it('ignores a stored value it did not write', () => {
    const store = storage();
    store.map.set('vibld:pending-share', 'publish:abc');
    assert.equal(peekPendingIntent(store), null);
  });

  it('survives a browser that refuses storage', () => {
    const refusing: ShareStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    rememberIntent(refusing, { token: TOKEN, intent: 'remix' });
    assert.equal(peekPendingIntent(refusing), null);
    assert.equal(takePendingIntent(null), null);
  });
});

describe("the owner's share switch", () => {
  it('turns the link on with a POST and off with a DELETE', async () => {
    const summary = {
      id: 'p1',
      name: 'Bakery',
      archived: false,
      archivedAt: null,
      createdAt: '2026-09-28T12:00:00.000Z',
      editedAt: '2026-09-28T12:00:00.000Z',
      lastOpenedAt: '2026-09-28T12:00:00.000Z',
      hasCode: true,
      turns: 0,
      settings: {},
      share: { on: true, url: `https://app.vibld.com/s/${TOKEN}`, held: false },
    };
    const { calls, deps } = server(() => reply({ project: summary }));
    const on = await setProjectShared('p1', true, deps);
    assert.ok(on.ok && on.value.share?.on === true);
    await setProjectShared('p1', false, deps);
    assert.deepEqual(
      calls.map((call) => [call.method, call.url]),
      [
        ['POST', '/api/projects/p1/share'],
        ['DELETE', '/api/projects/p1/share'],
      ],
    );
  });
});

describe('publishing a project', () => {
  it('names the project whose site it is, on a publish and on a takedown', async () => {
    const { calls, deps } = server((call) =>
      reply(
        call.method === 'POST'
          ? {
              slug: 'bakery',
              url: 'https://bakery.vibld-preview.dev/',
              skipped: [],
            }
          : { slug: 'bakery' },
      ),
    );
    await publishProject(
      [{ path: 'index.html', content: 'hi' }],
      'bakery',
      deps.fetchImpl,
      deps.getToken,
      'project-7',
    );
    await unpublishProject(deps.fetchImpl, deps.getToken, 'project-7');
    assert.deepEqual(calls[0]!.body, {
      files: [{ path: 'index.html', content: 'hi' }],
      slug: 'bakery',
      projectId: 'project-7',
    });
    assert.equal(calls[1]!.method, 'DELETE');
    assert.deepEqual(calls[1]!.body, { projectId: 'project-7' });
    assert.equal(calls[1]!.headers['content-type'], 'application/json');
  });

  it('names none without a project, as an older builder did', async () => {
    const { calls, deps } = server(() => reply({ slug: 'bakery' }));
    await unpublishProject(deps.fetchImpl, deps.getToken);
    assert.equal(calls[0]!.body, undefined);
  });
});

describe("the operator's takedown", () => {
  it('names a share link as a share link, and a slug as a slug', async () => {
    const { calls, deps } = server((call) =>
      reply(
        (call.body as { share?: string }).share
          ? { share: TOKEN, state: 'held' }
          : { slug: 'acme', state: 'held' },
      ),
    );
    const link = `https://app.vibld.com/s/${TOKEN}`;
    const held = await holdSite(
      link,
      'phishing',
      deps.fetchImpl,
      deps.getToken,
    );
    assert.deepEqual(held, {
      ok: true,
      slug: link,
      state: 'held',
      share: true,
    });
    await holdSite('acme', 'phishing', deps.fetchImpl, deps.getToken);
    await releaseSite(link, deps.fetchImpl, deps.getToken);
    assert.deepEqual(
      calls.map((call) => call.body),
      [
        { share: link, reason: 'phishing' },
        { slug: 'acme', reason: 'phishing' },
        { share: link },
      ],
    );
  });
});
