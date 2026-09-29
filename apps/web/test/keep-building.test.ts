import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UNSEEN_FAILURE } from '@vibld/core';
import type { ModelProvider, TranscriptTurn } from '@vibld/core';

import {
  BuilderSession,
  CONNECTION_DROPPED,
  STILL_RUNNING,
} from '../src/generation/session.ts';
import type { RestoredProject } from '../src/generation/session.ts';
import { RemoteModelProvider } from '../src/generation/remote-provider.ts';
import type { BuildAnswer } from '../src/generation/runs-client.ts';

/**
 * The builder's half of a build that outlives its page (docs/decisions.md,
 * "Resolved 2026-09-29", keep building): it learns the Worker's id for the
 * build, Stop stops it through the Worker and says so when it cannot, a
 * dropped connection is asked after rather than reported as a failure, and
 * a reopened project shows a build still running and settles the turn a
 * page that went away left open.
 */

const RUN = 'wf-553ea6c7';

const NEW_CODE = {
  revision: 'r-2',
  files: [
    { path: 'index.html', content: '<h1>Bakery</h1>' },
    { path: 'menu.html', content: '<h1>Menu</h1>' },
  ],
};

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * `/api/plan` as the Worker streams it: the run's id, and then either
 * nothing until the request is aborted, or the connection closing with no
 * result, which is what a phone locking looks like from the page.
 */
function planStream(ending: 'hold' | 'drop') {
  const seen = { aborted: false };
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(frame('run', { runId: RUN }));
        if (ending === 'drop') controller.close();
        init?.signal?.addEventListener('abort', () => {
          seen.aborted = true;
          controller.error(new DOMException('aborted', 'AbortError'));
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

interface Options {
  fetchImpl?: typeof fetch;
  answers?: BuildAnswer[];
  stop?: BuildAnswer;
}

function createSession(options: Options = {}) {
  const asked: string[] = [];
  const stopped: string[] = [];
  const answers = [...(options.answers ?? [])];
  let tick = 1_000;
  const session = new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    // A real turn of the event loop, as the interval is, without its wait.
    pollDelay: () => new Promise((resolve) => setTimeout(resolve, 0)),
    fetchBuildImpl: async (runId) => {
      asked.push(runId);
      return (
        answers.shift() ?? {
          ok: true,
          run: { id: runId, state: 'running', startedAt: '' },
          snapshot: null,
        }
      );
    },
    stopBuildImpl: async (runId) => {
      stopped.push(runId);
      return (
        options.stop ?? {
          ok: true,
          run: { id: runId, state: 'cancelled', startedAt: '' },
          snapshot: null,
        }
      );
    },
    resolveProvider: async (
      _plan,
      signal,
      _onProgress,
      _style,
      _knowledge,
      _model,
      _referenceUrl,
      _styleDna,
      _mockup,
      projectId,
      onRun,
    ): Promise<ModelProvider> =>
      new RemoteModelProvider({
        signal,
        fetchImpl: options.fetchImpl ?? planStream('hold').fetchImpl,
        getToken: async () => null,
        ...(projectId ? { projectId } : {}),
        ...(onRun ? { onRun } : {}),
      }),
  });
  return { session, asked, stopped };
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(done(), 'the session never got there');
}

const turn = (over: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id: 1,
  runId: 'run-1',
  prompt: 'A bakery',
  at: 1,
  status: 'accepted',
  agentMessage: null,
  summary: 'Built a bakery site.',
  fileCount: 1,
  revision: 'r-1',
  problem: null,
  providerId: 'remote',
  ...over,
});

function project(over: Partial<RestoredProject> = {}): RestoredProject {
  return {
    id: 'project-1',
    transcript: [
      turn(),
      turn({
        id: 2,
        runId: 'run-2',
        prompt: 'Add a menu page',
        status: 'running',
        summary: null,
        fileCount: 0,
        revision: null,
        providerId: null,
        serverRunId: RUN,
      }),
    ],
    snapshot: {
      revision: 'r-1',
      files: [{ path: 'index.html', content: '<h1>Old</h1>' }],
    },
    style: null,
    referenceUrl: '',
    model: null,
    knowledge: '',
    styleDna: {},
    ...over,
  };
}

const accepted: BuildAnswer = {
  ok: true,
  run: { id: RUN, state: 'accepted', startedAt: '', revision: 'r-2' },
  snapshot: NEW_CODE,
};

describe('the id of a build the Worker admitted', () => {
  it('is kept on the session and on its turn, for Stop and for a reload', async () => {
    const { session } = createSession();
    void session.submit('A bakery');
    await until(() => session.getState().serverRunId === RUN);
    assert.equal(session.getState().transcript.at(-1)?.serverRunId, RUN);
  });
});

describe('Stop', () => {
  it('asks the Worker to stop the build, then lets go of the stream', async () => {
    const stream = planStream('hold');
    const { session, stopped } = createSession({ fetchImpl: stream.fetchImpl });
    void session.submit('A bakery');
    await until(() => session.getState().serverRunId === RUN);

    await session.cancel();

    assert.deepEqual(stopped, [RUN], 'the build was left running');
    assert.equal(stream.seen.aborted, true);
    const state = session.getState();
    assert.equal(state.status, 'cancelled');
    assert.equal(state.running, false);
    assert.equal(state.transcript.at(-1)?.status, 'cancelled');
  });

  it('says so when the build could not be stopped, and does not claim it did', async () => {
    const stream = planStream('hold');
    const { session } = createSession({
      fetchImpl: stream.fetchImpl,
      stop: {
        ok: false,
        message: 'The build could not be stopped. It is still running.',
      },
    });
    void session.submit('A bakery');
    await until(() => session.getState().serverRunId === RUN);

    await session.cancel();

    const state = session.getState();
    assert.equal(state.running, true, 'shown as stopped while it runs');
    assert.notEqual(state.status, 'cancelled');
    assert.equal(state.transcript.at(-1)?.status, 'running');
    assert.match(state.notice ?? '', /could not be stopped/);
    assert.equal(stream.seen.aborted, false, 'the result can still arrive');
  });
});

