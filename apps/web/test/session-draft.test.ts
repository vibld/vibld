import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';
import type { GenerationPlan, ModelProvider } from '@vibld/core';
import type { ParsedMockup } from '@vibld/ai/mockup-schema';
import { BuilderSession } from '../src/generation/session.ts';
import type { GenerationProgress } from '../src/generation/session.ts';
import type { MockupRunOptions } from '../src/generation/mockups-client.ts';
import { changedSince } from '../src/projects/project-state.ts';

/**
 * The draft a first build shows while it runs (docs/decisions.md,
 * 2026-09-28, the draft preview), from the session's side: which sketch,
 * when it is asked for, and the rule that it never costs the build
 * anything.
 */

function mockup(overrides: Partial<ParsedMockup> = {}): ParsedMockup {
  return {
    label: 'Warm bakery',
    rationale: 'Suits a neighbourhood shop.',
    html: '<!doctype html><h1>Bakery</h1>',
    ...overrides,
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A build that reports it was admitted and then waits for the test.
 *
 * The report is what the Worker sends once the build's reservation is
 * held, which is the moment the session may ask for a draft.
 */
function gatedBuild() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let admitted!: () => void;
  const reported = new Promise<void>((resolve) => (admitted = resolve));
  const resolveProvider = async (
    plan: GenerationPlan,
    _signal: AbortSignal,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<ModelProvider> => {
    const fake = new FakeModelProvider([plan]);
    return {
      id: 'remote',
      async generate(request) {
        onProgress?.({ elapsedMs: 0, stage: 'queued' });
        admitted();
        await gate;
        return fake.generate(request);
      },
    };
  };
  return { resolveProvider, release, reported };
}

/** A draft request that waits for the test, and records what it was asked. */
function gatedDraft() {
  const asked: MockupRunOptions[] = [];
  let answer!: (mockups: ParsedMockup[]) => void;
  let refuse!: (error: Error) => void;
  let aborted = false;
  const impl = (options: MockupRunOptions) => {
    asked.push(options);
    return new Promise<ParsedMockup[]>((resolve, reject) => {
      answer = resolve;
      refuse = reject;
      options.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  };
  return {
    impl,
    asked,
    answer: (mockups: ParsedMockup[]) => answer(mockups),
    refuse: (error: Error) => refuse(error),
    aborted: () => aborted,
  };
}

function createSession(
  overrides: Partial<ConstructorParameters<typeof BuilderSession>[0]> = {},
  generation: 'model' | 'fake' = 'model',
) {
  let tick = 0;
  const session = new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    resolveProvider: async (plan) => new FakeModelProvider([plan]),
    ...overrides,
  });
  session.setGeneration(generation);
  return session;
}

describe('the draft a first build shows', () => {
  it('shows the direction picked in Explore, and asks for no other', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    let looks = 0;
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: ((options: MockupRunOptions) => {
        if (options.draft) return draft.impl(options);
        looks += 1;
        return Promise.resolve([mockup(), mockup({ label: 'Bold poster' })]);
      }) as never,
    });
    await session.explore('a bakery');
    session.chooseMockup(session.getState().mockups[1]!);
    await build.reported;

    const shown = session.getState().draft;
    assert.equal(session.getState().running, true);
    assert.equal(shown?.source, 'picked');
    assert.equal(shown?.label, 'Bold poster');
    assert.equal(shown?.html, mockup().html);
    assert.equal(looks, 1);
    assert.equal(draft.asked.length, 0, 'a draft was asked for on top');

    build.release();
    await settle();
  });

  it('asks for one quick draft, once, while the build runs', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: draft.impl,
    });
    session.setModel('deepseek-flash');
    const done = session.submit('a bakery', 'succeed', 'brutalism');
    await build.reported;

    assert.equal(draft.asked.length, 1);
    assert.equal(draft.asked[0]?.draft, true);
    assert.equal(draft.asked[0]?.prompt, 'a bakery');
    assert.equal(draft.asked[0]?.style, 'brutalism');
    assert.equal(draft.asked[0]?.model, 'deepseek-flash');
    assert.equal(session.getState().running, true, 'the build waited');
    assert.equal(session.getState().draft, null, 'shown before it arrived');

    draft.answer([mockup()]);
    await settle();
    assert.equal(session.getState().draft?.source, 'quick');
    assert.equal(session.getState().draft?.label, 'Warm bakery');
    assert.equal(session.getState().running, true);

    build.release();
    await done;
    assert.equal(session.getState().status, 'accepted');
    assert.equal(draft.asked.length, 1, 'asked again');
    // Kept after acceptance: the pane shows it until the live preview runs.
    assert.equal(session.getState().draft?.label, 'Warm bakery');
  });

  it('asks only once the build has been admitted', async () => {
    // Asking earlier could take the caller's last in-flight slot and have
    // the build refused as already running.
    const draft = gatedDraft();
    let generate!: () => void;
    const started = new Promise<void>((resolve) => (generate = resolve));
    let admit!: () => void;
    const session = createSession({
      requestMockupsImpl: draft.impl,
      resolveProvider: async (plan, _signal, onProgress) => {
        const fake = new FakeModelProvider([plan]);
        return {
          id: 'remote',
          async generate(request) {
            generate();
            await new Promise<void>((resolve) => (admit = resolve));
            onProgress?.({ elapsedMs: 0, stage: 'queued' });
            onProgress?.({ elapsedMs: 1500, stage: 'running' });
            return fake.generate(request);
          },
        };
      },
    });
    const done = session.submit('a bakery');
    await started;
    assert.equal(draft.asked.length, 0, 'asked before the build was admitted');
    admit();
    await done;
    assert.equal(draft.asked.length, 1);
  });

  it('builds as it would have when the draft fails', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: draft.impl,
    });
    const done = session.submit('a bakery');
    await build.reported;
    draft.refuse(new Error('Could not produce a draft.'));
    await settle();
    assert.equal(session.getState().running, true);
    assert.deepEqual(session.getState().problems, []);

    build.release();
    await done;
    const state = session.getState();
    assert.equal(state.status, 'accepted');
    assert.deepEqual(state.problems, []);
    assert.equal(state.draft, null);
    assert.ok(
      !state.timeline.some((entry) => /draft/i.test(entry.message)),
      'the draft failure was reported as though it mattered',
    );
  });

  it('stops a draft the build finished before, and never shows it', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: draft.impl,
    });
    const done = session.submit('a bakery');
    await build.reported;
    build.release();
    await done;

    assert.equal(draft.aborted(), true, 'the draft kept spending');
    draft.answer([mockup()]);
    await settle();
    assert.equal(session.getState().draft, null);
    assert.equal(session.getState().status, 'accepted');
  });

  it('drops the draft when the build is cancelled', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: draft.impl,
    });
    void session.submit('a bakery');
    await build.reported;
    draft.answer([mockup()]);
    await settle();
    assert.ok(session.getState().draft);

    session.cancel();
    assert.equal(session.getState().draft, null);
    build.release();
    await settle();
  });

  it('drops the draft when the build fails', async () => {
    const draft = gatedDraft();
    const session = createSession({
      requestMockupsImpl: draft.impl,
      resolveProvider: async (_plan, _signal, onProgress) => ({
        id: 'remote',
        async generate() {
          onProgress?.({ elapsedMs: 0, stage: 'queued' });
          await settle();
          throw new Error('Generation failed.');
        },
      }),
    });
    const done = session.submit('a bakery');
    await settle();
    draft.answer([mockup()]);
    await done;
    assert.equal(session.getState().status, 'failed');
    assert.equal(session.getState().draft, null);
  });

  it('asks for nothing in fake mode, which /api/mockups cannot answer', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession(
      {
        resolveProvider: build.resolveProvider,
        requestMockupsImpl: draft.impl,
      },
      'fake',
    );
    const done = session.submit('a bakery');
    await build.reported;
    build.release();
    await done;
    assert.equal(draft.asked.length, 0);
    assert.equal(session.getState().status, 'accepted');
    assert.equal(session.getState().draft, null);
  });
});

