import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';
import { BuilderSession } from '../src/generation/session.ts';
import type { BuilderState } from '../src/generation/session.ts';

function createSession(
  overrides: Partial<ConstructorParameters<typeof BuilderSession>[0]> = {},
) {
  let tick = 0;
  return new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    // Pin the provider rather than letting the default probe /api/config:
    // a test must not depend on a network call failing.
    resolveProvider: async (plan) => new FakeModelProvider([plan]),
    ...overrides,
  });
}

function record(session: BuilderSession): BuilderState[] {
  const seen: BuilderState[] = [];
  session.subscribe(() => seen.push(session.getState()));
  return seen;
}

describe('BuilderSession', () => {
  it('starts empty', () => {
    const state = createSession().getState();
    assert.equal(state.status, 'idle');
    assert.equal(state.running, false);
    assert.deepEqual(state.stagedFiles, []);
    assert.equal(state.acceptedSnapshot, null);
  });

  it('runs prompt to accepted checkpoint through every lifecycle stage', async () => {
    const session = createSession();
    const seen = record(session);

    await session.submit(
      'A cybersecurity SaaS landing page with pricing and an FAQ',
    );

    const statuses = seen.map((state) => state.status);
    assert.deepEqual(
      [...new Set(statuses)],
      ['planning', 'staging', 'validating', 'accepted'],
      'lifecycle must be visible in order',
    );

    const final = session.getState();
    assert.equal(final.running, false);
    assert.equal(final.runCount, 1);
    assert.ok(final.planSummary?.includes('React + TypeScript + Vite'));
    assert.ok(final.acceptedSnapshot);
    assert.match(final.acceptedSnapshot!.revision, /^r[0-9a-f]{8}$/);
    assert.ok(
      final.acceptedSnapshot!.files.some((file) => file.path === 'src/App.tsx'),
    );
    assert.deepEqual(final.problems, []);
    assert.ok(final.budget.used.modelOutputTokens > 0);
  });

  it('is deterministic across sessions', async () => {
    const first = createSession();
    const second = createSession();
    await first.submit('marketing page with pricing');
    await second.submit('marketing page with pricing');

    assert.deepEqual(
      first.getState().acceptedSnapshot,
      second.getState().acceptedSnapshot,
    );
  });

  it('keeps the accepted checkpoint when a later run fails validation', async () => {
    const session = createSession();
    await session.submit('a landing page with pricing');
    const accepted = session.getState().acceptedSnapshot;
    assert.ok(accepted);

    await session.submit('another landing page', 'fail-validation');

    const state = session.getState();
    assert.equal(state.status, 'failed');
    assert.equal(state.running, false);
    assert.deepEqual(
      state.acceptedSnapshot,
      accepted,
      'previous checkpoint must survive',
    );
    assert.ok(
      state.problems.some((problem) =>
        problem.includes('escapes the project root'),
      ),
    );
    assert.equal(state.runCount, 2);
  });

  it('promotes a second successful run over the first', async () => {
    const session = createSession();
    await session.submit('first page with pricing');
    const first = session.getState().acceptedSnapshot!.revision;

    await session.submit('second page with testimonials and an faq');
    const second = session.getState();

    assert.equal(second.status, 'accepted');
    assert.notEqual(second.acceptedSnapshot!.revision, first);
    assert.ok(
      second.acceptedSnapshot!.files.some((file) => file.path.includes('Faq')),
    );
  });

  it('ignores blank prompts and concurrent submissions', async () => {
    const session = createSession();
    await session.submit('   ');
    assert.equal(session.getState().status, 'idle');

    const first = session.submit('a page with pricing');
    await session.submit('a competing prompt');
    await first;

    const state = session.getState();
    assert.equal(state.runCount, 1);
    assert.equal(state.prompt, 'a page with pricing');
  });

  it('drops results from a run abandoned by reset', async () => {
    const session = createSession();
    const pending = session.submit('a page with pricing');
    session.reset();
    await pending;

    const state = session.getState();
    assert.equal(state.status, 'idle');
    assert.equal(state.running, false);
    assert.equal(state.acceptedSnapshot, null);
    assert.deepEqual(state.timeline, []);
    assert.equal(state.runCount, 0);
  });

  it('drops results and stops notifying after dispose', async () => {
    const session = createSession();
    const seen = record(session);
    const pending = session.submit('a page with pricing');
    session.dispose();
    await pending;

    const after = seen.length;
    await session.submit('another page');
    assert.equal(seen.length, after, 'no listener may be called after dispose');
    assert.equal(session.getState().acceptedSnapshot, null);
  });

  it('reports a run budget failure instead of throwing', async () => {
    const session = createSession({ budget: { modelOutputTokens: 10 } });
    await session.submit('a page with pricing');

    const state = session.getState();
    assert.equal(state.status, 'failed');
    assert.equal(state.running, false);
    assert.ok(
      state.problems.some((problem) => problem.includes('Run budget exceeded')),
    );
  });
});

