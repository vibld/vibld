import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { beginConnect, completeConnect } from '../src/github/github-client.ts';
import type {
  ConnectOffer,
  GitHubStatus,
} from '../src/github/github-client.ts';
import { receiveCompletion } from '../src/github/connect-actions.ts';
import { connectFlow, shipShouldOpen } from '../src/github/connect-flow.ts';
import {
  createGitHubStatusStore,
  githubStatus,
} from '../src/github/github-status.ts';
import { decidePanel } from '../src/github/panel-view.ts';
import {
  FALLBACK_REPOSITORY_NAME,
  repositoryNameFor,
} from '../src/github/repo-name.ts';

/**
 * The builder's half of "create or pick" (D72): the name it suggests, what
 * the panel offers a project with no repository, the trip to GitHub
 * remembering which project it was for, and a created repository being
 * bound to that project without another click.
 */

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as Storage;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noToken = async () => null;

describe('the name suggested for a new repository', () => {
  it('is the project name, as GitHub would accept it', () => {
    assert.equal(repositoryNameFor('North Star'), 'north-star');
    assert.equal(repositoryNameFor('  Café Menu 2026!  '), 'cafe-menu-2026');
    assert.equal(repositoryNameFor('a / b // c'), 'a-b-c');
    assert.equal(repositoryNameFor('my.site_v2'), 'my.site_v2');
  });

  it('never starts or ends with a hyphen or a dot', () => {
    assert.equal(repositoryNameFor('...hidden---'), 'hidden');
    assert.equal(repositoryNameFor('-x-'), 'x');
  });

  it('stays inside GitHub’s hundred characters', () => {
    const long = repositoryNameFor('word '.repeat(60));
    assert.ok(long.length <= 100);
    assert.doesNotMatch(long, /[-.]$/);
  });

  it('falls back to a fixed name when nothing usable is left', () => {
    assert.equal(repositoryNameFor('!!!'), FALLBACK_REPOSITORY_NAME);
    assert.equal(repositoryNameFor('北極星'), FALLBACK_REPOSITORY_NAME);
  });
});

describe('what the panel offers a project', () => {
  const UNBOUND: GitHubStatus = {
    configured: true,
    canPush: true,
    canConnect: true,
    account: { connected: true, login: 'chris' },
    connected: false,
    reason: 'none',
  };

  it('offers "create or pick" to a project with no repository', () => {
    const view = decidePanel({ at: 'idle' }, UNBOUND);
    assert.ok(view.show);
    if (view.show) {
      assert.deepEqual(view.chooser, {});
      assert.deepEqual(view.account, { login: 'chris' });
    }
  });

  it('offers nothing to choose on a deployment that cannot connect', () => {
    const view = decidePanel({ at: 'idle' }, { ...UNBOUND, canConnect: false });
    assert.ok(view.show);
    if (view.show) assert.equal(view.chooser, undefined);
  });

  it('offers no choice to a project that already pushes somewhere', () => {
    const view = decidePanel(
      { at: 'idle' },
      {
        ...UNBOUND,
        connected: true,
        owner: 'chris',
        repo: 'north-star',
        defaultBranch: 'main',
      },
    );
    assert.ok(view.show);
    if (view.show) assert.equal(view.chooser, undefined);
  });

  it('shows why a creation failed, with the free name in the field', () => {
    const offer: ConnectOffer = {
      repositories: [],
      ticket: 't',
      createProblem: {
        error: 'There is already a repository called north-star.',
        suggestion: 'north-star-2',
      },
    };
    const view = decidePanel({ at: 'choosing', offer }, UNBOUND);
    assert.ok(view.show);
    if (view.show) {
      assert.equal(
        view.problem?.error,
        'There is already a repository called north-star.',
      );
      // Not "none of your repositories are pushable": that is an answer to
      // a question nobody asked.
      assert.doesNotMatch(view.problem?.error ?? '', /push to/);
      assert.deepEqual(view.chooser, { name: 'north-star-2' });
      assert.equal(view.picker, undefined);
    }
  });

  it('still offers the picker beside a creation that failed', () => {
    const offer: ConnectOffer = {
      repositories: [
        {
          installationId: 42,
          owner: 'chris',
          repo: 'north-star',
          defaultBranch: 'main',
        },
      ],
      ticket: 't',
      createProblem: { error: 'vibld is not allowed to create repositories.' },
    };
    const view = decidePanel({ at: 'choosing', offer }, UNBOUND);
    assert.ok(view.show);
    if (view.show) {
      assert.equal(view.picker, offer);
      assert.match(view.problem?.error ?? '', /not allowed to create/);
    }
  });
});

