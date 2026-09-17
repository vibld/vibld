import type { RunStop, RunTrace } from '@vibld/core';
import { cachedFraction, contextPressure } from '@vibld/core';
import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * The builder's half of run history (#167): fetching `/api/runs` and turning
 * a stored trace into the words a person reads.
 *
 * JSX-free for the reason `billing-client.ts` gives: this project's test
 * runner strips types only and errors on JSX, so anything a `*.test.ts` file
 * imports has to stay clear of it. `components/RunHistory.tsx` is the React
 * half.
 *
 * The prose lives here rather than in the stored record on purpose. The
 * identifier is what travels and what a caller branches on; the sentence is
 * chosen at the surface that renders it, so re-wording a line never changes
 * what was recorded (see `run-outcome.ts`).
 */

/**
 * How each stop reads to the person whose run it was.
 *
 * A total record rather than a `switch` with a default, so a stop added to
 * the vocabulary fails to compile here instead of quietly rendering as its
 * own identifier in the middle of an English sentence.
 *
 * Written from the user's side: what happened to their project, not what
 * this service's internals were doing. "The model declined this request" is
 * something a person can act on; `model-refused` is not.
 */
export const STOP_LABELS: Record<RunStop, string> = {
  applied: 'Applied',
  'no-changes': 'No changes needed',
  cancelled: 'Cancelled',
  'validation-failed': 'Did not pass validation',
  'model-refused': 'The model declined this request',
  'model-truncated': 'Cut off at the output limit',
  'model-shape': 'The model returned an unusable plan',
  'context-exceeded': 'Too large to send',
  'run-budget-exceeded': "Ran past this run's budget",
  'provider-error': 'The model provider failed',
  conflict: 'The project moved on before this could apply',
  'store-unavailable': 'Vibld could not save the result',
  'not-started': 'Never started',
};

/** Whether a stop should read as a success in the list. */
export function stopTone(stop: RunStop): 'kept' | 'quiet' | 'failed' {
  if (stop === 'applied') return 'kept';
  // Neither a win nor a fault: the run worked and there was nothing to do,
  // or somebody stopped it themselves.
  if (stop === 'no-changes' || stop === 'cancelled') return 'quiet';
  return 'failed';
}

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isTrace(value: unknown): value is RunTrace {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RunTrace).runId === 'string' &&
    typeof (value as RunTrace).stop === 'string' &&
    typeof (value as RunTrace).model === 'string' &&
    typeof (value as RunTrace).endedAt === 'string'
  );
}

/**
 * This project's finished runs, newest first.
 *
 * `null` means "nothing to show", covering signed out, a deployment without
 * the table, an expired session and a network failure alike. Nobody asked
 * for this panel, so it renders nothing rather than an error, the same
 * choice `fetchBillingStatus` makes.
 *
 * A malformed row is dropped rather than failing the whole list: one
 * unreadable record must not take the rest of somebody's history with it.
 */
export async function fetchRuns(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<RunTrace[] | null> {
  let response: Response;
  try {
    response = await fetchImpl('/api/runs', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  try {
    const body: unknown = await response.json();
    const runs =
      typeof body === 'object' && body !== null
        ? (body as { runs?: unknown }).runs
        : undefined;
    if (!Array.isArray(runs)) return null;
    return runs.filter(isTrace);
  } catch {
    return null;
  }
}

/** "8.2s", or "1m 04s" once seconds stop being the useful unit. */
export function formatElapsed(ms: number): string {
  if (ms < 0) return '--';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * "12,400" -- grouped, because the difference between 12,400 and 124,000 is
 * the whole point of showing the number and four digits of difference is
 * easy to miss unseparated.
 */
export function formatTokens(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * "$0.0143" -- four decimal places, not two.
 *
 * A single run costs cents, and `formatUsd`'s two places round most of them
 * to $0.00, which reads as free. Somebody comparing two models needs to see
 * the difference between them.
 */
export function formatRunCost(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

/** "62%" from a fraction, or null where there is nothing to report. */
export function formatFraction(fraction: number): string | null {
  if (fraction <= 0) return null;
  return `${Math.round(fraction * 100)}%`;
}

/**
 * The one line under a run: what it cost, how long it took, and the two
 * measurements a stored trace exists to answer.
 *
 * Built as a list of parts and joined, so a measurement that has nothing to
 * say leaves nothing behind rather than a stray separator or a "0%" that
 * looks like a reading.
 */
export function summarise(trace: RunTrace): string {
  const cached = formatFraction(cachedFraction(trace));
  const pressure = formatFraction(contextPressure(trace));
  return [
    trace.model,
    `${formatTokens(trace.inputTokens)} in`,
    `${formatTokens(trace.outputTokens)} out`,
    cached ? `${cached} cached` : null,
    pressure ? `${pressure} of context` : null,
    formatRunCost(trace.costMicroUsd),
    formatElapsed(trace.elapsedMs),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
