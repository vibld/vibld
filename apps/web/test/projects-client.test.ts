import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  openProject,
  saveProject,
} from '../src/projects/projects-client.ts';

/**
 * The builder's half of `/api/projects`: what it sends, and how it reads
 * what comes back. The part that matters most is the failures, because the
 * builder does different things with each: a limit offers an upgrade, a
 * missing project goes back to the list, and a deployment without projects
 * is not an error at all, only a builder that does not save.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  keepalive?: boolean;
}

function server(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      ...(init?.keepalive ? { keepalive: true } : {}),
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

const SUMMARY = {
  id: 'p1',
  name: 'Bakery',
  archived: false,
  archivedAt: null,
  createdAt: '2026-09-28T12:00:00.000Z',
  editedAt: '2026-09-28T12:00:00.000Z',
  lastOpenedAt: '2026-09-28T12:00:00.000Z',
  hasCode: true,
  turns: 2,
  settings: {
    style: null,
    referenceUrl: null,
    model: null,
    knowledge: null,
    styleDna: null,
  },
};

describe('talking to /api/projects', () => {
  it('lists, with the limits the page shows', async () => {
    const { calls, deps } = server(() =>
      reply({
        projects: [SUMMARY, { broken: true }],
        limits: { tier: 'free', active: 1, maxActive: 3 },
      }),
    );
    const listed = await listProjects(deps);
    assert.ok(listed.ok);
    // A malformed row is dropped, not the whole list.
    assert.deepEqual(
      listed.value.projects.map((p) => p.id),
      ['p1'],
    );
    assert.equal(listed.value.limits.maxActive, 3);
    assert.equal(calls[0]!.headers.Authorization, 'Bearer token-1');
  });

  it('opens a project with its conversation and its code', async () => {
    const { calls, deps } = server(() =>
      reply({
        project: SUMMARY,
        transcript: [],
        snapshot: { revision: 'r1', files: [{ path: 'a', content: 'b' }] },
      }),
    );
    const opened = await openProject('p 1', deps);
    assert.ok(opened.ok);
    assert.equal(opened.value.snapshot?.revision, 'r1');
    assert.equal(calls[0]!.url, '/api/projects/p%201');
  });

  it('sends each write as JSON, with the method its route takes', async () => {
    const { calls, deps } = server((call) =>
      call.method === 'DELETE'
        ? reply({ deleted: true })
        : reply({ project: SUMMARY }, call.method === 'PATCH' ? 200 : 201),
    );
    assert.ok((await createProject({ name: 'Bakery' }, deps)).ok);
    assert.ok((await saveProject('p1', { name: 'Shop' }, deps)).ok);
    assert.ok((await duplicateProject('p1', deps)).ok);
    assert.ok((await deleteProject('p1', deps)).ok);
    assert.deepEqual(
      calls.map((call) => [call.method, call.url]),
      [
        ['POST', '/api/projects'],
        ['PATCH', '/api/projects/p1'],
        ['POST', '/api/projects/p1/duplicate'],
        ['DELETE', '/api/projects/p1'],
      ],
    );
    assert.equal(calls[1]!.headers['content-type'], 'application/json');
    assert.deepEqual(calls[1]!.body, { name: 'Shop' });
  });

  it('lets a small save outlive the page, and does not try it with a large one', async () => {
    const { calls, deps } = server(() => reply({ project: SUMMARY }));
    await saveProject('p1', { name: 'Shop' }, deps);
    await saveProject('p1', { name: 'x'.repeat(70_000) }, deps);
    assert.equal(calls[0]!.keepalive, true);
    assert.equal(calls[1]!.keepalive, undefined);
  });
});

describe('what a failure is', () => {
  it('is a limit, with the number, when the free tier is full', async () => {
    const { deps } = server(() =>
      reply(
        {
          error: 'A free account can have 3...',
          code: 'project-limit',
          limit: 3,
        },
        403,
      ),
    );
    const refused = await createProject({}, deps);
    assert.deepEqual(refused, {
      ok: false,
      failure: {
        kind: 'limit',
        message: 'A free account can have 3...',
        limit: 3,
      },
    });
  });

  it('is not found for a project that is gone or never was the caller’s', async () => {
    const { deps } = server(() =>
      reply({ error: 'That project does not exist.' }, 404),
    );
    const opened = await openProject('p1', deps);
    assert.equal(!opened.ok && opened.failure.kind, 'not-found');
  });

  it('is unavailable where the deployment has no projects at all', async () => {
    // A Worker that says so, and the static dev server, which answers an
    // API path with the shell's HTML.
    for (const answer of [
      () => reply({ error: 'Projects are not configured.' }, 503),
      () => new Response('<!doctype html>', { status: 200 }),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]) {
      const { deps } = server(answer);
      const listed = await listProjects(deps);
      assert.equal(!listed.ok && listed.failure.kind, 'unavailable');
    }
  });

  it('carries the Worker’s own sentence otherwise', async () => {
    const { deps } = server(() =>
      reply({ error: 'This conversation is too long to save.' }, 413),
    );
    const saved = await saveProject('p1', { transcript: [] }, deps);
    assert.deepEqual(saved, {
      ok: false,
      failure: {
        kind: 'failed',
        message: 'This conversation is too long to save.',
        status: 413,
      },
    });
  });
});
