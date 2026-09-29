import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  OUTLINE_LABEL,
  REQUIRED_PROJECT_FILES,
  buildOutputBudgetFor,
  createScriptedBuildClient,
} from '@vibld/ai';
import type {
  BoundedBuildResult,
  ScriptedBuild,
  ScriptedFile,
} from '@vibld/ai';
import type { ProjectFile } from '@vibld/core';

import {
  assembleRun,
  buildInSteps,
  isBoundedRun,
  preflightRun,
  runGeneration,
  settleBudget,
  traceOf,
} from '../worker/generation-run.ts';
import type {
  ProgressReport,
  StepRunner,
  WorkflowParams,
} from '../worker/generation-run.ts';
import { D1GenerationStore } from '../worker/generation-store.ts';
import {
  BOUNDED_BUILD_INPUT_CHARS,
  runCeilingFor,
} from '../worker/run-ceiling.ts';
import { stageFor, stepFor } from '../worker/run-stage.ts';
import { microUsdOf, worstCaseMicroUsd } from '../worker/spend.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { FakeModelProvider } from '@vibld/core';

/**
 * The Worker's half of a bounded build (docs/decisions.md, "Resolved
 * 2026-09-29"): each model call a durable Workflow step of its own, then the
 * result staged and promoted, then the money settled.
 *
 * `generation-workflow.ts` imports `cloudflare:workers` and cannot be loaded
 * here, so these drive the same functions it glues together
 * (`preflightRun`, `buildInSteps`, `assembleRun`, `settleBudget`) with a
 * step runner that behaves as a Workflow's does: a finished step's result
 * is stored as JSON and returned again, not recomputed.
 */

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0001_generation_store.sql'),
  'utf8',
);

function newStore(): D1GenerationStore {
  return new D1GenerationStore(
    new SqliteD1Database(SCHEMA),
    new InMemoryR2Bucket(),
  );
}

const MODEL = 'claude-opus-5-5';
const CEILING = runCeilingFor({ VIBLD_PROVIDER: 'anthropic' }, MODEL);

function params(overrides: Partial<WorkflowParams> = {}): WorkflowParams {
  return {
    projectId: 'user_abc',
    runId: 'run-1',
    prompt:
      'A full website for North Star Systems, a security consultancy based in Atlanta. Heavy animation and fluid motion.',
    model: MODEL,
    userId: 'user_abc',
    reservationId: 11,
    reservationKey: 'user_abc',
    accountReservationId: 22,
    worstCaseMicroUsd: worstCaseMicroUsd(
      CEILING.prices,
      CEILING.maxTokens,
      BOUNDED_BUILD_INPUT_CHARS,
    ),
    prices: CEILING.prices,
    maxTokens: CEILING.maxTokens,
    maxInputChars: BOUNDED_BUILD_INPUT_CHARS,
    ...overrides,
  };
}

function file(
  path: string,
  characters: number,
  size: ScriptedFile['size'] = 'small',
  dependsOn: string[] = [],
): ScriptedFile {
  return {
    path,
    content: `// ${path}\n${'x'.repeat(characters)}`,
    size,
    dependsOn,
  };
}

/** A site larger than one response can carry, in the shape of trace 9eb10950. */
function companySite(): ScriptedBuild {
  const pages = [
    'Home',
    'Services',
    'Fractional',
    'Readiness',
    'Pentesting',
    'Contact',
  ].map((name) =>
    file(`src/pages/${name}Page.tsx`, 60_000, 'large', [
      'src/components/SiteLayout.tsx',
    ]),
  );
  return {
    summary: 'A six-route site for North Star Systems.',
    files: [
      ...REQUIRED_PROJECT_FILES.filter((path) => path !== 'src/App.tsx').map(
        (path) => file(path, 600),
      ),
      ...['button', 'card', 'sheet', 'accordion', 'tabs', 'dialog'].map(
        (name) => file(`src/components/ui/${name}.tsx`, 10_000, 'medium'),
      ),
      file('src/components/SiteLayout.tsx', 10_000, 'medium'),
      ...pages,
      file(
        'src/App.tsx',
        4_000,
        'medium',
        pages.map((page) => page.path),
      ),
    ],
  };
}

/** A step runner that stores each result as a Workflow does, by name. */
function durableSteps(stored = new Map<string, unknown>()): {
  step: StepRunner;
  names: string[];
  stored: Map<string, unknown>;
} {
  const names: string[] = [];
  return {
    names,
    stored,
    step: async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      names.push(name);
      if (stored.has(name)) {
        return JSON.parse(JSON.stringify(stored.get(name))) as T;
      }
      const value = await run();
      stored.set(name, JSON.parse(JSON.stringify(value)));
      return value;
    },
  };
}

