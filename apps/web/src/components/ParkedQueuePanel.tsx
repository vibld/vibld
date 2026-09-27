import { useState } from 'react';
import { fetchParkedQueue } from '../generation/admin-client.ts';
import { parkedQueueView } from './parked-queue-view.ts';
import type { ParkedQueueView } from './parked-queue-view.ts';

type QueueState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; view: ParkedQueueView }
  | { phase: 'failed'; error: string };

/**
 * Payments Stripe says moved that this deployment cannot yet name (#46).
 *
 * `0010_unattributed_events.sql` describes the table as "a visible queue
 * with a count and an age, which is a thing somebody can act on, rather than
 * a number in a log or a silence". The table and the nightly retry shipped;
 * the visible half did not, so the only way to know the retry had stopped
 * resolving anything was to query D1 by hand.
 *
 * Read-only. The retry is what resolves these, and a route that could also
 * attribute a payment by hand is a route that credits money on an operator's
 * say-so: that wants its own confirmation and its own audit record, and is
 * deliberately not here.
 *
 * Loads on open rather than on mount, like the other panels in this shell: a
 * queue nobody is looking at should not cost a query on every page load.
 *
 * Rendered only when `state.isAdmin` (`App.tsx`), which is convenience and
 * not the boundary: `/api/admin/unattributed` re-checks admin membership
 * itself (ADR-0006).
 */
export function ParkedQueuePanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<QueueState>({ phase: 'idle' });

  async function load() {
    setState({ phase: 'loading' });
    try {
      const result = await fetchParkedQueue();
      setState(
        result.ok
          ? { phase: 'loaded', view: parkedQueueView(result.queue) }
          : { phase: 'failed', error: result.error },
      );
    } catch {
      // `fetchParkedQueue` returns a refusal but throws a transport failure,
      // so without this the panel sits on "Loading..." for the life of the
      // page and the rejection goes unhandled.
      setState({
        phase: 'failed',
        error: 'The queue could not be read.',
      });
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
        Admin: payments awaiting attribution
        <span className="pill pill--on">admin</span>
      </summary>

      {state.phase === 'loading' ? (
        <p className="pane-note" role="status">
          Reading the queue…
        </p>
      ) : null}

      {state.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.phase === 'loaded' ? (
        <>
          <p
            className={
              state.view.tone === 'stale'
                ? 'pane-note pane-note--error'
                : 'pane-note'
            }
            role="status"
          >
            {state.view.headline}
          </p>
          {state.view.note ? (
            <p className="pane-note">{state.view.note}</p>
          ) : null}

          {/*
            Plain list elements with the stylesheet's own note class rather
            than new ones. A class this file invents and the stylesheet does
            not define renders as unstyled text that looks like a layout bug,
            which is the failure `[hidden]` already taught this shell once.
          */}
          {state.view.rows.length > 0 ? (
            <ul>
              {state.view.rows.map((row) => (
                <li key={row.stripeEventId} className="pane-note">
                  {row.amount} · {row.type} · {row.customer} · waiting{' '}
                  {row.waiting} · {row.attempts}
                </li>
              ))}
            </ul>
          ) : null}

          {state.view.truncated ? (
            <p className="pane-note">
              Showing the {state.view.rows.length} least recently tried. The
              count above is the whole queue.
            </p>
          ) : null}

          <button type="button" className="button" onClick={() => void load()}>
            Refresh
          </button>
        </>
      ) : null}
    </details>
  );
}
