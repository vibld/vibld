import { useEffect, useId, useState } from 'react';
import {
  inviteState,
  issueInvite,
  listInvites,
  revokeInvite,
} from '../access/invite-client.ts';
import type { InviteRecord } from '../access/invite-client.ts';

/**
 * The invite list, and the two acts that change it.
 *
 * The gate ships closed, so until this existed the only way to let anybody
 * in was to hand-craft an authenticated POST. That is the same mistake the
 * refusal screen was reviewed for twice, the other way round: an endpoint
 * nobody can press is not a way in either.
 *
 * Rendered only when `state.isAdmin` is true (`App.tsx`), which is a
 * convenience and not the boundary: `/api/admin/*` re-checks admin
 * membership on every call (ADR-0006), so this component never trusts its
 * own visibility as an access control.
 */
export function InvitePanel() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [invites, setInvites] = useState<InviteRecord[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * Bumped after every act that changed the list, and nothing else.
   *
   * A counter rather than the message below, which was the first version of
   * this: withdrawing the same address twice produces the same sentence, so
   * the effect would not re-run and the list would sit there stale looking
   * exactly like a list that had refreshed.
   */
  const [version, setVersion] = useState(0);
  const emailId = useId();

  // Loaded when the panel is opened rather than on mount: an admin has this
  // in their shell on every page and reads it occasionally.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void listInvites().then((result) => {
      if (!live) return;
      if (result.ok) {
        setInvites(result.invites);
        setTruncated(result.truncated);
        setLoadError(null);
      } else {
        // The rows already shown are left alone. Clearing them on a failed
        // refresh reads as an empty invite list, which is a different and
        // much more alarming claim than "this could not be reloaded".
        setLoadError(result.error);
      }
    });
    return () => {
      live = false;
    };
  }, [open, version]);

  /** Invite an address, from the field or from a withdrawn row. */
  async function invite(address: string) {
    const trimmed = address.trim();
    if (trimmed === '') return;
    setBusy(true);
    setFailure(null);
    const result = await issueInvite(trimmed);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    // Three outcomes, said apart. "Already invited" reported as success is
    // how somebody concludes they have just let a person in when the list
    // has said so since last week.
    setNote(
      result.created
        ? `Invited ${result.email}.`
        : result.reinstated
          ? `Put ${result.email}'s withdrawn invite back.`
          : `${result.email} was already invited. Nothing changed.`,
    );
    if (result.created || result.reinstated) {
      setVersion((n) => n + 1);
      // Compared against the value now, not the one this closure was born
      // with. Those are the same on the render that started the request and
      // different by the time it answers if the operator has typed the next
      // address, and clearing then takes away what they are in the middle
      // of writing.
      setEmail((current) => (current.trim() === trimmed ? '' : current));
    }
  }

  async function withdraw(address: string) {
    setBusy(true);
    setFailure(null);
    const result = await revokeInvite(address);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setNote(
      result.revoked
        ? `Withdrew ${result.email}'s invite.`
        : `${result.email} had no invite to withdraw.`,
    );
    if (result.revoked) setVersion((n) => n + 1);
  }

  return (
    <details
      className="knowledge"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="knowledge__summary">
        Admin: invites
        <span className="pill pill--on">admin</span>
      </summary>

      <label className="prompt__label" htmlFor={emailId}>
        Invite an email address
      </label>
      <div className="prompt__row">
        <input
          id={emailId}
          type="email"
          className="prompt__input"
          placeholder="someone@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="button"
          className="button button--primary"
          onClick={() => void invite(email)}
          disabled={busy || email.trim() === ''}
        >
          {busy ? 'Working…' : 'Invite'}
        </button>
        {/*
          Withdrawing from the field as well as from a row, because the rows
          are capped and an invite past the cap would otherwise have no
          control at all. It acts on the address typed, which is the same
          thing the route takes, so a list too long to show is not a list too
          long to administer.
        */}
        <button
          type="button"
          className="button"
          onClick={() => void withdraw(email)}
          disabled={busy || email.trim() === ''}
        >
          Withdraw
        </button>
      </div>

      {note ? (
        <p className="pane-note" role="status">
          {note}
        </p>
      ) : null}
      {failure ? (
        <p className="pane-note pane-note--error" role="alert">
          {failure}
        </p>
      ) : null}
      {loadError ? (
        <p className="pane-note pane-note--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {truncated ? (
        <p className="pane-note" role="status">
          There are more invites than are shown. Type an address above to invite
          or withdraw it, whether or not it appears below.
        </p>
      ) : null}

      {invites === null ? null : invites.length === 0 ? (
        <p className="pane-note">Nobody has been invited yet.</p>
      ) : (
        <ul className="invites">
          {invites.map((record) => {
            const state = inviteState(record);
            const withdrawn = state === 'withdrawn';
            return (
              <li key={record.email} className="pane-note invites__row">
                <span className="invites__email">{record.email}</span>
                <span className={state === 'in' ? 'pill pill--on' : 'pill'}>
                  {state}
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void (withdrawn
                      ? invite(record.email)
                      : withdraw(record.email))
                  }
                >
                  {withdrawn ? 'Invite again' : 'Withdraw'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
