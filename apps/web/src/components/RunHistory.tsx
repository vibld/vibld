import { useEffect, useState } from 'react';
import type { RunTrace } from '@vibld/core';
import {
  STOP_LABELS,
  fetchRuns,
  stopTone,
  summarise,
} from '../generation/runs-client.ts';

/**
 * What every run on this project did (#167).
 *
 * The facts here were already produced on every run and only ever reached
 * the server log: the model, the tokens, the cached fraction, the cost, and
 * why the run ended. Reading them meant reading server output against a run
 * the user could not point at, and after a reload there was nothing to point
 * at either.
 *
 * Fetched rather than accumulated in memory, which is the part that makes it
 * survive the reload: the list is read back from the store on mount, so a
 * run started this morning is still here this afternoon, and a run this tab
 * never watched is here too.
 */
export function RunHistory({ runCount }: { runCount: number }) {
  const [runs, setRuns] = useState<RunTrace[] | null | 'loading'>('loading');

  // Re-fetched when the session's own run count changes, which is how a run
  // that just finished appears without a reload. The count rather than the
  // status, because a status passes through the same value twice and a
  // finished run increments exactly once.
  useEffect(() => {
    let cancelled = false;
    void fetchRuns().then((result) => {
      if (!cancelled) setRuns(result);
    });
    return () => {
      cancelled = true;
    };
  }, [runCount]);

  if (runs === 'loading') return null;

  return (
    <div className="runs">
      <h2 className="pane-title">Runs</h2>
      <p className="pane-note">
        What each run did, kept with the project rather than in this tab.
      </p>
      {runs === null ? (
        <p className="empty">Run history is unavailable right now.</p>
      ) : runs.length === 0 ? (
        <p className="empty">No runs yet.</p>
      ) : (
        <ol className="runs__list">
          {runs.map((run) => (
            <li key={run.runId} className="runs__item">
              <p className={`runs__stop runs__stop--${stopTone(run.stop)}`}>
                {STOP_LABELS[run.stop]}
              </p>
              <p className="runs__detail">{summarise(run)}</p>
              {/*
               * The machine-readable instant beside the readable one: a run
               * compared against a log line or a Stripe charge needs the
               * exact time, and the list needs something short.
               */}
              <time className="runs__when" dateTime={run.endedAt}>
                {new Date(run.endedAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
