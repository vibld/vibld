import {
  DurableGenerationRunner,
  InMemoryGenerationStore,
  RunBudgetLedger,
} from '@vibld/core';
import type { GenerationStore, ModelProvider } from '@vibld/core';
import type { EvalCase } from './cases.ts';
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

export async function runCase(
  testCase: EvalCase,
  provider: ModelProvider,
  options: HarnessOptions = {},
): Promise<CaseResult> {
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? new InMemoryGenerationStore();
  const ledger = new RunBudgetLedger(options.budget ?? DEFAULT_BUDGET);
  const started = now();

  const inputTokens = estimateTokens(testCase.prompt);
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
        prompt: testCase.prompt,
        projectId: options.projectId ?? testCase.id,
        runId: `${testCase.id}-run`,
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
  const accepted = result.accepted;
  const paths = new Set(accepted.files.map((file) => file.path));
  const haystack = accepted.files
    .map((file) => `${file.path}\n${file.content}`)
    .join('\n')
    .toLowerCase();

  const problems: string[] = [];
  for (const path of testCase.expects.files) {
    if (!paths.has(path)) problems.push(`expected file ${path} is missing`);
  }
  for (const text of testCase.expects.content) {
    if (!haystack.includes(text.toLowerCase())) {
      problems.push(`the project never mentions "${text}"`);
    }
  }

  return {
    id: testCase.id,
    outcome: problems.length === 0 ? 'accepted' : 'failed-expectations',
    durationMs: now() - started,
    problems,
    estimatedTokens,
  };
}
