import { useState } from 'react';
import {
  fetchPendingDeletions,
  formatPurgeDate,
} from '../account/deletion-client.ts';
import type { PendingDeletion } from '../account/deletion-client.ts';

type ListState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; pending: PendingDeletion[]; purged: number }
  | { phase: 'failed'; error: string };

/**
 * Accounts that asked to be deleted and have not been purged yet
 * (docs/decisions.md L32), and when each one is.
 *
 * Read-only. The nightly pass does the work; this is so that one it cannot
 * finish is something somebody sees. Two cases need a person: a step that
 * keeps failing (its last error is shown), and a published site still
 * serving, which the nightly pass will not take down on its own (ADR-0013)
 * and which holds the purge until somebody does. The takedown panel below
 * is the lever for that one.
 *
 * Loads on open, like the other panels here. `/api/admin/deletions`
 * re-checks admin membership itself (ADR-0006).
 */
export function DeletionsPanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ListState>({ phase: 'idle' });

  async function load() {
    setState({ phase: 'loading' });
    try {
      const result = await fetchPendingDeletions();
      setState(
        result.ok
          ? { phase: 'loaded', pending: result.pending, purged: result.purged }
          : { phase: 'failed', error: result.error },
      );
    } catch {
      setState({ phase: 'failed', error: 'The list could not be read.' });
    }
  }

  return (
    <details
      className="knowledge"
      open={open}
      onToggle={(event) => {
        const nowOpen = event.currentTarget.open;
        setOpen(nowOpen);
        if (nowOpen && state.phase === 'idle') void load();
      }}
    >
      <summary className="knowledge__summary">
        Admin: accounts scheduled for deletion
        <span className="pill pill--on">admin</span>
      </summary>

      {state.phase === 'loading' ? (
        <p className="pane-note" role="status">
          Reading the list…
        </p>
      ) : null}

      {state.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.phase === 'loaded' ? (
        <>
          <p className="pane-note" role="status">
            {state.pending.length === 0
              ? 'No account is waiting to be deleted.'
              : `${state.pending.length} waiting to be deleted.`}{' '}
            {state.purged} deleted in the last 12 months.
          </p>
          {state.pending.length > 0 ? (
            <ul>
              {state.pending.map((row) => (
                <li key={row.userId} className="pane-note">
                  {row.userId} · asked {formatPurgeDate(row.requestedAt)} ·
                  purges {formatPurgeDate(row.purgeAfter)}
                  {row.purgeStep > 0 ? ' · purge under way' : ''}
                  {row.undone.length > 0
                    ? ` · not yet done: ${row.undone.join(', ')}`
                    : ''}
                  {row.liveSlug
                    ? ` · ${row.liveSlug} is still online and holds the purge`
                    : ''}
                  {row.lastError ? ` · last error: ${row.lastError}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="button" onClick={() => void load()}>
            Refresh
          </button>
        </>
      ) : null}
    </details>
  );
}
