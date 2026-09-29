import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ModelProvider, TranscriptTurn } from '@vibld/core';

import {
  CHECK_FAILED,
  CHECK_UNFINISHED,
  checkAfter,
  checkWords,
} from '../src/generation/build-check.ts';
import { RemoteModelProvider } from '../src/generation/remote-provider.ts';
import { fetchBuild } from '../src/generation/runs-client.ts';
import type { BuildAnswer } from '../src/generation/runs-client.ts';
import {
  BuilderSession,
  CHECK_NOT_STOPPED,
} from '../src/generation/session.ts';
import type { RestoredProject } from '../src/generation/session.ts';

/**
 * Show early, badge it (docs/decisions.md, D69), on the builder's side:
 * the code a build has promoted is shown with a badge while its check
 * runs, streamed or asked after; the badge goes when the check passes,
 * says a repair is running while one is, and the repaired code replaces
 * the first; and code that does not build is kept and said plainly not to,
 * on screen and in the conversation.
 */

const RUN = 'wf-69';

/** A project the builder's own validator accepts, headed `heading`. */
function projectFiles(heading: string) {
  return [
    { path: 'package.json', content: '{"name":"bakery","private":true}' },
    { path: 'index.html', content: '<div id="root"></div>' },
    { path: 'src/main.tsx', content: "import './App.tsx';" },
    {
      path: 'src/App.tsx',
      content: `export const App = () => <h1>${heading}</h1>;`,
    },
  ];
}

const OLD = { revision: 'r-old', files: projectFiles('Old') };
const FIRST = { revision: 'r-first', files: projectFiles('Bakery') };
const REPAIRED = {
  revision: 'r-repaired',
  files: projectFiles('Bakery, fixed'),
};

const encoder = new TextEncoder();

/** `/api/plan` as the Worker streams it, one frame at a time. */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const send = (event: string, data: unknown) =>
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  const fetchImpl = (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch;
  return { fetchImpl, send, close: () => controller.close() };
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !done(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(done(), 'the session never got there');
}

function createSession(
  options: {
    fetchImpl?: typeof fetch;
    answers?: BuildAnswer[];
    stop?: BuildAnswer;
  } = {},
) {
  const asked: { runId: string; known: string | null | undefined }[] = [];
  const answers = [...(options.answers ?? [])];
  let tick = 1_000;
  const session = new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    pollDelay: () => new Promise((resolve) => setTimeout(resolve, 0)),
    fetchBuildImpl: async (runId, known) => {
      asked.push({ runId, known });
      return (
        answers.shift() ?? {
          ok: true,
          run: { id: runId, state: 'running', startedAt: '' },
          snapshot: null,
        }
      );
    },
    stopBuildImpl: async (runId) =>
      options.stop ?? {
        ok: true,
        run: { id: runId, state: 'cancelled', startedAt: '' },
        snapshot: null,
      },
    resolveProvider: async (
      _plan,
      signal,
      onProgress,
      _style,
      _knowledge,
      _model,
      _referenceUrl,
      _styleDna,
      _mockup,
      projectId,
      onRun,
      checks,
    ): Promise<ModelProvider> =>
      new RemoteModelProvider({
        signal,
        fetchImpl: options.fetchImpl ?? controlledStream().fetchImpl,
        getToken: async () => null,
        ...(projectId ? { projectId } : {}),
        ...(onRun ? { onRun } : {}),
        ...(onProgress ? { onProgress } : {}),
        ...(checks ? { onEarly: checks.onEarly, onCheck: checks.onCheck } : {}),
      }),
  });
  return { session, asked };
}

/** A streamed build up to the point its code is shown and being checked. */
async function shownEarly(stream: ReturnType<typeof controlledStream>) {
  const { session } = createSession({ fetchImpl: stream.fetchImpl });
  const done = session.submit('A bakery');
  stream.send('run', { runId: RUN });
  stream.send('progress', { elapsedMs: 10, phase: 'writing' });
  stream.send('progress', {
    elapsedMs: 20,
    phase: 'assembling',
    early: FIRST,
  });
  await until(() => session.getState().early !== null);
  return { session, done };
}