function touchingLedger() {
  const touches: { key: string; id: number }[] = [];
  const settles: { key: string; id: number; actual: number }[] = [];
  return {
    touches,
    settles,
    ledger: {
      getByName: (key: string) => ({
        touch: async (id: number) => {
          touches.push({ key, id });
        },
        settle: async (id: number, actual: number) => {
          settles.push({ key, id, actual });
        },
      }),
    } as unknown as Parameters<typeof settleBudget>[0] &
      Parameters<typeof buildInSteps>[0]['ledger'],
  };
}

/** Everything the Workflow does from `prepare` to `settle-budget`. */
async function runLikeTheWorkflow(
  store: D1GenerationStore,
  script: ScriptedBuild,
  run: WorkflowParams,
  options: {
    steps?: ReturnType<typeof durableSteps>;
    reports?: ProgressReport[];
    client?: ReturnType<typeof createScriptedBuildClient>;
  } = {},
) {
  const client = options.client ?? createScriptedBuildClient(script);
  const steps = options.steps ?? durableSteps();
  const money = touchingLedger();
  const prepared = await preflightRun(store, run);
  const built: BoundedBuildResult | undefined = prepared.refusal
    ? undefined
    : await buildInSteps(
        {
          client,
          store: () => store,
          ledger: money.ledger,
          ...(options.reports
            ? { report: (report) => options.reports!.push(report) }
            : {}),
        },
        run,
        steps.step,
      );
  const outcome = await assembleRun(store, run, prepared, built);
  const charged = await settleBudget(
    money.ledger,
    run,
    outcome.usage,
    outcome.providerRan,
  );
  return { client, steps, money, built, outcome, charged };
}

describe('a large first build, run as durable steps', () => {
  it('completes, is promoted, and settles what its calls spent', async () => {
    const store = newStore();
    const script = companySite();
    const { client, steps, money, outcome, charged } = await runLikeTheWorkflow(
      store,
      script,
      params(),
    );

    assert.equal(outcome.result.state, 'accepted', outcome.result.errors[0]);
    const accepted = await store.loadAccepted('user_abc');
    const paths = new Set(
      accepted!.files.map((item: ProjectFile) => item.path),
    );
    for (const item of script.files) assert.ok(paths.has(item.path), item.path);

    // One durable step per call, with the names a replay will find.
    assert.equal(steps.names[0], 'outline');
    assert.ok(steps.names.slice(1).every((name) => name.startsWith('write-')));
    assert.equal(steps.names.length, client.requests.length);
    assert.equal(outcome.calls, client.requests.length);

    // Settled at the summed usage of every call, on both layers, and inside
    // what was reserved for the run.
    assert.equal(charged, microUsdOf(outcome.usage!, params().prices));
    assert.deepEqual(
      money.settles.map((entry) => entry.actual),
      [charged, charged],
    );
    assert.ok(charged < params().worstCaseMicroUsd);
  });

  it('keeps its reservation alive from every model step, on both layers', async () => {
    const { client, money } = await runLikeTheWorkflow(
      newStore(),
      companySite(),
      params(),
    );
    const user = money.touches.filter((entry) => entry.key === 'user_abc');
    const account = money.touches.filter(
      (entry) => entry.key === '__account__',
    );
    assert.equal(user.length, client.requests.length);
    assert.equal(account.length, client.requests.length);
    assert.ok(user.every((entry) => entry.id === 11));
    assert.ok(account.every((entry) => entry.id === 22));
  });

  it('says which step is running, counting characters across the whole run', async () => {
    const reports: ProgressReport[] = [];
    await runLikeTheWorkflow(newStore(), companySite(), params(), { reports });
    const steps = [...new Set(reports.map((report) => report.step))];
    assert.equal(steps[0], OUTLINE_LABEL);
    const total = steps.length - 1;
    assert.equal(steps[1], `Writing 1 of ${total}: project setup`);
    assert.ok(
      steps.some((step) =>
        new RegExp(`^Writing \\d of ${total}: \\w+ and \\w+ pages$`).test(
          step ?? '',
        ),
      ),
      steps.join('\n'),
    );
    for (let at = 1; at < reports.length; at += 1) {
      assert.ok(
        reports[at]!.characters >= reports[at - 1]!.characters,
        'the meter went back to zero when a step started',
      );
    }

    // What the poll loop makes of a report, while the steps run and after.
    const last = reports.at(-1)!;
    assert.equal(
      stepFor('running', { report: last, finished: false }),
      last.step,
    );
    assert.equal(
      stepFor('running', { report: last, finished: true }),
      undefined,
    );
    assert.equal(
      stepFor('queued', { report: last, finished: false }),
      undefined,
    );
    assert.equal(
      stageFor('running', { report: last, finished: false }),
      'running',
    );
  });

  it('is replayed from its stored steps without asking the model again', async () => {
    // A Workflow resumes by running `run` from the top, and every finished
    // step returns what it returned before. Nothing is paid for twice, and
    // the run comes to the same answer.
    const stored = new Map<string, unknown>();
    const first = durableSteps(stored);
    const client = createScriptedBuildClient(companySite());
    const run = params();
    const built = await buildInSteps(
      { client, store: () => newStore() },
      run,
      first.step,
    );
    const calls = client.requests.length;

    const replay = durableSteps(stored);
    const again = await buildInSteps(
      { client, store: () => newStore() },
      run,
      replay.step,
    );
    assert.equal(client.requests.length, calls, 'a replay called the model');
    assert.deepEqual(replay.names, first.names);
    assert.equal(new Set(first.names).size, first.names.length);
    assert.deepEqual(again, JSON.parse(JSON.stringify(built)));
  });
});

