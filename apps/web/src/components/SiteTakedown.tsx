import { useId, useState } from 'react';
import {
  holdSite,
  releaseSite,
  type SiteState,
} from '../generation/takedown-client.ts';

type Phase =
  | { phase: 'idle' }
  /** The decision, held open until somebody takes it. See below. */
  | { phase: 'confirming'; act: 'hold' | 'release'; slug: string }
  | { phase: 'working' }
  | { phase: 'done'; slug: string; state: SiteState }
  | { phase: 'failed'; error: string };

function describe(state: SiteState, slug: string): string {
  if (state === 'held') return `${slug} is off the web and held.`;
  if (state === 'down') {
    return `${slug} is no longer held. Its owner had already taken it down, so it stays off the web.`;
  }
  return `${slug} is live again.`;
}

/**
 * Take somebody else's published site off the web (#172).
 *
 * The lever an abuse report is answered through. Before this the only one
 * was editing D1 and R2 by hand, which is not something to reach for under
 * time pressure and is easy to do half of.
 *
 * Named by slug because that is what a report carries: somebody sends an
 * address. The reason is required rather than optional, which is the half of
 * "auditable" that costs nothing now and cannot be added afterwards.
 *
 * Two presses, like publishing (ADR-0013), and for a stronger version of the
 * same reason: this one acts on work that is not the operator's, and the
 * confirmation names whose name is about to stop resolving.
 */
export function SiteTakedown() {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<Phase>({ phase: 'idle' });
  const slugId = useId();
  const reasonId = useId();

  function ask(act: 'hold' | 'release') {
    const trimmed = slug.trim();
    if (trimmed === '') {
      setState({ phase: 'failed', error: 'Name the site by its slug.' });
      return;
    }
    if (act === 'hold' && reason.trim() === '') {
      setState({
        phase: 'failed',
        error: 'Say why this site is being taken down.',
      });
      return;
    }
    setState({ phase: 'confirming', act, slug: trimmed });
  }

  async function take(act: 'hold' | 'release', named: string) {
    setState({ phase: 'working' });
    try {
      const result =
        act === 'hold'
          ? await holdSite(named, reason.trim())
          : await releaseSite(named);
      setState(
        result.ok
          ? { phase: 'done', slug: result.slug, state: result.state }
          : { phase: 'failed', error: result.error },
      );
    } catch (error) {
      setState({
        phase: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'The takedown request could not be made.',
      });
    }
  }

  const busy = state.phase === 'working';

  return (
    <details
      className="knowledge"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="knowledge__summary">
        Admin: take a published site down
        <span className="pill pill--on">admin</span>
      </summary>

      <label className="prompt__label" htmlFor={slugId}>
        Slug
      </label>
      <input
        id={slugId}
        type="text"
        className="prompt__input"
        placeholder="their-project-name"
        value={slug}
        disabled={busy}
        onChange={(event) => setSlug(event.target.value)}
      />

      <label className="prompt__label" htmlFor={reasonId}>
        Why
      </label>
      <input
        id={reasonId}
        type="text"
        className="prompt__input"
        placeholder="phishing report 41"
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />

      {state.phase === 'confirming' ? (
        <div
          className="publish-confirm"
          role="group"
          aria-label="Confirm takedown"
        >
          <p className="pane-note">
            {state.act === 'hold' ? (
              <>
                Take <strong>{state.slug}</strong> off the web. The address
                stops working for everyone. Its owner cannot put it back; only
                an admin can lift this.
              </>
            ) : (
              <>
                Lift the hold on <strong>{state.slug}</strong>. If its owner had
                not also taken it down, it starts serving again.
              </>
            )}
          </p>
          <button
            type="button"
            className="chip chip--on"
            onClick={() => void take(state.act, state.slug)}
          >
            {state.act === 'hold' ? 'Take down' : 'Lift the hold'} {state.slug}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setState({ phase: 'idle' })}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="prompt__row">
          <button
            type="button"
            className="button"
            onClick={() => ask('hold')}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Take it down'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => ask('release')}
            disabled={busy}
          >
            Lift a hold
          </button>
        </div>
      )}

      {state.phase === 'done' ? (
        <p className="pane-note">{describe(state.state, state.slug)}</p>
      ) : null}
      {state.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {state.error}
        </p>
      ) : null}
    </details>
  );
}