describe('a follow-up build', () => {
  it('asks for no draft and shows none, keeping what was accepted', async () => {
    const draft = gatedDraft();
    const session = createSession({
      requestMockupsImpl: draft.impl,
      resolveProvider: async (plan, _signal, onProgress) => {
        const fake = new FakeModelProvider([plan]);
        return {
          id: 'remote',
          async generate(request) {
            onProgress?.({ elapsedMs: 0, stage: 'queued' });
            return fake.generate(request);
          },
        };
      },
    });
    await session.submit('a bakery');
    assert.equal(draft.asked.length, 1, 'the first build asked for none');
    const accepted = session.getState().acceptedSnapshot;
    assert.ok(accepted);

    const second = session.submit('add a contact page');
    assert.equal(session.getState().running, true);
    assert.equal(session.getState().draft, null, 'a follow-up showed a draft');
    await second;
    assert.equal(draft.asked.length, 1, 'a follow-up asked for a draft');
  });

  it('shows no picked direction either, over an accepted project', async () => {
    const session = createSession();
    await session.restore({
      id: 'p1',
      transcript: [],
      snapshot: {
        revision: 'r1',
        files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
      },
      style: null,
      referenceUrl: '',
      model: null,
      knowledge: '',
      styleDna: {},
    });
    const whileRunning: unknown[] = [];
    const unsubscribe = session.subscribe(() => {
      const state = session.getState();
      if (state.running) whileRunning.push(state.draft);
    });
    await session.submit('change the colours', 'succeed', null, null, {
      label: 'Warm',
      html: '<h1>x</h1>',
    });
    unsubscribe();
    assert.ok(whileRunning.length > 0, 'the build never ran');
    assert.ok(
      whileRunning.every((draft) => draft === null),
      'a follow-up showed a draft',
    );
  });
});

describe('what the draft is not', () => {
  it('is not saved with the project', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: draft.impl,
    });
    const done = session.submit('a bakery');
    await build.reported;
    draft.answer([mockup({ html: '<h1>only in the draft</h1>' })]);
    await settle();
    build.release();
    await done;
    assert.ok(session.getState().draft);

    // What the autosave would send: settings and the settled transcript.
    const changed = changedSince(
      { settings: '', transcript: '' },
      session.settings(),
      session.getState().transcript,
    );
    assert.ok(changed);
    assert.doesNotMatch(
      JSON.stringify(changed.patch),
      /only in the draft/,
      'the draft reached what is saved',
    );
  });

  it('does not survive opening the project again', async () => {
    const draft = gatedDraft();
    const build = gatedBuild();
    const session = createSession({
      resolveProvider: build.resolveProvider,
      requestMockupsImpl: draft.impl,
    });
    const done = session.submit('a bakery');
    await build.reported;
    draft.answer([mockup()]);
    await settle();
    build.release();
    await done;

    await session.restore({
      id: 'p1',
      transcript: session.getState().transcript,
      snapshot: session.getState().acceptedSnapshot,
      style: null,
      referenceUrl: '',
      model: null,
      knowledge: '',
      styleDna: {},
    });
    assert.equal(session.getState().draft, null);
  });
});