describe('a connection that drops mid-build', () => {
  it('is asked after, not reported as a failure, and its result lands', async () => {
    const { session, asked } = createSession({
      fetchImpl: planStream('drop').fetchImpl,
      answers: [
        {
          ok: true,
          run: { id: RUN, state: 'running', startedAt: '' },
          snapshot: null,
        },
        accepted,
      ],
    });
    await session.submit('A bakery');
    // Between the drop and the answer, the build reads as still going.
    await until(() => session.getState().status === 'accepted');

    assert.ok(asked.length >= 2 && asked.every((id) => id === RUN));
    const state = session.getState();
    assert.deepEqual(state.acceptedSnapshot, NEW_CODE);
    assert.deepEqual(state.stagedFiles, NEW_CODE.files);
    assert.equal(state.notice, null);
    const last = state.transcript.at(-1);
    assert.equal(last?.status, 'accepted');
    assert.equal(last?.revision, 'r-2');
    assert.equal(last?.fileCount, 2);
  });

  it('says the build is still running while it is asked after', async () => {
    // No answer but "running", so the in-between state stays to be read.
    const { session } = createSession({
      fetchImpl: planStream('drop').fetchImpl,
    });
    void session.submit('A bakery');
    await until(() => session.getState().notice === CONNECTION_DROPPED);
    const state = session.getState();
    assert.equal(state.running, true);
    assert.notEqual(state.status, 'failed');
    assert.equal(state.transcript.at(-1)?.status, 'running');
    session.dispose();
  });
});

describe('opening a project whose build carried on without it', () => {
  it('shows it running, asks after it, and loads what it built', async () => {
    const { session, asked } = createSession({
      answers: [
        {
          ok: true,
          run: { id: RUN, state: 'running', startedAt: '' },
          snapshot: null,
        },
        accepted,
      ],
    });
    await session.restore(
      project({ build: { runId: RUN, startedAt: '2026-09-29T12:00:00Z' } }),
    );
    await until(() => session.getState().status === 'accepted');
    assert.ok(asked.includes(RUN));
    const state = session.getState();
    assert.deepEqual(state.acceptedSnapshot, NEW_CODE);
    assert.equal(state.transcript.at(-1)?.status, 'accepted');
    assert.equal(state.transcript.at(-1)?.revision, 'r-2');
  });

  it('says the build is still running, and offers Stop through the Worker', async () => {
    const { session, stopped } = createSession();
    await session.restore(
      project({ build: { runId: RUN, startedAt: '2026-09-29T12:00:00Z' } }),
    );
    const state = session.getState();
    assert.equal(state.running, true);
    assert.equal(state.serverRunId, RUN);
    assert.equal(state.notice, STILL_RUNNING);
    assert.equal(state.transcript.at(-1)?.status, 'running');

    await session.cancel();
    assert.deepEqual(stopped, [RUN]);
    assert.equal(session.getState().status, 'cancelled');
    assert.equal(session.getState().transcript.at(-1)?.status, 'cancelled');
  });

  it('settles a turn whose build ended while nobody watched', async () => {
    const failed = createSession({
      answers: [
        {
          ok: true,
          run: { id: RUN, state: 'failed', startedAt: '' },
          snapshot: null,
        },
      ],
    });
    await failed.session.restore(project());
    await until(() => failed.session.getState().running === false);
    const turnAfter = failed.session.getState().transcript.at(-1);
    assert.equal(turnAfter?.status, 'failed');
    assert.equal(turnAfter?.problem, UNSEEN_FAILURE);
    assert.equal(
      failed.session.getState().acceptedSnapshot?.revision,
      'r-1',
      'a failed build changed the code on screen',
    );

    const cancelled = createSession({
      answers: [
        {
          ok: true,
          run: { id: RUN, state: 'cancelled', startedAt: '' },
          snapshot: null,
        },
      ],
    });
    await cancelled.session.restore(project());
    await until(() => cancelled.session.getState().running === false);
    assert.equal(
      cancelled.session.getState().transcript.at(-1)?.status,
      'cancelled',
    );

    const moved = createSession({ answers: [accepted] });
    await moved.session.restore(project());
    await until(() => moved.session.getState().running === false);
    assert.equal(
      moved.session.getState().transcript.at(-1)?.status,
      'accepted',
    );
    assert.deepEqual(moved.session.getState().acceptedSnapshot, NEW_CODE);
  });

  it('still reads a running turn with no build id as cancelled', async () => {
    // A chat turn, or a build never admitted: both ended with their page.
    const { session, asked } = createSession();
    const plain = project();
    plain.transcript = plain.transcript.map((t) => {
      const { serverRunId: _dropped, ...rest } = t;
      return rest;
    });
    await session.restore(plain);
    assert.equal(session.getState().running, false);
    assert.equal(session.getState().transcript.at(-1)?.status, 'cancelled');
    assert.deepEqual(asked, []);
  });
});