describe('a build whose later group fails', () => {
  it('promotes nothing, keeps the earlier groups, and charges what was spent', async () => {
    const store = newStore();
    const script: ScriptedBuild = {
      summary: 'A site with one page too large to write.',
      files: [
        ...REQUIRED_PROJECT_FILES.map((path) => file(path, 600)),
        // Far past what one response can hold, and planned last.
        file('src/pages/Everything.tsx', 200_000, 'large'),
      ],
    };
    const { steps, outcome, charged } = await runLikeTheWorkflow(
      store,
      script,
      params(),
    );

    assert.equal(outcome.result.state, 'failed');
    assert.equal(outcome.result.stop, 'model-truncated');
    assert.match(outcome.result.errors[0]!, /src\/pages\/Everything\.tsx/);
    assert.equal(await store.loadAccepted('user_abc'), undefined);

    // The groups before it are durable results, made once.
    assert.ok(steps.names.includes('write-1'));
    assert.equal(new Set(steps.names).size, steps.names.length);

    // Charged for every call that was made, the cut-off one included, and
    // not the worst case: the usage was measured.
    assert.equal(outcome.providerRan, true);
    assert.equal(charged, microUsdOf(outcome.usage!, params().prices));
    assert.ok(charged > 0);
    assert.ok(charged < params().worstCaseMicroUsd);
  });

  it('charges nothing when no model call was made', async () => {
    const { outcome, charged } = await runLikeTheWorkflow(
      newStore(),
      companySite(),
      // Too little output budget for even the outline to start.
      params({ maxTokens: 100 }),
    );
    assert.equal(outcome.result.stop, 'run-budget-exceeded');
    assert.equal(outcome.calls, 0);
    assert.equal(charged, 0);
  });
});

describe('a follow-up, run as durable steps', () => {
  async function seeded(store: D1GenerationStore) {
    const first = await runGeneration(
      store,
      new FakeModelProvider([
        {
          summary: 'First',
          files: [
            ...REQUIRED_PROJECT_FILES.map((path) => ({
              path,
              content: `// ${path} as it was`,
            })),
            { path: 'src/pages/Blog.tsx', content: '// the blog' },
          ],
        },
      ]),
      { ...params(), runId: 'seed' },
    );
    return first.result.accepted!.revision;
  }

  it('applies its patch onto the stored project and carries the rest over', async () => {
    const store = newStore();
    const revision = await seeded(store);
    const { outcome, client } = await runLikeTheWorkflow(
      store,
      {
        summary: 'Added pricing, dropped the blog.',
        files: [
          file('src/pages/Pricing.tsx', 2_000, 'medium'),
          { path: 'src/App.tsx', content: '// routes to pricing' },
        ],
        delete: ['src/pages/Blog.tsx'],
      },
      params({ runId: 'run-2', baseRevision: revision }),
    );
    assert.equal(outcome.result.state, 'accepted', outcome.result.errors[0]);
    const files = new Map(
      (await store.loadAccepted('user_abc'))!.files.map((item) => [
        item.path,
        item.content,
      ]),
    );
    assert.equal(files.get('src/App.tsx'), '// routes to pricing');
    assert.ok(files.has('src/pages/Pricing.tsx'));
    assert.equal(files.has('src/pages/Blog.tsx'), false);
    assert.equal(files.get('package.json'), '// package.json as it was');
    // Only the changed files were written: two calls, not the whole
    // project re-emitted.
    assert.equal(client.requests.length, 2);
  });

  it('stops spending and reports a conflict when the project moves while it runs', async () => {
    const store = newStore();
    const revision = await seeded(store);
    const client = createScriptedBuildClient({
      summary: 'Two groups of change.',
      files: [
        file('src/pages/One.tsx', 40_000, 'large'),
        file('src/pages/Two.tsx', 40_000, 'large'),
        file('src/pages/Three.tsx', 40_000, 'large'),
      ],
    });
    // Another tab promotes as soon as the outline is written.
    const steps = durableSteps();
    const moving: typeof steps = {
      ...steps,
      step: async <T>(name: string, run: () => Promise<T>): Promise<T> => {
        const value = await steps.step(name, run);
        if (name === 'outline') {
          await runGeneration(
            store,
            new FakeModelProvider([
              {
                summary: 'Other tab',
                files: REQUIRED_PROJECT_FILES.map((path) => ({
                  path,
                  content: `// ${path} from elsewhere`,
                })),
              },
            ]),
            { ...params(), runId: 'other-tab', baseRevision: revision },
          );
        }
        return value;
      },
    };
    const { outcome, charged } = await runLikeTheWorkflow(
      store,
      { summary: 'unused', files: [] },
      params({ runId: 'run-3', baseRevision: revision }),
      { client, steps: moving },
    );
    assert.equal(outcome.result.stop, 'conflict');
    assert.equal(outcome.result.conflict, true);
    // The outline was paid for; nothing after it was asked.
    assert.equal(client.requests.length, 1);
    assert.equal(outcome.providerRan, true);
    assert.equal(charged, microUsdOf(outcome.usage!, params().prices));
  });

  it('refuses a stale revision before any step, for nothing', async () => {
    const store = newStore();
    const revision = await seeded(store);
    await runGeneration(
      store,
      new FakeModelProvider([
        {
          summary: 'Other tab',
          files: REQUIRED_PROJECT_FILES.map((path) => ({
            path,
            content: '// moved',
          })),
        },
      ]),
      { ...params(), runId: 'other', baseRevision: revision },
    );
    const { client, outcome, charged } = await runLikeTheWorkflow(
      store,
      companySite(),
      params({ runId: 'stale', baseRevision: revision }),
    );
    assert.equal(outcome.result.stop, 'conflict');
    assert.equal(client.requests.length, 0);
    assert.equal(charged, 0);
  });
});

