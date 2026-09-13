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

describe('BuilderSession progress', () => {
  /**
   * A provider that reports progress and then waits, so a run can be
   * inspected mid-flight -- which is the only moment progress exists.
   */
  function reportingProvider(
    onProgress:
      | ((progress: { characters: number; elapsedMs: number }) => void)
      | undefined,
    signal: AbortSignal,
  ) {
    let reported!: () => void;
    const running = new Promise<void>((resolve) => {
      reported = resolve;
    });
    return {
      running,
      provider: {
        id: 'reporting',
        generate: () =>
          new Promise<never>((_resolve, reject) => {
            onProgress?.({ characters: 4_096, elapsedMs: 12_000 });
            reported();
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      },
    };
  }

  it('surfaces what the model has written while the run is still going', async () => {
    let handle!: ReturnType<typeof reportingProvider>;
    const session = createSession({
      resolveProvider: async (_plan, signal, onProgress) => {
        handle = reportingProvider(onProgress, signal);
        return handle.provider;
      },
    });

    const run = session.submit('A landing page for a coffee roaster');
    await handle.running;

    assert.deepEqual(session.getState().progress, {
      characters: 4_096,
      elapsedMs: 12_000,
    });

    session.cancel();
    await run;
  });

  it('clears progress when the run ends, however it ends', async () => {
    // A stale counter left on screen after the run is over reads as a run
    // that is still going, which is the failure this whole thing fixes.
    let handle!: ReturnType<typeof reportingProvider>;
    const cancelled = createSession({
      resolveProvider: async (_plan, signal, onProgress) => {
        handle = reportingProvider(onProgress, signal);
        return handle.provider;
      },
    });
    const run = cancelled.submit('A landing page for a coffee roaster');
    await handle.running;
    cancelled.cancel();
    await run;
    assert.equal(cancelled.getState().status, 'cancelled');
    assert.equal(cancelled.getState().progress, null);

    const failed = createSession({
      resolveProvider: async (_plan, _signal, onProgress) => {
        onProgress?.({ characters: 12, elapsedMs: 30 });
        return {
          id: 'failing',
          generate: async () => {
            throw new Error('the model declined this request');
          },
        };
      },
    });
    await failed.submit('A landing page for a coffee roaster');
    assert.equal(failed.getState().status, 'failed');
    assert.equal(failed.getState().progress, null);

    const accepted = createSession({
      resolveProvider: async (plan, _signal, onProgress) => {
        onProgress?.({ characters: 12, elapsedMs: 30 });
        return new FakeModelProvider([plan]);
      },
    });
    await accepted.submit('A landing page for a coffee roaster');
    assert.equal(accepted.getState().status, 'accepted');
    assert.equal(accepted.getState().progress, null);
  });

  it('ignores progress from a run that was already abandoned', async () => {
    // The stream from a cancelled run is not closed synchronously. A late
    // callback must not repaint a finished screen as busy.
    let late!: (progress: { characters: number; elapsedMs: number }) => void;
    let handle!: ReturnType<typeof reportingProvider>;
    const session = createSession({
      resolveProvider: async (_plan, signal, onProgress) => {
        late = onProgress!;
        handle = reportingProvider(onProgress, signal);
        return handle.provider;
      },
    });

    const run = session.submit('A landing page for a coffee roaster');
    await handle.running;
    session.cancel();
    await run;

    late({ characters: 99_999, elapsedMs: 600_000 });
    assert.equal(session.getState().progress, null);
    assert.equal(session.getState().status, 'cancelled');
  });
});

describe('BuilderSession transcript', () => {
  it('keeps every turn rather than letting each run replace the last', async () => {
    const session = createSession();
    await session.submit('A landing page for a coffee roaster');
    await session.submit('Add a testimonials section');

    const { transcript } = session.getState();
    assert.equal(transcript.length, 2);
    assert.deepEqual(
      transcript.map((turn) => turn.prompt),
      ['A landing page for a coffee roaster', 'Add a testimonials section'],
    );
    assert.deepEqual(
      transcript.map((turn) => turn.status),
      ['accepted', 'accepted'],
    );
  });

  it('records what an accepted turn produced', async () => {
    const session = createSession();
    await session.submit('A landing page for a coffee roaster');

    const turn = session.getState().transcript.at(-1)!;
    assert.equal(turn.status, 'accepted');
    assert.ok(turn.summary, 'the reply is the plan summary');
    assert.ok(turn.fileCount > 0);
    assert.equal(turn.revision, session.getState().acceptedSnapshot?.revision);
    assert.equal(turn.providerId, 'fake');
  });

  it('records a failed turn with the problem that caused it', async () => {
    const session = createSession({
      resolveProvider: async () => ({
        id: 'failing',
        generate: async () => {
          throw new Error('the model declined this request');
        },
      }),
    });
    await session.submit('A landing page for a coffee roaster');

    const turn = session.getState().transcript.at(-1)!;
    assert.equal(turn.status, 'failed');
    assert.match(String(turn.problem), /declined/);
  });

  it('records a prompt that never ran because the budget was spent', async () => {
    // The prompt was still made. Dropping it from the conversation would
    // leave the reason for the refusal detached from what was refused.
    const session = createSession({ budget: { modelOutputTokens: 10 } });
    await session.submit('A landing page for a coffee roaster');

    const turn = session.getState().transcript.at(-1)!;
    assert.equal(turn.status, 'failed');
    assert.match(String(turn.problem), /Run budget exceeded/);
  });

  it('closes a cancelled turn as cancelled, not as a failure', async () => {
    let handle!: ReturnType<typeof hangingProvider>;
    const session = createSession({
      resolveProvider: async (_plan, signal) => {
        handle = hangingProvider(signal);
        return handle.provider;
      },
    });

    const run = session.submit('A landing page for a coffee roaster');
    await handle.running;
    assert.equal(session.getState().transcript.at(-1)?.status, 'running');

    session.cancel();
    await run;

    const turn = session.getState().transcript.at(-1)!;
    assert.equal(turn.status, 'cancelled');
    assert.equal(turn.problem, null, 'a cancellation is not a problem');
  });

  it('does not let an abandoned run rewrite a closed turn', async () => {
    // The abandoned run keeps unwinding after cancel(). Without the guard in
    // #closeTurn its AbortError would land on the cancelled turn and present
    // itself as an error the user has to interpret.
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

    assert.equal(session.getState().transcript.length, 1);
    assert.equal(session.getState().transcript[0]?.status, 'cancelled');
  });

  it('starts over with an empty conversation', async () => {
    const session = createSession();
    await session.submit('A landing page for a coffee roaster');
    session.reset();
    assert.deepEqual(session.getState().transcript, []);
  });

  it('gives every turn a distinct id, including across a reset', async () => {
    // React keys off these. Reused ids would make the list reorder wrongly.
    const session = createSession();
    await session.submit('A landing page for a coffee roaster');
    await session.submit('Add a testimonials section');
    const before = session.getState().transcript.map((turn) => turn.id);
    assert.equal(new Set(before).size, before.length);

    session.reset();
    await session.submit('A shop for a bakery');
    assert.equal(session.getState().transcript.length, 1);
  });
});

describe('BuilderSession standing instructions', () => {
  it('sends them to the provider on every run', async () => {
    const seen: (string | null | undefined)[] = [];
    const session = createSession({
      resolveProvider: async (
        plan,
        _signal,
        _onProgress,
        _style,
        knowledge,
      ) => {
        seen.push(knowledge);
        return new FakeModelProvider([plan]);
      },
    });

    session.setKnowledge('Keep it dark. No rounded corners.');
    await session.submit('A landing page for a coffee roaster');
    await session.submit('Add a testimonials section');

    assert.deepEqual(seen, [
      'Keep it dark. No rounded corners.',
      'Keep it dark. No rounded corners.',
    ]);
  });

  it('survives starting over', async () => {
    // They are how someone wants things built, not part of the thing that was
    // built. Clearing them would make "start over" quietly discard a
    // preference that was never on screen.
    const session = createSession();
    session.setKnowledge('Always include a privacy link.');
    await session.submit('A landing page for a coffee roaster');

    session.reset();
    assert.equal(session.getState().transcript.length, 0);
    assert.equal(
      session.getState().knowledge,
      'Always include a privacy link.',
    );
  });

  it('charges the ledger for what it sends', async () => {
    // They go with every request, so a run that carries them costs more than
    // one that does not. Counting only the typed prompt under-reported it.
    const withNone = createSession();
    await withNone.submit('A landing page for a coffee roaster');

    const withSome = createSession();
    withSome.setKnowledge('x'.repeat(400));
    await withSome.submit('A landing page for a coffee roaster');

    assert.ok(
      withSome.getState().budget.used.modelInputTokens >
        withNone.getState().budget.used.modelInputTokens,
    );
  });

  it('ignores a set that changes nothing', () => {
    let notifications = 0;
    const session = createSession();
    session.subscribe(() => (notifications += 1));
    session.setKnowledge('Keep it dark.');
    session.setKnowledge('Keep it dark.');
    assert.equal(notifications, 1);
  });
});

describe('BuilderSession model choice', () => {
  it('sends the chosen model to the provider', async () => {
    const seen: (string | null | undefined)[] = [];
    const session = createSession({
      resolveProvider: async (plan, _s, _p, _style, _knowledge, model) => {
        seen.push(model);
        return new FakeModelProvider([plan]);
      },
    });

    session.setModel('deepseek-v4-pro');
    await session.submit('A landing page for a coffee roaster');
    assert.deepEqual(seen, ['deepseek-v4-pro']);
  });

  it('survives starting over, like the other preferences', () => {
    const session = createSession();
    session.setModel('deepseek-v4-flash');
    session.reset();
    // A model chosen for a reason should not silently revert to the
    // deployment default when the project is discarded.
    assert.equal(session.getState().model, 'deepseek-v4-flash');
  });

  it('ignores a set that changes nothing', () => {
    let notifications = 0;
    const session = createSession();
    session.subscribe(() => (notifications += 1));
    session.setModel('deepseek-v4-pro');
    session.setModel('deepseek-v4-pro');
    assert.equal(notifications, 1);
  });
});

describe('what the deployment can serve survives a reset', () => {
  it('keeps the model list, so the picker does not vanish', () => {
    // The list comes from a probe that runs once a page load. Clearing it on
    // reset would hide the picker until the user reloaded.
    const session = createSession();
    session.setModels([
      {
        id: 'claude-opus-5',
        label: 'Claude Opus 5',
        note: 'n',
        provider: 'anthropic',
      },
      {
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        note: 'n',
        provider: 'deepseek',
      },
    ]);
    session.reset();
    assert.equal(session.getState().models.length, 2);
  });

  it('keeps isAdmin, the same probe-once reasoning', () => {
    const session = createSession();
    assert.equal(session.getState().isAdmin, false);
    session.setIsAdmin(true);
    session.reset();
    assert.equal(session.getState().isAdmin, true);
  });
});
