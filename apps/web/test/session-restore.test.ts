import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  GenerationPlan,
  ModelProvider,
  TranscriptTurn,
} from '@vibld/core';

import { BuilderSession } from '../src/generation/session.ts';
import type { RestoredProject } from '../src/generation/session.ts';
import { RemoteModelProvider } from '../src/generation/remote-provider.ts';

/**
 * Opening a project in the builder (docs/decisions.md, 2026-09-28,
 * projects): everything it remembered comes back, and building carries on
 * from where it was, in that project.
 *
 * The follow-up is the part that would fail quietly. The Worker compares the
 * revision a build says it is editing with the one it has stored, so a
 * session that put the code on screen without also holding its revision
 * would have its first follow-up refused as a conflict with its own
 * project.
 */

const RESTORED_SNAPSHOT = {
  revision: 'r-restored',
  files: [{ path: 'src/App.tsx', content: 'export default () => null;\n' }],
};

const turn = (over: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id: 1,
  runId: 'run-1',
  prompt: 'A bakery',
  at: 1,
  status: 'accepted',
  agentMessage: null,
  summary: 'Built a bakery site.',
  fileCount: 1,
  revision: 'r-restored',
  problem: null,
  providerId: 'remote',
  ...over,
});

function project(over: Partial<RestoredProject> = {}): RestoredProject {
  return {
    id: 'project-1',
    transcript: [turn(), turn({ id: 7, runId: 'chat-4', status: 'running' })],
    snapshot: RESTORED_SNAPSHOT,
    style: 'brutalism',
    referenceUrl: 'https://example.com/',
    model: 'project-model',
    knowledge: 'Keep it warm.',
    styleDna: { corners: 'sharp' },
    ...over,
  };
}

interface Seen {
  projectIds: (string | null | undefined)[];
  bases: (string | null)[];
}

function createSession(
  seen: Seen,
  generate?: (plan: GenerationPlan) => Promise<GenerationPlan>,
) {
  let tick = 0;
  return new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    resolveProvider: async (
      plan,
      _signal,
      _onProgress,
      _style,
      _knowledge,
      _model,
      _referenceUrl,
      _styleDna,
      _mockup,
      projectId,
    ): Promise<ModelProvider> => {
      seen.projectIds.push(projectId);
      return {
        id: 'remote',
        generate: async (request) => {
          seen.bases.push(request.base?.revision ?? null);
          return generate ? generate(plan) : plan;
        },
      };
    },
  });
}

