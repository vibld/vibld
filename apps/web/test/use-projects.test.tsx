import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, useMemo, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { usePathname } from '../src/admin/use-pathname.ts';
import { BuilderSession } from '../src/generation/session.ts';
import type { GenerationMode } from '../src/generation/remote-provider.ts';
import type { ProjectSummary } from '../src/projects/projects-client.ts';
import { useProjects } from '../src/projects/use-projects.ts';
import type { ProjectsController } from '../src/projects/use-projects.ts';

/**
 * The projects hook against a real session and a fake `/api/projects`:
 * the refresh that brings the work back, the autosave after a build, and
 * the deployment without a server, which must keep working as it did.
 */

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

const SNAPSHOT = {
  revision: 'r-saved',
  files: [{ path: 'src/App.tsx', content: 'export default () => null;\n' }],
};

const summary = (over: Partial<ProjectSummary>): ProjectSummary => ({
  id: 'p1',
  name: 'Bakery',
  archived: false,
  archivedAt: null,
  createdAt: '2026-09-28T12:00:00.000Z',
  editedAt: '2026-09-28T12:00:00.000Z',
  lastOpenedAt: '2026-09-28T12:00:00.000Z',
  hasCode: true,
  turns: 1,
  settings: {
    style: 'brutalism',
    referenceUrl: null,
    model: null,
    knowledge: 'Warm colours.',
    styleDna: {},
  },
  ...over,
});

function fakeServer(
  projects: ProjectSummary[],
  onPatch?: (call: Call, project: ProjectSummary) => Response | undefined,
) {
  const calls: Call[] = [];
  const reply = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      ...(init?.body
        ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
        : {}),
    };
    calls.push(call);
    if (call.url === '/api/projects' && call.method === 'GET') {
      return reply({
        projects,
        limits: { tier: 'free', active: projects.length, maxActive: 3 },
      });
    }
    if (call.url === '/api/projects' && call.method === 'POST') {
      const made = summary({
        id: 'made-1',
        name: 'Untitled project',
        hasCode: false,
      });
      projects.unshift(made);
      return reply({ project: made }, 201);
    }
    const id = decodeURIComponent(call.url.split('/')[3] ?? '');
    const project = projects.find((p) => p.id === id);
    if (!project) return reply({ error: 'That project does not exist.' }, 404);
    if (call.method === 'GET') {
      return reply({
        project,
        transcript: project.hasCode
          ? [
              {
                id: 1,
                runId: 'run-1',
                prompt: 'A bakery',
                at: 1,
                status: 'accepted',
                agentMessage: null,
                summary: 'Built it.',
                fileCount: 1,
                revision: 'r-saved',
                problem: null,
                providerId: 'remote',
              },
            ]
          : [],
        snapshot: project.hasCode ? SNAPSHOT : null,
      });
    }
    if (call.method === 'PATCH' && onPatch) {
      const answer = onPatch(call, project);
      if (answer) return answer;
    }
    return reply({ project });
  }) as typeof fetch;
  return calls;
}