/**
 * A provider that never finishes on its own. `generate` settles only when the
 * signal aborts, which is exactly the shape of a real run waiting on a model.
 */
function hangingProvider(signal: AbortSignal) {
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  return {
    running,
    provider: {
      id: 'hanging',
      generate: () =>
        new Promise<never>((_resolve, reject) => {
          started();
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    },
  };
}

describe('BuilderSession cancellation', () => {
  it('aborts the provider signal and reports the run as cancelled', async () => {
    let handle!: ReturnType<typeof hangingProvider>;
    const session = createSession({
      resolveProvider: async (_plan, signal) => {
        handle = hangingProvider(signal);
        return handle.provider;
      },
    });

    const run = session.submit('A landing page for a coffee roaster');
    await handle.running;

    session.cancel();
    await run;

    const state = session.getState();
    assert.equal(state.status, 'cancelled');
    assert.equal(state.running, false);
    assert.deepEqual(state.problems, [], 'a cancellation is not a failure');
    assert.ok(
      state.timeline.some((entry) => entry.message.includes('cancelled')),
    );
  });

  it('does not let the abandoned run write its failure over the cancellation', async () => {
    let handle!: ReturnType<typeof hangingProvider>;
    const session = createSession({
      resolveProvider: async (_plan, signal) => {
        handle = hangingProvider(signal);
        return handle.provider;
      },
    });

    const run = session.submit('A landing page for a coffee roaster');
    await handle.running;
    session.cancel();
    await run;

    const state = session.getState();
    assert.equal(state.status, 'cancelled');
    assert.equal(
      state.acceptedSnapshot,
      null,
      'an abandoned run must not promote a checkpoint',
    );
    assert.ok(
      state.timeline.every((entry) => entry.level !== 'error'),
      'the abort must not surface as an error the user has to read',
    );
  });

  it('keeps the accepted checkpoint from an earlier run', async () => {
    // The first run uses the fake and accepts; the second hangs, so
    // cancelling it is the only way out. The point is that the checkpoint the
    // user already has survives the second run being abandoned.
    let runs = 0;
    let hanging!: ReturnType<typeof hangingProvider>;
    const session = createSession({
      resolveProvider: async (plan, signal) => {
        runs += 1;
        if (runs === 1) return new FakeModelProvider([plan]);
        hanging = hangingProvider(signal);
        return hanging.provider;
      },
    });

    await session.submit('A landing page for a coffee roaster');
    const accepted = session.getState().acceptedSnapshot;
    assert.ok(accepted);

    const run = session.submit('Add a testimonials section');
    await hanging.running;
    session.cancel();
    await run;

    const state = session.getState();
    assert.equal(state.status, 'cancelled');
    assert.deepEqual(
      state.acceptedSnapshot,
      accepted,
      'an abandoned run must leave the previous checkpoint standing',
    );
  });

  it('ignores cancel when no run is in flight', () => {
    const session = createSession();
    session.cancel();
    assert.equal(session.getState().status, 'idle');
  });
});
