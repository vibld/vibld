import {
  DurableGenerationRunner,
  InMemoryGenerationStore,
  RunBudgetLedger,
} from '@vibld/core';
import type { GenerationStore, ModelProvider } from '@vibld/core';
import type { EvalCase, Expectation } from './cases.ts';
import { createEvalValidator } from './validator.ts';

/**
 * Run one case end to end and say plainly what happened.
 *
 * The point is not that a case passes. It is that a case which fails leaves
 * the previous accepted checkpoint standing, reaches a terminal state, and
 * reports what it cost -- including when it failed, because a refusal or a
 * truncation still spends tokens and a tally of successes under-reports.
 */

export type CaseOutcome =
  | 'accepted'
  | 'failed-validation'
  | 'failed-provider'
  | 'failed-expectations'
  | 'budget-exceeded';

export interface CaseResult {
  id: string;
  outcome: CaseOutcome;
  durationMs: number;
  /** Every reason it did not succeed. Empty only when it did. */
  problems: string[];
  /** Estimated, not measured: the deterministic stub reports no usage. */
  estimatedTokens: number;
}

export interface HarnessOptions {
  /** Injected so a report is reproducible under test. */
  now?: () => number;
  store?: GenerationStore;
  projectId?: string;
  budget?: ConstructorParameters<typeof RunBudgetLedger>[0];
  /**
   * What to ask in place of the case's own prompt, and the run id to ask it
   * under. The bakeoff's repair turn (`src/repair.ts`) is the one caller: it
   * sends the repair prompt against a store that already holds the project,
   * and is held to the same checks as the run that produced it, because
   * that is the only way its result means the same thing.
   */
  prompt?: string;
  runId?: string;
}

const DEFAULT_BUDGET = {
  modelInputTokens: 50_000,
  modelOutputTokens: 200_000,
  toolCalls: 100,
};

/** Rough and deterministic. No tokenizer is involved, and none is implied. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * What a case's expectations are read from: the project's code and its file
 * paths, not its prose.
 *
 * A README that repeats the brief, or a comment that does, contains every
 * word the brief used, so reading those would pass a project that only
 * describes the thing asked for (internal PR 234). Markdown files are left out and
 * comments are removed: HTML comments, block comments (JSX's comment form
 * included) and whole-line `//` comments. A `//` after code on the same
 * line stays, because a URL has one too and telling them apart takes a
 * parser.
 */
export function projectCode(
  files: readonly { path: string; content: string }[],
): string {
  return files
    .filter((file) => !/\.(md|markdown)$/i.test(file.path))
    .map(
      (file) =>
        `${file.path}\n${file.content
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/^\s*\/\/.*$/gm, ' ')}`,
    )
    .join('\n');
}

export async function runCase(
  testCase: EvalCase,
  provider: ModelProvider,
  options: HarnessOptions = {},
): Promise<CaseResult> {
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? new InMemoryGenerationStore();
  const ledger = new RunBudgetLedger(options.budget ?? DEFAULT_BUDGET);
  const started = now();

  const prompt = options.prompt ?? testCase.prompt;
  const inputTokens = estimateTokens(prompt);
  let reservation;
  try {
    reservation = ledger.reserve({
      modelInputTokens: inputTokens,
      modelOutputTokens: 32_000,
      toolCalls: 1,
    });
  } catch (error) {
    return {
      id: testCase.id,
      outcome: 'budget-exceeded',
      durationMs: now() - started,
      problems: [error instanceof Error ? error.message : String(error)],
      estimatedTokens: inputTokens,
    };
  }

  const runner = new DurableGenerationRunner(store);
  let result;
  try {
    result = await runner.run(
      {
        prompt,
        projectId: options.projectId ?? testCase.id,
        runId: options.runId ?? `${testCase.id}-run`,
      },
      provider,
      createEvalValidator(),
    );
  } catch (error) {
    reservation.release();
    return {
      id: testCase.id,
      outcome: 'failed-provider',
      durationMs: now() - started,
      problems: [error instanceof Error ? error.message : String(error)],
      estimatedTokens: inputTokens,
    };
  }

  const outputTokens = estimateTokens(
    (result.staged ?? result.accepted)?.files
      .map((file) => file.content)
      .join('') ?? '',
  );
  reservation.commit({
    modelInputTokens: inputTokens,
    modelOutputTokens: Math.min(32_000, outputTokens),
    toolCalls: 1,
  });
  const estimatedTokens = inputTokens + Math.min(32_000, outputTokens);

  if (result.state !== 'accepted' || !result.accepted) {
    return {
      id: testCase.id,
      outcome: 'failed-validation',
      durationMs: now() - started,
      problems:
        result.errors.length > 0
          ? [...result.errors]
          : ['The run produced no accepted checkpoint'],
      estimatedTokens,
    };
  }

  // Accepted is not the same as correct. A project that builds but ignores
  // what was asked for is a failure the compiler cannot see.
  const problems = expectationProblems(testCase, result.accepted.files);

  return {
    id: testCase.id,
    outcome: problems.length === 0 ? 'accepted' : 'failed-expectations',
    durationMs: now() - started,
    problems,
    estimatedTokens,
  };
}

/**
 * Hyphens a page may set in place of "-": U+2010 to U+2015 and the minus
 * sign. Built from code points, the way `scripts/no-em-dash.mjs` builds its
 * own, because one of them is the character that script rejects.
 */
const TYPESET_HYPHENS = new RegExp(
  `[${String.fromCharCode(0x2010)}-${String.fromCharCode(0x2015)}${String.fromCharCode(0x2212)}]`,
  'g',
);

/**
 * The project's code as expectations read it: lower-cased, with typeset
 * hyphens and non-breaking spaces read as the plain ones.
 *
 * A page that writes "no lock-in" with a non-breaking hyphen, so that the
 * phrase never wraps, has made the same claim as one that types it, and a
 * check that could not see it would be grading the keyboard.
 */
export function expectationText(
  files: readonly { path: string; content: string }[],
): string {
  return projectCode(files)
    .toLowerCase()
    .replace(TYPESET_HYPHENS, '-')
    .replace(/\u00a0/g, ' ');
}

/** Whether `text` (from `expectationText`) meets one expectation. */
export function meetsExpectation(
  text: string,
  expectation: Expectation,
): boolean {
  const wordings =
    typeof expectation === 'string' ? [expectation] : expectation;
  return wordings.some((wording) => text.includes(wording.toLowerCase()));
}

/**
 * Every way `files` fall short of what `testCase` asked for: a required
 * file missing, or a thing the project never says in any accepted wording.
 *
 * Its own function so the bakeoff's repair (`src/repair.ts`) holds a
 * repaired project to exactly the checks the first attempt was held to.
 */
export function expectationProblems(
  testCase: EvalCase,
  files: readonly { path: string; content: string }[],
): string[] {
  const paths = new Set(files.map((file) => file.path));
  const text = expectationText(files);
  const problems: string[] = [];
  for (const path of testCase.expects.files) {
    if (!paths.has(path)) problems.push(`expected file ${path} is missing`);
  }
  for (const expectation of testCase.expects.content) {
    if (meetsExpectation(text, expectation)) continue;
    if (typeof expectation === 'string') {
      problems.push(`the project never mentions "${expectation}"`);
    } else {
      // The first wording is the one the case is about, so it leads; the
      // rest are listed so a reader can see what else would have passed.
      const [first, ...rest] = expectation;
      problems.push(
        `the project never mentions "${first}", nor says it as ${rest.map((wording) => `"${wording}"`).join(', ')}`,
      );
    }
  }
  return problems;
}
