import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';
import { BuilderSession } from '../src/generation/session.ts';
import type { ParsedMockup } from '@vibld/ai/mockup-schema';

/**
 * The session's own end of asking for directions (#185).
 *
 * This file exists because it did not, which is the whole explanation for
 * two of the third round's findings (#189 review). `explore`, `chooseMockup`
 * and `discardMockups` were covered only through `PromptPanel`, so every
 * rule about what a *session* does with a set -- what a build does to one,
 * what Start over does to a run in flight -- had nothing asserting it. Both
 * bugs lived in exactly that gap.
 */

interface Handle {
  /** Resolves once the look has actually started. */
  started: Promise<void>;
  /** Resolves once the signal it was given was aborted. */
  aborted: Promise<void>;
  /** Hand the look its answer. */
  finish: (mockups: ParsedMockup[]) => void;
}

function mockup(overrides: Partial<ParsedMockup> = {}): ParsedMockup {
  return {
    label: 'Quiet editorial',
    rationale: 'Serif headings, generous measure.',
    html: '<!doctype html><h1>Bakery</h1>',
    ...overrides,
  };
}

/** A look that hangs until the test says otherwise, and reports its abort. */
function hangingLook(): {
  impl: () => Promise<ParsedMockup[]>;
  handle: Handle;
} {
  let announceStart!: () => void;
  let announceAbort!: () => void;
  let settle!: (mockups: ParsedMockup[]) => void;
  const started = new Promise<void>((resolve) => (announceStart = resolve));
  const aborted = new Promise<void>((resolve) => (announceAbort = resolve));

  const impl = ((options: { signal?: AbortSignal }) => {
    announceStart();
    return new Promise<ParsedMockup[]>((resolve, reject) => {
      settle = resolve;
      options.signal?.addEventListener('abort', () => {
        announceAbort();
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }) as unknown as () => Promise<ParsedMockup[]>;

  return {
    impl,
    handle: { started, aborted, finish: (mockups) => settle(mockups) },
  };
}

function createSession(
  overrides: Partial<ConstructorParameters<typeof BuilderSession>[0]> = {},
) {
  let tick = 0;
  return new BuilderSession({
    delay: async () => {},
    now: () => (tick += 1),
    stageDelayMs: 0,
    resolveProvider: async (plan) => new FakeModelProvider([plan]),
    ...overrides,
  });
}

describe('asking a session for directions', () => {
  it('offers the set the run produced', async () => {
    const session = createSession({
      requestMockupsImpl: (async () => [
        mockup(),
        mockup({ label: 'Bold poster' }),
      ]) as never,
    });
    await session.explore('a bakery');
    assert.equal(session.getState().mockups.length, 2);
    assert.equal(session.getState().exploring, false);
  });

  it('builds the direction that was picked, from its own request', async () => {
    const asked: unknown[] = [];
    const session = createSession({
      requestMockupsImpl: (async () => [mockup()]) as never,
      resolveProvider: async (plan, _signal, ...rest) => {
        asked.push(rest[rest.length - 1]);
        return new FakeModelProvider([plan]);
      },
    });
    await session.explore('a bakery', null, 'https://example.com/');
    session.chooseMockup(session.getState().mockups[0]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(asked, [
      { label: 'Quiet editorial', html: '<!doctype html><h1>Bakery</h1>' },
    ]);
  });
});

/**
 * What a build does to a set that is still on screen (#189 review).
 *
 * The chooser is disabled while a build runs, so this only bites after that
 * build is accepted: the tiles come back enabled, and a click then submits
 * the request they were drawn from -- one taken *before* the project
 * existed -- as a follow-up against the project that now does. Another full
 * build, for a prompt nobody typed twice.
 */
describe('a build invalidates the directions it did not choose', () => {
  it('clears a set when an ordinary build is started instead', async () => {
    const session = createSession({
      requestMockupsImpl: (async () => [mockup(), mockup()]) as never,
    });
    await session.explore('a bakery');
    assert.equal(session.getState().mockups.length, 2, 'set should be offered');

    await session.submit('a bakery with a shop');

    assert.deepEqual(
      session.getState().mockups,
      [],
      'directions survived a build that did not choose one',
    );
  });

  it('refuses to build a stale direction after that', async () => {
    let builds = 0;
    const session = createSession({
      requestMockupsImpl: (async () => [mockup()]) as never,
      resolveProvider: async (plan) => {
        builds += 1;
        return new FakeModelProvider([plan]);
      },
    });
    await session.explore('a bakery');
    const stale = session.getState().mockups[0]!;

    await session.submit('a bakery with a shop');
    const after = builds;

    // The tile the reader can still be looking at, clicked once the build
    // has finished and the chooser is enabled again.
    session.chooseMockup(stale);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(builds, after, 'a stale direction started a build');
  });
});

/**
 * Start over, while a look is in flight (#189 review).
 *
 * Reachable in practice rather than in theory: after a first build that
 * failed, both Start over and the directions button are offered, which is
 * exactly the state the previous round's gate fix restored.
 */
describe('resetting a session that is still looking', () => {
  it('aborts the run rather than discarding its answer', async () => {
    const { impl, handle } = hangingLook();
    const session = createSession({ requestMockupsImpl: impl as never });

    const look = session.explore('a bakery');
    await handle.started;

    session.reset();
    await handle.aborted;
    await look;

    assert.equal(session.getState().exploring, false);
    assert.deepEqual(session.getState().mockups, []);
  });

  it('leaves a later look its own way out', async () => {
    // The second half of the finding: `explore` used to clear the shared
    // controller whenever *any* run settled, so the abandoned one landing
    // after a new look had begun took the new look's controller with it.
    // Cancel then had nothing to abort, and a billed run had no way to stop.
    const first = hangingLook();
    const second = hangingLook();
    let call = 0;
    const session = createSession({
      requestMockupsImpl: ((options: { signal?: AbortSignal }) =>
        (call++ === 0
          ? (first.impl as unknown as (o: unknown) => Promise<ParsedMockup[]>)
          : (second.impl as unknown as (
              o: unknown,
            ) => Promise<ParsedMockup[]>))(options)) as unknown as never,
    });

    const abandoned = session.explore('a bakery');
    await first.handle.started;

    // Deliberately not awaited between these two lines. The bug is a race,
    // and the first version of this test awaited the abandoned run here --
    // which let it settle *before* the second look existed, so there was no
    // controller of anyone else's for it to clear and the test passed
    // against the bug. Starting the second look in the same task is what
    // puts the abandoned settlement after it.
    session.reset();
    const current = session.explore('a bakery, second try');
    await second.handle.started;

    session.cancelExplore();

    // Raced against a timer rather than awaited outright: if the controller
    // was lost, nothing ever aborts and a bare await would hang the suite
    // instead of failing it. A test that hangs reports nothing.
    const stopped = await Promise.race([
      second.handle.aborted.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    assert.ok(stopped, 'an abandoned look took the new look’s controller');

    await Promise.allSettled([abandoned, current]);
  });
});
