import { useId, useState } from 'react';
import {
  CONFIRMATION_PHRASE,
  WHAT_IS_DELETED_LATER,
  WHAT_IS_KEPT,
  WHAT_STOPS_NOW,
  formatPurgeDate,
  phraseMatches,
  requestAccountDeletion,
} from '../account/deletion-client.ts';
import type { DeletionSchedule } from '../account/deletion-client.ts';

type Phase =
  | { phase: 'idle' }
  /** The explanation and the phrase, held open until somebody decides. */
  | { phase: 'confirming'; error?: string }
  | { phase: 'working' }
  | { phase: 'done'; schedule: DeletionSchedule };

/**
 * Deleting the account, from the settings menu (docs/decisions.md L32).
 *
 * The confirmation is part of the page rather than `confirm()`: a browser
 * dialog cannot say what stops, what goes in 30 days and what is kept, and
 * one that can be dismissed with Enter is the wrong shape for the one
 * action here that cannot be undone after a month. So it explains in
 * place, and the button stays disabled until the phrase is typed. The
 * Worker checks the phrase as well, so the page is not the only guard.
 *
 * Nothing is fetched until somebody asks: an account that never opens this
 * costs nothing.
 */
export function AccountDeletion({
  /**
   * What happens once the request is recorded and read. The page reloads
   * by default, so the shell asks again who this is and shows the screen
   * for an account scheduled for deletion; every request from the builder
   * behind this menu is refused from now on. A prop so a test can see it
   * called without a reload.
   */
  onDone = () => window.location.reload(),
}: {
  onDone?: () => void;
}) {
  const [state, setState] = useState<Phase>({ phase: 'idle' });
  const [typed, setTyped] = useState('');
  const phraseId = useId();

  async function confirm() {
    setState({ phase: 'working' });
    try {
      const result = await requestAccountDeletion(typed);
      setState(
        result.ok
          ? { phase: 'done', schedule: result.schedule }
          : { phase: 'confirming', error: result.error },
      );
    } catch {
      setState({
        phase: 'confirming',
        error: 'The request could not be made. Nothing was deleted.',
      });
    }
  }

  if (state.phase === 'idle') {
    return (
      <button
        type="button"
        className="button"
        onClick={() => {
          setTyped('');
          setState({ phase: 'confirming' });
        }}
      >
        Delete account
      </button>
    );
  }

  if (state.phase === 'done') {
    const { schedule } = state;
    return (
      <div role="status" aria-label="Account deletion">
        <p className="settings__note">
          Your account is scheduled for deletion on{' '}
          <strong>{formatPurgeDate(schedule.purgeAfter)}</strong>. It can no
          longer be used. Sign in again before then if you want to keep it.
        </p>
        {schedule.errors.length > 0 ? (
          <>
            <p className="settings__note">
              Some of it has not stopped yet. It will be tried again, and you
              can try again yourself when you sign in:
            </p>
            <ul className="settings__note">
              {schedule.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </>
        ) : null}
        <button type="button" className="button" onClick={onDone}>
          Continue
        </button>
      </div>
    );
  }

  const working = state.phase === 'working';
  return (
    <div
      className="publish-confirm"
      role="group"
      aria-label="Confirm account deletion"
    >
      <p className="settings__note">
        <strong>What stops now</strong>
      </p>
      <ul className="settings__note">
        {WHAT_STOPS_NOW.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="settings__note">
        <strong>What is deleted after 30 days</strong>
      </p>
      <ul className="settings__note">
        {WHAT_IS_DELETED_LATER.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="settings__note">
        Until then you can sign in and keep the account. After that it cannot be
        recovered.
      </p>
      <p className="settings__note">
        <strong>What is kept, and why</strong>
      </p>
      <ul className="settings__note">
        {WHAT_IS_KEPT.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <label className="prompt__label" htmlFor={phraseId}>
        Type <strong>{CONFIRMATION_PHRASE}</strong> to confirm
      </label>
      <input
        id={phraseId}
        type="text"
        className="prompt__input"
        autoComplete="off"
        value={typed}
        disabled={working}
        onChange={(event) => setTyped(event.target.value)}
      />

      {state.phase === 'confirming' && state.error ? (
        <p className="pane-note pane-note--error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="button"
        className="button"
        disabled={working || !phraseMatches(typed)}
        onClick={() => void confirm()}
      >
        {working ? 'Deleting…' : 'Delete my account'}
      </button>
      <button
        type="button"
        className="button"
        disabled={working}
        onClick={() => setState({ phase: 'idle' })}
      >
        Keep my account
      </button>
    </div>
  );
}
