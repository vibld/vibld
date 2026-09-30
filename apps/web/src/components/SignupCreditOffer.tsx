import { useEffect, useState } from 'react';
import {
  fetchBillingStatus,
  signupCreditPrompt,
  startCardSetup,
} from '../billing/billing-client.ts';
import type { BillingStatus } from '../billing/billing-client.ts';
import { SignedIn } from '../auth/clerk.tsx';
import { signInConfigured } from '../auth/mode.ts';

/**
 * The welcome credit, as somebody new to the builder meets it.
 *
 * Since 2026-09-27 the credit waits for a card on file rather than arriving
 * with the account, so a new account starts with none of it and nothing
 * would tell them why. This says what to do and offers the one button that
 * does it: a Stripe-hosted page that saves a card and charges nothing.
 *
 * Presentational, and told the status rather than fetching it, so the
 * settings panel can show it from the status it already has and a test can
 * drive every state without a Worker.
 */
export function SignupCreditOffer({
  status,
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
  start = startCardSetup,
}: {
  status: BillingStatus;
  pathname?: string;
  /** A prop for the reason `AccessGate` takes `signOut` as one: testability. */
  start?: () => Promise<string>;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const prompt = signupCreditPrompt(status, pathname);
  if (!prompt) return null;

  async function addCard() {
    setProblem(null);
    setPending(true);
    try {
      window.location.href = await start();
    } catch (error) {
      setPending(false);
      setProblem(
        error instanceof Error
          ? error.message
          : 'Could not open the card form. Try again shortly.',
      );
    }
  }

  return (
    <div className="banner banner--info signup-credit" role="status">
      <p className="banner__message">{prompt.message}</p>
      {/*
        No button while a saved card is being confirmed. A second press
        would only save a second card, which pays nothing more.
      */}
      {prompt.kind === 'pending' ? null : (
        <button
          type="button"
          className="button button--primary"
          disabled={pending}
          onClick={() => void addCard()}
        >
          {prompt.kind === 'card-used' ? 'Add a different card' : 'Add a card'}
        </button>
      )}
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The offer above the composer, where somebody new is looking, rather than
 * only in the settings menu, where they are not. It asks for the status
 * itself; renders nothing until it has one, and nothing at all for an
 * account the offer does not apply to.
 */
export function SignupCreditBanner() {
  if (!signInConfigured) return null;
  return (
    <SignedIn>
      <SignupCreditFetched />
    </SignedIn>
  );
}

function SignupCreditFetched() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  useEffect(() => {
    let live = true;
    void fetchBillingStatus().then((result) => {
      if (live) setStatus(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return status ? <SignupCreditOffer status={status} /> : null;
}
