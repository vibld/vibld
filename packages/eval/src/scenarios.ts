import {
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
} from '@vibld/core';
import type {
  GenerationPlan,
  ModelProvider,
  ProjectSnapshot,
} from '@vibld/core';
import { createEvalValidator } from './validator.ts';

/**
 * Injected failures.
 *
 * The success cases say the machinery works when nothing goes wrong, which is
 * the easy half. These say what happens when it does: every one asserts that
 * the run reaches a terminal state and that the checkpoint the user already
 * had is still there afterwards. Losing accepted work to a failed run is the
 * outcome that would make the product untrustworthy, so it is the thing most
 * worth proving.
 *
 * Expired grants are not here. There is no permission system to expire yet
 * (#15), and a scenario that pretends otherwise would report a pass for
 * something nobody built.
 */

export interface ScenarioResult {
  id: string;
  /** Whether the failure behaved as it must. */
  passed: boolean;
  /** What actually happened, in words, pass or fail. */
  detail: string;
  checkpointRetained: boolean;
}

export interface Scenario {
  id: string;
  description: string;
  run: () => Promise<ScenarioResult>;
}

const GOOD_PLAN: GenerationPlan = {
  summary: 'A minimal portable project',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'baseline',
          private: true,
          scripts: { dev: 'vite', build: 'vite build' },
        },
        null,
        2,
      ),
    },
    { path: 'README.md', content: '# baseline\n' },
  ],
};

/** A first run that succeeds, so later failures have something to protect. */
async function establishBaseline(
  store: InMemoryGenerationStore,
): Promise<ProjectSnapshot> {
  const runner = new DurableGenerationRunner(store);
  const result = await runner.run(
    { prompt: 'baseline', projectId: 'scenario', runId: 'baseline' },
    new FakeModelProvider([GOOD_PLAN]),
    createEvalValidator(),
  );
  if (result.state !== 'accepted' || !result.accepted) {
    throw new Error(
      'the baseline run must succeed for a scenario to mean anything',
    );
  }
  return result.accepted;
}

function sameSnapshot(
  a: ProjectSnapshot | undefined,
  b: ProjectSnapshot,
): boolean {
  return a !== undefined && a.revision === b.revision;
}

/**
 * Written with an explicit field rather than a parameter property: the
 * workspace runs TypeScript through Node's type stripping, which cannot
 * rewrite a constructor parameter into an assignment.
 */
class ThrowingProvider implements ModelProvider {
  readonly id = 'throwing';
  readonly #message: string;

  constructor(message: string) {
    this.#message = message;
  }

