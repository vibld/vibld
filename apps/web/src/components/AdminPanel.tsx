import { useId, useRef, useState } from 'react';
import {
  grantAdminCredit,
  lookupAdminUser,
} from '../generation/admin-client.ts';
import type {
  AdminGrant,
  AdminUserResult,
} from '../generation/admin-client.ts';
import { createStatusGate } from '../github/panel-view.ts';

type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'found';
      userId: string;
      spendableCreditMicroUsd: number;
      grants: AdminGrant[];
      unreadable: number;
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
  /**
   * `address` is the one the refusal is about, `null` when the form was
   * refused here rather than by the route. A message comes back worded by
   * the route and may name an address inside it, so a refusal that arrives
   * after the field moved on has to say whose it is: without that, "No user
   * found for alice@example.com." sits under a form aimed at bob and reads
   * as a verdict on bob.
   */
  | { phase: 'failed'; address: string | null; error: string };

function formatUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
  /**
   * The address the field names *now*. A keystroke during a request leaves
   * every closure started before it holding the address from then, and the
   * gate cannot tell the two apart: a read begun after the change is the
   * newest read, whoever it is about.
   */
  const address = useRef('');
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
    let result: AdminUserResult;
    try {
      result = await lookupAdminUser(trimmed);
    } catch (error) {
      // `lookupAdminUser` returns a refusal but throws a transport failure,
      // so without this the button sits on "Looking up..." for the rest of
      // the page's life and the rejection goes unhandled.
      if (current()) {
        setLookup({
          phase: 'failed',
          error: messageFor(error, 'The lookup could not be made.'),
        });
      }
      return;
    }
    if (!current()) return;
    setLookup(
      result.ok
        ? {
            phase: 'found',
            userId: result.userId,
            spendableCreditMicroUsd: result.spendableCreditMicroUsd,
            grants: result.grants,
            unreadable: result.unreadable,
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
    address.current = next;
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
        address: null,
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
        setGrant({
          phase: 'failed',
          address: trimmedEmail,
          error: result.error,
        });
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
    } catch (error) {
      setGrant({
        phase: 'failed',
        address: trimmedEmail,
        error: messageFor(error, 'The credit could not be granted.'),
      });
      return;
    }
    // Outside the grant's own `try` on purpose. The refresh is a second
    // request, and nothing that happens to it says anything about the grant
    // that already landed: inside, a rejection reached the catch above and
    // replaced the confirmation with a failure, which is the reading that
    // gets a grant made twice. It is safe to await unguarded because
    // `runLookup` now reports its own failure rather than throwing.
    //
    // Emptying the form and refreshing are both "ready for the next grant to
    // this user", so both wait on the field still naming the one that was
    // credited. If a keystroke moved it on while the grant was in flight,
    // refreshing would put that user's balance and history back beside a
    // form aimed at somebody else, which is exactly what `changeEmail`
    // clears them to prevent, and emptying would take away what is being
    // typed for the next one. The confirmation above already names who was
    // credited and how much, so nothing is lost by not asking again.
    if (address.current.trim() !== trimmedEmail) return;
    setAmount('');
    setNote('');
    await runLookup();
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
      {/*
        A row the history holds and this page cannot read. Said out loud
        rather than dropped: this list is read to decide whether an earlier
        grant already landed, and a silently shorter one is how the same
        person gets paid twice. It is not an error either, because the
        balance above is still the ledger's own total and includes it.
      */}
      {lookup.phase === 'found' && lookup.unreadable > 0 ? (
        <p className="pane-note pane-note--error" role="alert">
          {lookup.unreadable} past grant
          {lookup.unreadable === 1 ? '' : 's'} could not be read, so{' '}
          {lookup.unreadable === 1 ? 'it is' : 'they are'} missing from the list
          above. The balance still counts{' '}
          {lookup.unreadable === 1 ? 'it' : 'them'}.
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
          {grant.address ? `Granting to ${grant.address} failed. ` : ''}
          {grant.error}
        </p>
      ) : null}
    </details>
  );
}
