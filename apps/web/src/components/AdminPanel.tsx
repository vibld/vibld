import { useId, useRef, useState } from 'react';
import {
  grantAdminCredit,
  lookupAdminUser,
} from '../generation/admin-client.ts';
import type { AdminGrant } from '../generation/admin-client.ts';
import { createStatusGate } from '../github/panel-view.ts';

type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'found';
      userId: string;
      spendableCreditMicroUsd: number;
      grants: AdminGrant[];
    }
  | { phase: 'failed'; error: string };

type GrantState =
  | { phase: 'idle' }
  | { phase: 'granting' }
  /**
   * What the route said it did, which is the only thing that says a grant
   * landed. Kept apart from the lookup so a refresh that fails afterwards
   * cannot take the confirmation down with it.
   */
  | { phase: 'granted'; userId: string; creditUsdCents: number }
  | { phase: 'failed'; error: string };

function formatUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

/**
 * Platform-admin tool (docs/decisions.md L4): grant a user manual spend
 * credit outside the Stripe top-up flow -- support, goodwill, or testing.
 *
 * Rendered only when `state.isAdmin` is true (`App.tsx`), but that is a
 * convenience, not the boundary: `/api/admin/*` re-checks admin membership
 * itself on every call (ADR-0006), so this component never has to trust its
 * own visibility as an access control.
 *
 * Collapsed by default, the same reasoning `KnowledgePanel` gives for the
 * same shape -- this is a tool reached for occasionally, not part of every
 * turn, and should not take space from the composer.
 */
export function AdminPanel() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ phase: 'idle' });
  const [grant, setGrant] = useState<GrantState>({ phase: 'idle' });
  const lookups = useRef(createStatusGate());
  const emailId = useId();
  const amountId = useId();
  const noteId = useId();

  // Latest wins, the same `createStatusGate` the connect panel and the push
  // button use. A manual lookup can still be in flight when a grant finishes
  // and refreshes: without this, the older answer can land last and show the
  // balance from before the grant, which invites granting it again.
  async function runLookup() {
    const trimmed = email.trim();
    if (trimmed === '') return;
    const gate = lookups.current;
    gate.supersede();
    const current = gate.begin();
    setLookup({ phase: 'loading' });
    const result = await lookupAdminUser(trimmed);
    if (!current()) return;
    setLookup(
      result.ok
        ? {
            phase: 'found',
            userId: result.userId,
            spendableCreditMicroUsd: result.spendableCreditMicroUsd,
            grants: result.grants,
          }
        : { phase: 'failed', error: result.error },
    );
  }

  /**
   * A balance, a grant history and a result are all statements about one
   * address. The moment the field names a different one they are about
   * somebody else, and leaving them up puts one user's credit beside a form
   * that will pay another. The in-flight lookup is superseded with them, so
   * an answer for the address just abandoned cannot arrive and re-attach
   * itself to this one.
   */
  function changeEmail(next: string) {
    setEmail(next);
    if (next.trim() === email.trim()) return;
    lookups.current.supersede();
    setLookup({ phase: 'idle' });
    setGrant((previous) =>
      previous.phase === 'granting' ? previous : { phase: 'idle' },
    );
  }

  async function submitGrant(event: { preventDefault(): void }) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const cents = Math.round(Number(amount) * 100);
    if (trimmedEmail === '' || !Number.isFinite(cents) || cents <= 0) {
      setGrant({
        phase: 'failed',
        error: 'Enter the user’s email and a positive dollar amount.',
      });
      return;
    }
    setGrant({ phase: 'granting' });
    try {
      const result = await grantAdminCredit(
        trimmedEmail,
        cents,
        note.trim() || null,
      );
      if (!result.ok) {
        setGrant({ phase: 'failed', error: result.error });
        return;
      }
      // The route says what it did and who it did it to. Saying it back is
      // the only confirmation the grant landed: the refresh below is not
      // one, because a refresh that fails would then read as a grant that
      // failed, and the answer to a grant that looks like it failed is to
      // make it again.
      setGrant({
        phase: 'granted',
        userId: result.userId,
        creditUsdCents: result.creditUsdCents,
      });
      setAmount('');
      setNote('');
      // Refresh the balance shown so the grant that was just made is
      // reflected immediately, not only on the next manual lookup.
      await runLookup();
    } catch (error) {
      setGrant({
        phase: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'The credit could not be granted.',
      });
    }
  }

  return (
    <details
      className="knowledge"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="knowledge__summary">
        Admin: grant credit
        <span className="pill pill--on">admin</span>
      </summary>

      <label className="prompt__label" htmlFor={emailId}>
        User&apos;s email
      </label>
      <div className="prompt__row">
        <input
          id={emailId}
          type="email"
          className="prompt__input"
          placeholder="user@example.com"
          value={email}
          onChange={(event) => changeEmail(event.target.value)}
        />
        <button
          type="button"
          className="button"
          onClick={() => void runLookup()}
          disabled={lookup.phase === 'loading' || email.trim() === ''}
        >
          {lookup.phase === 'loading' ? 'Looking up…' : 'Look up'}
        </button>
      </div>

      {lookup.phase === 'found' ? (
        <p className="pane-note">
          {lookup.userId} has {formatUsd(lookup.spendableCreditMicroUsd)}{' '}
          spendable credit.
          {lookup.grants.length > 0 ? (
            <>
              {' '}
              Past grants:{' '}
              {lookup.grants
                .map(
                  (g) =>
                    `${formatUsd(g.creditUsdCents * 10_000)} by ${g.grantedByEmail}${g.note ? ` (${g.note})` : ''}`,
                )
                .join('; ')}
            </>
          ) : null}
        </p>
      ) : null}
      {lookup.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {lookup.error}
        </p>
      ) : null}

      <form onSubmit={(event) => void submitGrant(event)}>
        <label className="prompt__label" htmlFor={amountId}>
          Amount to grant (USD)
        </label>
        <input
          id={amountId}
          type="number"
          min="0.01"
          step="0.01"
          className="prompt__input"
          placeholder="5.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <label className="prompt__label" htmlFor={noteId}>
          Note (optional)
        </label>
        <input
          id={noteId}
          type="text"
          className="prompt__input"
          placeholder="Refund for the outage on the 12th"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="prompt__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={grant.phase === 'granting'}
          >
            {grant.phase === 'granting' ? 'Granting…' : 'Grant credit'}
          </button>
        </div>
      </form>
      {grant.phase === 'granted' ? (
        <p className="pane-note" role="status">
          Granted {formatUsd(grant.creditUsdCents * 10_000)} to {grant.userId}.
        </p>
      ) : null}
      {grant.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {grant.error}
        </p>
      ) : null}
    </details>
  );
}
