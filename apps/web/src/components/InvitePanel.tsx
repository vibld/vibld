import { useEffect, useId, useState } from 'react';
import {
  inviteState,
  issueInvite,
  listInvites,
  revokeInvite,
} from '../access/invite-client.ts';
import type {
  BillingOutcome,
  ClerkOutcome,
  InviteRecord,
} from '../access/invite-client.ts';

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
/**
 * What to add about Clerk, given what Clerk said.
 *
 * Four answers rather than two, because "not approved" covers three quite
 * different situations and only one of them is worth trying again. Clerk
 * saying the person is still waiting is an answer, not a failure.
 *
 * Empty only when Clerk was deliberately not asked, which is the case when
 * the invite row did not change. An answer that could not be read is not
 * that, and gets a sentence of its own.
 */
/**
 * What happened to a withdrawn person's money, in one sentence.
 *
 * Separate from whether their access went, and said next to it, because
 * revoking used to do only the first and an operator had no way to learn
 * that the second had not happened. A subscriber who was revoked kept being
 * charged every month for a product they could no longer sign in to.
 *
 * "Ends" rather than "cancelled" throughout: nothing has stopped yet. The
 * date is the point of the whole decision, so it is the thing the sentence
 * leads with wherever it is known.
 */
export function billingSentence(billing: BillingOutcome | null): string {
  // Unreadable is not the same as nothing to do. An operator told nothing
  // concludes the billing was handled.
  if (billing === null) {
    return ' What happened to any subscription is not known, so check Stripe before assuming the charges stopped.';
  }
  if (billing.scheduled) {
    return billing.endsAt
      ? ` Their subscription is set to end on ${onDay(billing.endsAt)}, and they are not charged again.`
      : ' Their subscription is set to end when the period they paid for does, and they are not charged again.';
  }
  if (billing.reason === 'already-ending') {
    return billing.endsAt
      ? ` Their subscription was already ending on ${onDay(billing.endsAt)}.`
      : ' Their subscription was already set to end.';
  }
  if (billing.reason === 'nothing-to-stop') {
    return ' They had no live subscription, so there was nothing to stop.';
  }
  if (billing.reason === 'never-signed-in') {
    return ' Nobody ever signed in with that invite, so there is no billing.';
  }
  if (billing.reason === 'unconfigured') {
    return ' Stripe is not set up on this deployment, so cancel any subscription there yourself.';
  }
  return ` Stripe could not be asked (${billing.error ?? 'no reason given'}), so check there whether they are still being charged.`;
}

/** A date an operator can read, falling back to the raw value it cannot. */
function onDay(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? iso
    : when.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
}

export function clerkSentence(clerk: ClerkOutcome | null): string {
  // No readable answer is a gap, not a silence. A response that does not
  // mention Clerk is one this deployment cannot vouch for, and an operator
  // who is told nothing concludes the invite was the whole job.
  if (clerk === null) {
    return ' Whether Clerk approved them is not known, so check there or they may not be able to sign in.';
  }
  if (clerk.admitted) return ' Approved in Clerk, so they can sign in.';
  if (clerk.reason === 'unconfigured') {
    return ' Clerk approval is not set up on this deployment, so approve them in Clerk or they cannot sign in.';
  }
  if (clerk.reason === 'still-waiting') {
    // Two different situations, and only one of them is a claim this
    // deployment can make. When Clerk took the invitation and still lists
    // the person as waiting, the two answers disagree and which one governs
    // is undocumented, so the honest thing is to send somebody to look
    // rather than to pick. When Clerk took nothing, they are plainly not in.
    return clerk.invited
      ? ` Clerk took the invitation and still lists them as ${clerk.status}, so check in Clerk whether they can sign in.`
      : ` Clerk still has them ${clerk.status}, so they cannot sign in yet. Approve them in Clerk.`;
  }
  return ` Clerk could not be asked (${clerk.error}), so check whether they are approved there.`;
}

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
    // Three outcomes here, said apart. "Already invited" reported as success
    // is how somebody concludes they have just let a person in when the list
    // has said so since last week.
    //
    // And letting somebody in takes both halves. Clerk is in Waitlist mode,
    // so a row here gets them past the access gate and Clerk decides whether
    // they can create a session at all. The deployment now asks Clerk as
    // well, and what it reports is Clerk's own answer read back afterwards
    // rather than the fact that a request was sent: "they can sign in" is
    // the claim that matters and the one worth being sure of.
    const here = result.created
      ? `${result.email} is on the invite list.`
      : result.reinstated
        ? `Put ${result.email}'s withdrawn invite back.`
        : `${result.email} was already invited. Nothing changed.`;
    setNote(`${here}${clerkSentence(result.clerk)}`);
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
    const here = result.revoked
      ? `Withdrew ${result.email}'s invite.`
      : `${result.email} had no invite to withdraw.`;
    setNote(`${here}${billingSentence(result.billing)}`);
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

      {/*
        Standing, not per-action, because it is true of the list rather than
        of the last thing pressed. Two systems have to agree before somebody
        can use the product: Clerk decides whether they can sign in at all,
        this list decides whether signing in gets them anywhere.

        It used to end "approve people in Clerk as well", which was true
        until inviting started doing that. Left as it was, every successful
        approval sat directly above a standing instruction to go and do the
        thing that had just been done, which is how somebody revokes and
        reissues an invitation that was already working. It describes what
        inviting attempts now, and the link stays for the outcomes where
        somebody does have to go and look, which the sentence under each
        invite names.
      */}
      <p className="pane-note">
        Sign-in is waitlisted in Clerk, so this list is half of it. Inviting
        somebody here asks Clerk to approve them too, and says what Clerk
        answered. When it could not, approve them at{' '}
        <a
          href="https://dashboard.clerk.com/~/users/waitlist"
          rel="noopener noreferrer"
          target="_blank"
        >
          the Clerk waitlist
        </a>
        .
      </p>

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