describe('a streamed build shown before its check ends', () => {
  it('shows the code with a badge, and clears it when the check passes', async () => {
    const stream = controlledStream();
    const { session, done } = await shownEarly(stream);

    let state = session.getState();
    assert.equal(state.running, true, 'the build is still going');
    assert.deepEqual(state.early, FIRST);
    assert.deepEqual(state.stagedFiles, FIRST.files);
    assert.deepEqual(state.check, {
      state: 'checking',
      revision: FIRST.revision,
    });
    assert.equal(
      state.acceptedSnapshot,
      null,
      'the last finished checkpoint moved before the build ended',
    );
    // The turn stays open: the summary lands when the run settles.
    assert.equal(state.transcript.at(-1)?.status, 'running');
    assert.equal(state.transcript.at(-1)?.summary, null);

    stream.send('progress', { elapsedMs: 30, phase: 'validating' });
    await until(() => session.getState().progress?.phase === 'validating');
    assert.equal(session.getState().check?.state, 'checking');

    stream.send('plan', {
      plan: { summary: 'A bakery site.', files: FIRST.files },
      revision: FIRST.revision,
      check: 'passed',
    });
    stream.close();
    await done;

    state = session.getState();
    assert.equal(state.status, 'accepted');
    assert.equal(state.check, null, 'the badge stayed after the check passed');
    assert.equal(state.early, null);
    assert.deepEqual(state.acceptedSnapshot?.files, FIRST.files);
    const turn = state.transcript.at(-1);
    assert.equal(turn?.status, 'accepted');
    assert.equal(turn?.summary, 'A bakery site.');
    assert.equal(turn?.problem, null);
    assert.deepEqual(state.problems, []);
  });

  it('says a repair is running, then shows the repaired code', async () => {
    const stream = controlledStream();
    const { session, done } = await shownEarly(stream);

    stream.send('progress', { elapsedMs: 30, phase: 'repairing' });
    await until(() => session.getState().check?.state === 'repairing');
    assert.deepEqual(session.getState().early, FIRST);

    // The repair promoted: its code replaces the first, still badged.
    stream.send('progress', {
      elapsedMs: 40,
      phase: 'repairing',
      early: REPAIRED,
    });
    await until(() => session.getState().early?.revision === REPAIRED.revision);
    assert.deepEqual(session.getState().stagedFiles, REPAIRED.files);
    assert.equal(session.getState().check?.state, 'repairing');

    stream.send('plan', {
      plan: { summary: 'A bakery site.', files: REPAIRED.files },
      revision: REPAIRED.revision,
      check: 'passed',
    });
    stream.close();
    await done;
    const state = session.getState();
    assert.equal(state.check, null);
    assert.deepEqual(state.acceptedSnapshot?.files, REPAIRED.files);
  });

  it('keeps code that does not build, and says so plainly', async () => {
    const stream = controlledStream();
    const { session, done } = await shownEarly(stream);
    stream.send('plan', {
      plan: { summary: 'A bakery site.', files: FIRST.files },
      revision: FIRST.revision,
      check: 'failed',
    });
    stream.close();
    await done;

    const state = session.getState();
    // Today's accepted revision: the code the build ended at stays the
    // project's, as the store has it.
    assert.equal(state.status, 'accepted');
    assert.deepEqual(state.acceptedSnapshot?.files, FIRST.files);
    assert.equal(state.check?.state, 'failed');
    assert.deepEqual(state.problems, [CHECK_FAILED]);
    const turn = state.transcript.at(-1);
    assert.equal(turn?.status, 'accepted');
    assert.equal(turn?.problem, CHECK_FAILED);
    assert.ok(
      state.timeline.some(
        (entry) => entry.level === 'warn' && entry.message === CHECK_FAILED,
      ),
    );
  });

  it('says a build stopped before its check ended was not checked', async () => {
    const stream = controlledStream();
    const { session, done } = await shownEarly(stream);
    stream.send('plan', {
      plan: { summary: '', files: FIRST.files },
      revision: FIRST.revision,
      check: 'unchecked',
    });
    stream.close();
    await done;
    const state = session.getState();
    assert.equal(state.check?.state, 'unchecked');
    assert.equal(state.transcript.at(-1)?.problem, CHECK_UNFINISHED);
    assert.deepEqual(state.problems, [], 'not checked is not a problem found');
  });

  it('takes the code off screen for a build that then fails', async () => {
    const stream = controlledStream();
    const { session, done } = await shownEarly(stream);
    stream.send('error', { error: 'Generation failed unexpectedly.' });
    stream.close();
    await done;
    const state = session.getState();
    assert.equal(state.status, 'failed');
    assert.equal(state.early, null);
    assert.equal(state.check, null);
    assert.deepEqual(state.stagedFiles, []);
  });

  it('tells the agent a kept build does not build', async () => {
    const stream = controlledStream();
    const { session, done } = await shownEarly(stream);
    stream.send('plan', {
      plan: { summary: 'A bakery site.', files: FIRST.files },
      revision: FIRST.revision,
      check: 'failed',
    });
    stream.close();
    await done;
    const said: string[] = [];
    // The conversation the agent is sent is private; read it the way
    // `send` passes it on.
    const probe = new BuilderSession({
      requestChatTurnImpl: async (request) => {
        said.push(...request.messages.map((message) => message.text));
        return { ok: false, error: { kind: 'aborted', message: '' } };
      },
    });
    await probe.restore({
      id: 'p',
      transcript: session.getState().transcript as TranscriptTurn[],
      snapshot: FIRST,
      style: null,
      referenceUrl: '',
      model: null,
      knowledge: '',
      styleDna: {},
    });
    probe.setGeneration('model');
    await probe.send('Why is it broken?');
    assert.ok(
      said.some((text) => text.includes(CHECK_FAILED)),
      'the agent was told the build worked',
    );
  });
});