  generate(): Promise<GenerationPlan> {
    return Promise.reject(new Error(this.#message));
  }
}

async function failedRun(
  id: string,
  provider: ModelProvider,
  expectation: string,
): Promise<ScenarioResult> {
  const store = new InMemoryGenerationStore();
  const baseline = await establishBaseline(store);
  const runner = new DurableGenerationRunner(store);

  let terminal = false;
  let detail: string;
  try {
    const result = await runner.run(
      {
        prompt: 'a change that goes wrong',
        projectId: 'scenario',
        runId: 'bad',
      },
      provider,
      createEvalValidator(),
    );
    terminal = result.state === 'failed';
    detail = terminal
      ? `${expectation}: ${result.errors[0] ?? 'no reason given'}`
      : `expected a failed run, got ${result.state}`;
  } catch (error) {
    // A throwing provider may surface as a rejection rather than a result.
    terminal = true;
    detail = `${expectation}: ${error instanceof Error ? error.message : String(error)}`;
  }

  const current = await store.loadAccepted('scenario');
  const retained = sameSnapshot(current, baseline);
  return {
    id,
    passed: terminal && retained,
    detail: retained
      ? detail
      : `${detail} -- but the accepted checkpoint was lost`,
    checkpointRetained: retained,
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'invalid-edit',
    description: 'a staged file escapes the project root',
    run: () =>
      failedRun(
        'invalid-edit',
        new FakeModelProvider([
          {
            summary: 'writes outside the project',
            files: [
              { path: 'package.json', content: '{}' },
              { path: '../escaped.txt', content: 'nope' },
            ],
          },
        ]),
        'rejected before promotion',
      ),
  },
  {
    id: 'unportable-output',
    description: 'the generated project depends on Vibld to install',
    run: () =>
      failedRun(
        'unportable-output',
        new FakeModelProvider([
          {
            summary: 'depends on a Vibld runtime',
            files: [
              {
                path: 'package.json',
                content: JSON.stringify({
                  name: 'tied',
                  scripts: { dev: 'vite', build: 'vite build' },
                  dependencies: { '@vibld/runtime': '1.0.0' },
                }),
              },
              { path: 'README.md', content: '# tied\n' },
            ],
          },
        ]),
        'rejected as not independently installable',
      ),
  },
  {
    id: 'interrupted-run',
    description: 'the provider dies part way through',
    run: () =>
      failedRun(
        'interrupted-run',
        new ThrowingProvider(
          'the connection closed before generation finished',
        ),
        'reported as a failed run',
      ),
  },
  {
    id: 'conflicting-revision',
    description: 'another writer promotes first',
    run: async () => {
      const store = new InMemoryGenerationStore();
      const baseline = await establishBaseline(store);

      // A second writer lands a revision while the first is still working, so
      // the first is promoting against a base that no longer exists.
      const runner = new DurableGenerationRunner(store);
      await runner.run(
        { prompt: 'the other writer', projectId: 'scenario', runId: 'other' },
        new FakeModelProvider([
          {
            summary: 'a different change',
            files: [
              { path: 'package.json', content: GOOD_PLAN.files[0]!.content },
              { path: 'README.md', content: '# moved on\n' },
            ],
          },
        ]),
        createEvalValidator(),
      );
      const current = await store.loadAccepted('scenario');

      const stale = await runner.run(
        {
          prompt: 'a change from a stale base',
          projectId: 'scenario',
          runId: 'stale',
          base: baseline,
        },
        new FakeModelProvider([GOOD_PLAN]),
        createEvalValidator(),
      );

      const conflicted = stale.state === 'failed' && stale.conflict === true;
      const after = await store.loadAccepted('scenario');
      const retained = after?.revision === current?.revision;
      return {
        id: 'conflicting-revision',
        passed: conflicted && retained,
        detail: conflicted
          ? 'the stale writer was refused and the newer revision stands'
          : `expected a conflict, got ${stale.state}`,
        checkpointRetained: retained,
      };
    },
  },
  {
    id: 'sandbox-eviction',
    description: 'in-flight work is lost but the checkpoint survives',
    run: async () => {
      const store = new InMemoryGenerationStore();
      const baseline = await establishBaseline(store);

      // Eviction is modelled as a run that got as far as staging and then
      // vanished. The in-flight record exists; nothing was promoted. What
      // matters is that reopening the project returns the checkpoint the user
      // already had, not the half-finished work that killed the sandbox.
      const staged: ProjectSnapshot = {
        revision: 'r-evicted',
        files: [
          { path: 'package.json', content: '{}' },
          { path: 'README.md', content: '# half written\n' },
        ],
      };
      await store.saveStage({
        runId: 'evicted',
        projectId: 'scenario',
        baseRevision: baseline.revision,
        state: 'validating',
        snapshot: staged,
      });

      const reopened = await store.loadAccepted('scenario');
      const retained = sameSnapshot(reopened, baseline);
      const leaked = reopened?.files.some((file) =>
        file.content.includes('half written'),
      );
      return {
        id: 'sandbox-eviction',
        passed: retained && leaked !== true,
        detail: retained
          ? 'the accepted checkpoint reopened unchanged; the staged work did not leak into it'
          : 'the accepted checkpoint did not survive an evicted run',
        checkpointRetained: retained,
      };
    },
  },
];

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  return scenario.run();
}