describe('what a bounded build may spend', () => {
  it('reserves at least what the run is then allowed to spend', () => {
    // The run refuses a call that would pass either budget, so its cost is
    // bounded by the two figures it is given, priced at the dearest rate
    // each could settle at. The reservation is that figure.
    const run = params();
    const most = worstCaseMicroUsd(
      run.prices,
      run.maxTokens,
      run.maxInputChars!,
    );
    assert.equal(run.worstCaseMicroUsd, most);
    assert.equal(run.maxTokens, buildOutputBudgetFor(MODEL));
  });

  it('runs a payload persisted before bounded builds the way it was enqueued', () => {
    // Such a run may already hold its one response under the old step name;
    // the Workflow reads it back there rather than paying for it again.
    assert.equal(isBoundedRun(params()), true);
    assert.equal(
      isBoundedRun({ ...params(), maxInputChars: undefined }),
      false,
    );
  });

  it('holds a run with no recorded input budget to the one it was reserved for', async () => {
    // No `maxInputChars`: what a payload from before this shipped carries,
    // reserved for one call's input. Its repair turn is a bounded build, so
    // this is the budget that turn is held to. Twice the site, so that is
    // not enough.
    const site = companySite();
    const larger: ScriptedBuild = {
      ...site,
      files: [
        ...site.files,
        ...['About', 'Team', 'Careers', 'Blog', 'Press', 'Legal'].map((name) =>
          file(`src/pages/${name}Page.tsx`, 30_000, 'large', [
            'src/components/SiteLayout.tsx',
          ]),
        ),
      ],
    };
    const { client, outcome } = await runLikeTheWorkflow(newStore(), larger, {
      ...params(),
      maxInputChars: undefined,
    });
    const sent = client.requests.reduce(
      (sum, request) =>
        sum +
        request.system.length +
        (request.cachePrefix?.length ?? 0) +
        request.prompt.length,
      0,
    );
    // It stops with its budget named rather than sending past what was
    // reserved for it.
    assert.ok(sent <= 256_500, `sent ${sent}`);
    assert.equal(outcome.result.stop, 'run-budget-exceeded');
  });

  it('records one trace for the run, its usage summed and its window per call', async () => {
    const { outcome, charged } = await runLikeTheWorkflow(
      newStore(),
      companySite(),
      params(),
    );
    const trace = traceOf(params(), outcome.result, outcome.usage, {
      costMicroUsd: charged,
      elapsedMs: 1,
      endedAt: '2026-09-29T00:00:00.000Z',
      calls: outcome.calls,
    });
    assert.equal(trace.outputTokens, outcome.usage!.outputTokens);
    assert.equal(trace.contextWindow, 1_000_000 * outcome.calls);
    assert.ok(
      trace.cachedInputTokens > 0,
      'the shared prefix was never read from cache',
    );
  });
});