describe('Stop while a build is being checked', () => {
  it('says there is nothing left to stop, and keeps showing the check', async () => {
    const stream = controlledStream();
    const { session } = createSession({
      fetchImpl: stream.fetchImpl,
      stop: {
        ok: true,
        run: {
          id: RUN,
          state: 'running',
          startedAt: '',
          checking: { revision: FIRST.revision },
        },
        snapshot: null,
      },
    });
    void session.submit('A bakery');
    stream.send('run', { runId: RUN });
    stream.send('progress', {
      elapsedMs: 20,
      phase: 'validating',
      early: FIRST,
    });
    await until(() => session.getState().early !== null);

    await session.cancel();
    const state = session.getState();
    assert.equal(state.running, true);
    assert.equal(state.notice, CHECK_NOT_STOPPED);
    assert.equal(state.check?.state, 'checking');
    session.dispose();
  });
});

function project(over: Partial<RestoredProject> = {}): RestoredProject {
  return {
    id: 'project-1',
    transcript: [
      {
        id: 1,
        runId: 'run-1',
        prompt: 'A bakery',
        at: 1,
        status: 'running',
        agentMessage: null,
        summary: null,
        fileCount: 0,
        revision: null,
        problem: null,
        providerId: null,
        serverRunId: RUN,
      },
    ],
    // What `GET /api/projects/:id` hands a project whose build is being
    // checked: the accepted revision, which is the one being checked.
    snapshot: FIRST,
    style: null,
    referenceUrl: '',
    model: null,
    knowledge: '',
    styleDna: {},
    build: { runId: RUN, startedAt: '2026-09-29T12:00:00Z' },
    ...over,
  };
}

const running = (
  over: Partial<Extract<BuildAnswer, { ok: true }>['run']> = {},
  snapshot: typeof FIRST | null = null,
): BuildAnswer => ({
  ok: true,
  run: {
    id: RUN,
    state: 'running',
    startedAt: '2026-09-29T12:00:00Z',
    ...over,
  },
  snapshot,
});