describe('opening a project', () => {
  it('puts back its conversation, its code and its settings', async () => {
    const session = createSession({ projectIds: [], bases: [] });
    session.setModels([{ id: 'm', label: 'M', note: '', provider: 'p' }]);
    session.setIsAdmin(true);
    await session.restore(project());

    const state = session.getState();
    assert.equal(state.projectId, 'project-1');
    assert.deepEqual(state.acceptedSnapshot, RESTORED_SNAPSHOT);
    assert.deepEqual(state.stagedFiles, RESTORED_SNAPSHOT.files);
    assert.equal(state.style, 'brutalism');
    assert.equal(state.referenceUrl, 'https://example.com/');
    assert.equal(state.model, 'project-model');
    assert.equal(state.knowledge, 'Keep it warm.');
    assert.deepEqual(state.styleDna, { corners: 'sharp' });
    // A turn saved while it was still running belonged to a request the
    // reload dropped, and reads as the cancellation it became.
    assert.deepEqual(
      state.transcript.map((t) => t.status),
      ['accepted', 'cancelled'],
    );
    // What the deployment serves is not the project's.
    assert.equal(state.models.length, 1);
    assert.equal(state.isAdmin, true);
  });

  it('builds the next change on the restored code, in that project', async () => {
    const seen: Seen = { projectIds: [], bases: [] };
    const session = createSession(seen);
    await session.restore(project());

    await session.submit('Add a menu page');

    assert.deepEqual(seen.projectIds, ['project-1']);
    assert.deepEqual(seen.bases, ['r-restored']);
    const state = session.getState();
    assert.equal(state.status, 'accepted', state.problems.join('; '));
    assert.notEqual(state.acceptedSnapshot?.revision, 'r-restored');
  });

  it('numbers new turns after the ones it restored', async () => {
    const session = createSession({ projectIds: [], bases: [] });
    await session.restore(project());
    await session.submit('Add a menu page');
    const ids = session.getState().transcript.map((t) => t.id);
    assert.deepEqual(ids, [1, 7, 8]);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('opens an empty project as a fresh one', async () => {
    const seen: Seen = { projectIds: [], bases: [] };
    const session = createSession(seen);
    await session.restore(
      project({
        transcript: [],
        snapshot: null,
        style: null,
        referenceUrl: '',
      }),
    );
    const state = session.getState();
    assert.equal(state.acceptedSnapshot, null);
    assert.deepEqual(state.transcript, []);
    await session.submit('A bakery');
    assert.deepEqual(seen.bases, [null]);
  });

  it('drops a build still running for the project being left', async () => {
    let finish!: (plan: GenerationPlan) => void;
    const seen: Seen = { projectIds: [], bases: [] };
    const session = createSession(
      seen,
      (plan) =>
        new Promise<GenerationPlan>((resolve) => {
          finish = () => resolve(plan);
        }),
    );
    const running = session.submit('A garage');
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(session.getState().running, true);

    await session.restore(project());
    finish({ summary: 'late', files: [] });
    await running;

    const state = session.getState();
    assert.equal(state.running, false);
    assert.equal(state.projectId, 'project-1');
    assert.deepEqual(state.acceptedSnapshot, RESTORED_SNAPSHOT);
    assert.ok(
      state.transcript.every((t) => t.prompt !== 'A garage'),
      'the abandoned build landed in the project that was opened',
    );
  });

  it('lets the later of two opens win', async () => {
    const session = createSession({ projectIds: [], bases: [] });
    const first = session.restore(project({ id: 'first' }));
    const second = session.restore(project({ id: 'second', snapshot: null }));
    await Promise.all([first, second]);
    assert.equal(session.getState().projectId, 'second');
    assert.equal(session.getState().acceptedSnapshot, null);
  });
});

describe('what a project remembers about how it is built', () => {
  it('is the composer and the preferences, as the autosave reads them', async () => {
    const session = createSession({ projectIds: [], bases: [] });
    await session.restore(project());
    session.setStyle('minimalist');
    session.setReferenceUrl('  https://other.example/  ');
    assert.deepEqual(session.settings(), {
      style: 'minimalist',
      referenceUrl: 'https://other.example/',
      model: 'project-model',
      knowledge: 'Keep it warm.',
      styleDna: { corners: 'sharp' },
      galleryStyle: null,
    });
  });

  it('holds a gallery style or a style preset, never both', async () => {
    const session = createSession({ projectIds: [], bases: [] });
    await session.restore(project());
    session.setStyle('minimalist');
    session.setGalleryStyle('vinepool');
    assert.equal(session.getState().style, null);
    assert.equal(session.getState().galleryStyle, 'vinepool');
    session.setStyle('brutalism');
    assert.equal(session.getState().galleryStyle, null);
    assert.equal(session.settings().style, 'brutalism');
  });

  it('puts back the gallery style a project saved', async () => {
    const session = createSession({ projectIds: [], bases: [] });
    await session.restore(project({ galleryStyle: 'vinepool' }));
    assert.equal(session.getState().galleryStyle, 'vinepool');
  });

  it('keeps the reference a reply is holding for the next build', async () => {
    // The agent answered instead of building, so the reference that went
    // with the message waits for the "yes". Held only in the session, it
    // would be lost on a reload; saved, it comes back into the field.
    let tick = 0;
    const session = new BuilderSession({
      delay: async () => {},
      now: () => (tick += 1),
      stageDelayMs: 0,
      requestChatTurnImpl: (async () => ({
        ok: true,
        turn: { action: 'reply', message: 'Shall I use its colours?' },
      })) as never,
    });
    session.setGeneration('model');
    await session.send(
      'Like this one',
      'succeed',
      null,
      'https://ref.example/',
    );
    assert.equal(session.getState().referenceUrl, '');
    assert.equal(session.settings().referenceUrl, 'https://ref.example/');
  });
});

describe('the build request', () => {
  it('names the project it is for', async () => {
    let body: Record<string, unknown> = {};
    const provider = new RemoteModelProvider({
      projectId: 'project-1',
      getToken: async () => 'token',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          `event: plan\ndata: ${JSON.stringify({ plan: { summary: 's', files: [] } })}\n\n`,
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    await provider.generate({ prompt: 'A bakery' });
    assert.equal(body.projectId, 'project-1');
  });
});