describe('the trip to GitHub, and back', () => {
  it('remembers which project it was for and what to create', async () => {
    const kept = storage();
    const started = await beginConnect(
      (async () =>
        json({
          url: 'https://github.com/login/oauth/authorize',
          state: 'the-state',
        })) as unknown as typeof fetch,
      noToken,
      kept,
      {
        projectId: 'north-star',
        create: { name: 'north-star', private: true },
        from: 'ship',
      },
    );
    assert.equal(started.ok, true);

    const sent: Record<string, unknown>[] = [];
    const finished = await completeConnect(
      { code: 'the-code', state: 'the-state' },
      (async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return json({
          repositories: [
            {
              installationId: 42,
              owner: 'chris',
              repo: 'north-star',
              defaultBranch: 'main',
            },
          ],
          ticket: 'the-ticket',
          created: {
            installationId: 42,
            owner: 'chris',
            repo: 'north-star',
            defaultBranch: 'main',
          },
        });
      }) as unknown as typeof fetch,
      noToken,
      kept,
    );

    // The name goes to the server with the code, which is the only request
    // holding the token that can create it.
    assert.deepEqual(sent[0]?.create, { name: 'north-star', private: true });
    assert.equal(finished.ok, true);
    if (finished.ok) {
      assert.deepEqual(finished.intent, {
        projectId: 'north-star',
        create: { name: 'north-star', private: true },
        from: 'ship',
      });
      assert.equal(finished.offer.created?.repo, 'north-star');
    }
    // Good for one trip only.
    assert.equal(kept.getItem('vibld.github.intent'), null);
  });

  it('sends no creation when the trip was to pick one', async () => {
    const kept = storage();
    await beginConnect(
      (async () =>
        json({
          url: 'https://github.com/x',
          state: 's',
        })) as unknown as typeof fetch,
      noToken,
      kept,
      { projectId: 'north-star', from: 'settings' },
    );
    const sent: Record<string, unknown>[] = [];
    await completeConnect(
      { code: 'c', state: 's' },
      (async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return json({ repositories: [], ticket: 't' });
      }) as unknown as typeof fetch,
      noToken,
      kept,
    );
    assert.equal('create' in (sent[0] ?? {}), false);
  });
});

describe('what happens with the answer', () => {
  beforeEach(() => {
    githubStatus.forget();
    githubStatus.setProject(null);
    connectFlow.set({ phase: { at: 'idle' }, projectId: null });
  });

  it('binds a created repository to the project it was created for', async () => {
    const sent: { url: string; body?: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      sent.push({
        url,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url.includes('/api/github/bind')) {
        return json({
          projectId: 'north-star',
          owner: 'chris',
          repo: 'north-star',
          defaultBranch: 'main',
        });
      }
      return json({ configured: true, connected: true });
    }) as typeof fetch;

    await receiveCompletion(
      {
        ok: true,
        offer: {
          repositories: [],
          ticket: 'the-ticket',
          created: {
            installationId: 42,
            owner: 'chris',
            repo: 'north-star',
            defaultBranch: 'main',
          },
        },
        intent: { projectId: 'north-star', from: 'ship' },
      },
      // The open project is another one: the answer still goes where the
      // trip was for.
      'sketches',
    );

    const bind = sent.find((call) => call.url.includes('/api/github/bind'));
    assert.deepEqual(bind?.body, {
      ticket: 'the-ticket',
      projectId: 'north-star',
      owner: 'chris',
      repo: 'north-star',
    });
    assert.equal(connectFlow.read().phase.at, 'idle');
  });

  it('offers the picker for the project the trip was for', async () => {
    const offer: ConnectOffer = { repositories: [], ticket: 't' };
    await receiveCompletion(
      { ok: true, offer, intent: { projectId: 'north-star', from: 'ship' } },
      'sketches',
    );
    const flow = connectFlow.read();
    assert.equal(flow.phase.at, 'choosing');
    assert.equal(flow.projectId, 'north-star');
    // And the Ship menu, which asked, opens with it.
    assert.equal(shipShouldOpen(flow), true);
  });

  it('falls back to the open project when the browser forgot', async () => {
    await receiveCompletion(
      { ok: false, error: 'GitHub said no.', intent: null },
      'sketches',
    );
    const flow = connectFlow.read();
    assert.equal(flow.phase.at, 'problem');
    assert.equal(flow.projectId, 'sketches');
    assert.equal(shipShouldOpen(flow), false);
  });
});

describe('the one status, per project', () => {
  it('asks about the project it is pointed at', async () => {
    const asked: (string | null)[] = [];
    const store = createGitHubStatusStore(async (projectId) => {
      asked.push(projectId);
      return { configured: true, projectId: projectId ?? undefined };
    });
    store.setProject('north-star');
    await store.refresh();
    store.setProject('sketches');
    await store.refresh();
    assert.deepEqual(asked, ['north-star', 'sketches']);
    assert.equal(store.read()?.projectId, 'sketches');
  });

  it('forgets the last project’s repository the moment the project changes', async () => {
    const store = createGitHubStatusStore(async () => ({
      configured: true,
      connected: true,
      owner: 'chris',
      repo: 'north-star',
    }));
    store.setProject('north-star');
    await store.refresh();
    assert.equal(store.read()?.repo, 'north-star');
    store.setProject('sketches');
    assert.equal(store.read(), null);
  });

  it('does not let a read for the last project land under the next', async () => {
    let release: ((value: GitHubStatus) => void) | null = null;
    const store = createGitHubStatusStore(
      (projectId) =>
        new Promise<GitHubStatus>((resolve) => {
          if (projectId === 'north-star') {
            release = resolve;
          } else {
            resolve({ configured: true, connected: false });
          }
        }),
    );
    store.setProject('north-star');
    const slow = store.refresh();
    store.setProject('sketches');
    await store.refresh();
    release!({ configured: true, connected: true, repo: 'north-star' });
    await slow;
    assert.equal(store.read()?.connected, false);
  });
});