describe('a reopened project whose build is being checked', () => {
  it('shows the code it opened with, badged, without asking for it again', async () => {
    const { session, asked } = createSession({
      answers: [
        running({
          phase: 'validating',
          checking: { revision: FIRST.revision },
        }),
      ],
    });
    await session.restore(project());
    await until(() => session.getState().check !== null);
    const state = session.getState();
    assert.equal(state.running, true);
    assert.deepEqual(state.check, {
      state: 'checking',
      revision: FIRST.revision,
    });
    assert.equal(state.early, null, 'it is already the accepted checkpoint');
    assert.deepEqual(state.acceptedSnapshot, FIRST);
    assert.equal(asked[0]?.known, FIRST.revision);
    session.dispose();
  });

  it('shows a repair the check bought, then settles with what it found', async () => {
    const { session } = createSession({
      answers: [
        running({
          phase: 'validating',
          checking: { revision: FIRST.revision },
        }),
        running(
          { phase: 'repairing', checking: { revision: REPAIRED.revision } },
          REPAIRED,
        ),
        {
          ok: true,
          run: {
            id: RUN,
            state: 'accepted',
            startedAt: '',
            revision: REPAIRED.revision,
            check: 'failed',
          },
          snapshot: REPAIRED,
        },
      ],
    });
    await session.restore(project());
    await until(() => session.getState().early?.revision === REPAIRED.revision);
    assert.equal(session.getState().check?.state, 'repairing');
    assert.deepEqual(session.getState().stagedFiles, REPAIRED.files);

    await until(() => session.getState().running === false);
    const state = session.getState();
    assert.equal(state.status, 'accepted');
    assert.deepEqual(state.acceptedSnapshot, REPAIRED);
    assert.equal(state.early, null);
    assert.deepEqual(state.check, {
      state: 'failed',
      revision: REPAIRED.revision,
    });
    assert.equal(state.transcript.at(-1)?.problem, CHECK_FAILED);
  });

  it('clears the badge for a check that passed', async () => {
    const { session } = createSession({
      answers: [
        running({
          phase: 'validating',
          checking: { revision: FIRST.revision },
        }),
        {
          ok: true,
          run: {
            id: RUN,
            state: 'accepted',
            startedAt: '',
            revision: FIRST.revision,
            check: 'passed',
          },
          snapshot: FIRST,
        },
      ],
    });
    await session.restore(project({ snapshot: OLD }));
    await until(() => session.getState().running === false);
    const state = session.getState();
    assert.equal(state.check, null);
    assert.deepEqual(state.acceptedSnapshot, FIRST);
    assert.equal(state.transcript.at(-1)?.problem, null);
  });
});

describe('the wire', () => {
  it('reads the code being checked and what the check found', async () => {
    const seen: string[] = [];
    const answer = await fetchBuild(
      RUN,
      (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(
          JSON.stringify({
            run: {
              id: RUN,
              state: 'running',
              startedAt: '',
              checking: { revision: 'r1' },
              check: 'nonsense',
            },
            snapshot: null,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
      async () => null,
      'r0',
    );
    assert.ok(answer.ok);
    assert.deepEqual(answer.run.checking, { revision: 'r1' });
    assert.equal('check' in answer.run, false, 'a verdict nobody sent');
    assert.match(seen[0]!, /\?known=r0$/);
  });

  it('ignores early code that is not the shape the Worker sends', async () => {
    const stream = controlledStream();
    const early: unknown[] = [];
    const provider = new RemoteModelProvider({
      fetchImpl: stream.fetchImpl,
      getToken: async () => null,
      onEarly: (snapshot) => early.push(snapshot),
    });
    const plan = provider.generate({ prompt: 'x' });
    stream.send('progress', {
      elapsedMs: 1,
      early: { revision: 'r1', files: [{ path: 1 }] },
    });
    stream.send('progress', { elapsedMs: 2, early: { files: [] } });
    stream.send('progress', { elapsedMs: 3, early: FIRST });
    stream.send('plan', { plan: { summary: '', files: [] } });
    stream.close();
    await plan;
    assert.deepEqual(early, [FIRST]);
  });
});

describe('the badge words', () => {
  it('names each state plainly, and nothing for code that passed', () => {
    assert.equal(checkAfter('passed', 'r1'), null);
    assert.equal(checkAfter(undefined, 'r1'), null);
    assert.deepEqual(checkAfter('failed', 'r1'), {
      state: 'failed',
      revision: 'r1',
    });
    assert.equal(
      checkWords({ state: 'checking', revision: 'r' }).label,
      'Checking the build',
    );
    assert.match(
      checkWords({ state: 'repairing', revision: 'r' }).label,
      /Fixing/,
    );
    assert.equal(
      checkWords({ state: 'failed', revision: 'r' }).detail,
      CHECK_FAILED,
    );
    assert.equal(
      checkWords({ state: 'unchecked', revision: 'r' }).detail,
      CHECK_UNFINISHED,
    );
  });
});
