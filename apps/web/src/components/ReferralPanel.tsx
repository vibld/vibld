import { useEffect, useId, useRef, useState } from 'react';
import { SignedIn } from '../auth/clerk.tsx';
import { signInConfigured } from '../auth/mode.ts';
import {
  capNotice,
  claimStoredReferral,
  fetchReferralStatus,
  progressSummary,
  referralStorage,
  rewardSentence,
} from '../referral/referral-client.ts';
import type { ReferralStatus } from '../referral/referral-client.ts';

/**
 * "Refer a friend", in the settings menu under Plan and usage.
 *
 * The Worker has issued codes and paid referrals since 2026-09-16, and
 * nothing on screen ever showed anybody their code, so the program existed
 * only for people who could read the API. This shows the link, copies it,
 * says what it earns from the Worker's own figures, and how it is going.
 *
 * The whole section, heading included, renders nothing until the status
 * arrives and nothing at all if it never does, so a deployment without
 * referrals shows no empty heading.
 */
export function ReferralSection() {
  // Without sign-in configured the Worker refuses the status request, so
  // the fetch below answers null and the section stays empty all the same.
  if (!signInConfigured) return <ReferralFetched />;
  return (
    <SignedIn>
      <ReferralFetched />
    </SignedIn>
  );
}

function ReferralFetched() {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  useEffect(() => {
    let live = true;
    void fetchReferralStatus().then((result) => {
      if (live) setStatus(result);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!status) return null;
  return (
    <section className="settings__section">
      <h2 className="settings__heading">Refer a friend</h2>
      <ReferralPanel status={status} />
    </section>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

/** The browser clipboard, failing loudly where there is none to use. */
async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('No clipboard here.');
  await navigator.clipboard.writeText(text);
}

/**
 * The panel itself, told the status rather than fetching it, so a test can
 * drive every state without a Worker.
 */
export function ReferralPanel({
  status,
  copy = writeClipboard,
}: {
  status: ReferralStatus;
  /** A prop for the reason `SignupCreditOffer` takes `start`: testability. */
  copy?: (text: string) => Promise<void>;
}) {
  const fieldId = useId();
  const field = useRef<HTMLInputElement | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const cap = capNotice(status);

  async function copyLink() {
    try {
      await copy(status.url);
      setCopyState('copied');
    } catch {
      // Clipboard access is refused outside a secure context, by some
      // browsers without a recent gesture, and by permission settings. The
      // link is already on screen in a field, so selecting it leaves one
      // keystroke between the reader and a copy.
      setCopyState('failed');
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div className="referral">
      <p className="settings__note">{rewardSentence(status)}</p>
      <div className="referral__link">
        <label className="visually-hidden" htmlFor={fieldId}>
          Your referral link
        </label>
        {/*
          A read-only field rather than text, so the fallback for a refused
          clipboard is the browser's own selection. `value` is set as a
          property, never parsed as markup.
        */}
        <input
          id={fieldId}
          ref={field}
          className="models__select referral__url"
          type="text"
          readOnly
          value={status.url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="chip" onClick={() => void copyLink()}>
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyState === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          Couldn&apos;t copy the link. It&apos;s selected above, so copy it with
          Ctrl+C or ⌘C.
        </p>
      ) : null}
      {/* Announces a successful copy, which otherwise changes one word. */}
      <span className="visually-hidden" role="status">
        {copyState === 'copied' ? 'Link copied.' : ''}
      </span>
      <p className="referral__progress">{progressSummary(status)}</p>
      {cap ? <p className="settings__note">{cap}</p> : null}
    </div>
  );
}

/**
 * Claims the code this browser arrived with, once the account is signed in.
 *
 * Mounted inside the signed-in builder, so by the time it runs there is a
 * session to claim for. One attempt per page load; `claimStoredReferral`
 * keeps the code for the next load if this one got no answer, and every
 * refusal is silent.
 */
export function ReferralClaim() {
  useEffect(() => {
    if (!signInConfigured) return;
    void claimOnce();
  }, []);
  return null;
}

// Module-level rather than a ref: React runs a mount effect twice in
// development, and two claims racing for one code is one claim too many.
let claiming: Promise<unknown> | null = null;

function claimOnce(): Promise<unknown> {
  claiming ??= claimStoredReferral(referralStorage());
  return claiming;
}