async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(generation: GenerationMode, path = '/') {
  window.history.replaceState(null, '', path);
  let session!: BuilderSession;
  let projects!: ProjectsController;
  function Harness() {
    session = useMemo(() => {
      let tick = 0;
      const created = new BuilderSession({
        delay: async () => {},
        now: () => (tick += 1),
        stageDelayMs: 0,
        resolveProvider: async (plan) => ({
          id: 'remote',
          generate: async () => plan,
        }),
      });
      created.setGeneration(generation);
      return created;
    }, []);
    const state = useSyncExternalStore(
      session.subscribe,
      session.getState,
      session.getState,
    );
    projects = useProjects(session, state, usePathname());
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness />);
    await settle();
  });
  await act(async () => {
    await settle(10);
  });
  return {
    session: () => session,
    projects: () => projects,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the builder with projects', () => {
  it('reopens the most recently opened project on a load with none in the address', async () => {
    const calls = fakeServer([
      summary({ id: 'recent', name: 'Recent' }),
      summary({ id: 'older', name: 'Older' }),
    ]);
    const view = await mount('model');

    assert.equal(view.projects().mode, 'server');
    assert.equal(view.projects().current?.id, 'recent');
    assert.equal(window.location.pathname, '/p/recent');
    const state = view.session().getState();
    assert.equal(state.projectId, 'recent');
    assert.deepEqual(state.acceptedSnapshot, SNAPSHOT);
    assert.equal(state.style, 'brutalism');
    assert.equal(state.knowledge, 'Warm colours.');
    assert.equal(state.transcript.length, 1);
    assert.ok(
      calls.some(
        (call) => call.method === 'GET' && call.url === '/api/projects/recent',
      ),
    );
    view.unmount();
  });

  it('opens the project the address names, which is what a refresh keeps', async () => {
    fakeServer([
      summary({ id: 'recent', name: 'Recent' }),
      summary({ id: 'older', name: 'Older' }),
    ]);
    const view = await mount('model', '/p/older');
    assert.equal(view.projects().current?.id, 'older');
    assert.equal(window.location.pathname, '/p/older');
    view.unmount();
  });

  it('makes a first project for an account with none', async () => {
    const calls = fakeServer([]);
    const view = await mount('model');
    assert.ok(
      calls.some(
        (call) => call.method === 'POST' && call.url === '/api/projects',
      ),
    );
    assert.equal(view.projects().current?.id, 'made-1');
    assert.equal(window.location.pathname, '/p/made-1');
    view.unmount();
  });

  it('saves the conversation once a build is accepted', async () => {
    const calls = fakeServer([summary({ id: 'recent', name: 'Recent' })]);
    const view = await mount('model');
    await act(async () => {
      await view.session().submit('Add a menu page');
      await settle();
    });
    // What a page going away does: send what is queued now rather than
    // after the pause.
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await settle(10);
    });
    const saves = calls.filter(
      (call) => call.method === 'PATCH' && call.url === '/api/projects/recent',
    );
    assert.ok(saves.length > 0, 'nothing was saved after the build');
    const transcript = saves.at(-1)!.body!.transcript as { status: string }[];
    assert.deepEqual(
      transcript.map((turn) => turn.status),
      ['accepted', 'accepted'],
    );
    view.unmount();
  });

  it('goes back to the list for a project that does not exist', async () => {
    fakeServer([summary({ id: 'recent' })]);
    const view = await mount('model', '/p/gone');
    assert.equal(window.location.pathname, '/projects');
    assert.equal(view.projects().notice?.kind, 'not-found');
    view.unmount();
  });
});

describe('two tabs on one project (D63)', () => {
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  async function buildAndLeave(view: Awaited<ReturnType<typeof mount>>) {
    await act(async () => {
      await view.session().submit('Add a menu page');
      await settle();
    });
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await settle(10);
    });
  }

  it('names the version it read and the page it is, and moves to the version each save gives', async () => {
    const calls = fakeServer(
      [summary({ id: 'recent', version: 7 })],
      (call, project) => {
        if (call.body?.transcript === undefined) return undefined;
        project.version = (call.body.version as number) + 1;
        return json({ project });
      },
    );
    const view = await mount('model');
    await buildAndLeave(view);
    await buildAndLeave(view);
    const saves = calls.filter(
      (call) => call.method === 'PATCH' && call.body?.transcript,
    );
    assert.ok(saves.length >= 2, `only ${saves.length} saves`);
    assert.equal(saves[0]!.body!.version, 7);
    assert.equal(saves[1]!.body!.version, 8);
    const writer = saves[0]!.body!.writer;
    assert.equal(typeof writer, 'string');
    assert.equal(saves[1]!.body!.writer, writer);
    assert.equal(view.projects().saveStatus, 'saved');
    view.unmount();
  });

  it('stops saving and says so when another tab saved the project first', async () => {
    const calls = fakeServer([summary({ id: 'recent', version: 3 })], () =>
      json(
        {
          error: 'This project changed in another tab.',
          code: 'project-changed',
          version: 4,
        },
        409,
      ),
    );
    const view = await mount('model');
    await buildAndLeave(view);
    assert.equal(view.projects().saveStatus, 'changed');
    const refused = calls.filter((call) => call.method === 'PATCH').length;
    assert.equal(refused, 1);

    // Nothing more is sent from the old copy: not a later turn, not the
    // save a page going away makes.
    await buildAndLeave(view);
    assert.equal(
      calls.filter((call) => call.method === 'PATCH').length,
      refused,
    );
    assert.equal(view.projects().saveStatus, 'changed');
    view.unmount();
  });

  it('sends no version to a Worker that gave none, which saves as it always did', async () => {
    const calls = fakeServer([summary({ id: 'recent' })]);
    const view = await mount('model');
    await buildAndLeave(view);
    const save = calls.find((call) => call.method === 'PATCH');
    assert.ok(save);
    assert.equal('version' in save.body!, false);
    assert.equal('writer' in save.body!, false);
    view.unmount();
  });
});

describe('the builder without a server', () => {
  it('keeps working in memory where the deployment generates in the browser', async () => {
    const calls = fakeServer([summary({})]);
    const view = await mount('fake');
    assert.equal(view.projects().mode, 'local');
    assert.deepEqual(calls, [], 'a fake deployment asked for projects');
    await act(async () => {
      await view.session().submit('A bakery');
      await settle();
    });
    assert.equal(view.session().getState().status, 'accepted');
    assert.equal(view.session().getState().projectId, null);
    view.unmount();
  });
});
