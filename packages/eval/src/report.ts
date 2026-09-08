import { PROMPT_SET_VERSION } from './cases.ts';
import type { CaseOutcome, CaseResult } from './harness.ts';

/**
 * What a run of the set adds up to.
 *
 * Failures are counted and named rather than summarised away. A report that
 * says "80%" without saying which four cases failed and why cannot be acted
 * on, and a report that quietly drops the failures is worse than none.
 */

export interface EvalReport {
  promptSetVersion: string;
  /** What produced the plans. Named, because a score without it means little. */
  providerId: string;
  total: number;
  accepted: number;
  /** Every non-accepted outcome, grouped. */
  failures: Record<string, number>;
  durationMs: number;
  estimatedTokens: number;
  results: CaseResult[];
}

export function summarise(
  results: CaseResult[],
  providerId: string,
): EvalReport {
  const failures: Record<string, number> = {};
  let accepted = 0;
  let durationMs = 0;
  let estimatedTokens = 0;

  for (const result of results) {
    durationMs += result.durationMs;
    // Counted for failures too: a run that failed still spent what it spent.
    estimatedTokens += result.estimatedTokens;
    if (result.outcome === 'accepted') accepted += 1;
    else failures[result.outcome] = (failures[result.outcome] ?? 0) + 1;
  }

  return {
    promptSetVersion: PROMPT_SET_VERSION,
    providerId,
    total: results.length,
    accepted,
    failures,
    durationMs,
    estimatedTokens,
    results,
  };
}

const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  accepted: 'accepted',
  'failed-validation': 'failed validation',
  'failed-provider': 'provider error',
  'failed-expectations': 'ignored the request',
  'budget-exceeded': 'budget exceeded',
};

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(
    `Prompt set ${report.promptSetVersion} · provider ${report.providerId}`,
  );
  lines.push(
    `${report.accepted}/${report.total} accepted · ${report.durationMs} ms · ~${report.estimatedTokens} tokens (failures included)`,
  );

  if (report.providerId === 'stub') {
    // Said every time, because a number that looks like a quality measure will
    // be read as one unless it is contradicted where it is printed.
    lines.push(
      'This run used a deterministic stub, not a model. It measures the harness and the failure paths, not generation quality. A real baseline needs a provider and an approved spend cap (#9, #18).',
    );
  }

  for (const result of report.results) {
    const label = OUTCOME_LABEL[result.outcome];
    lines.push(`  ${result.id}: ${label} (${result.durationMs} ms)`);
    for (const problem of result.problems) {
      lines.push(`    - ${problem}`);
    }
  }

  return lines.join('\n');
}
