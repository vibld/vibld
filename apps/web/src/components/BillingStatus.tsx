import { useEffect, useId, useState } from 'react';
import {
  TIER_LABELS,
  describeGift,
  fetchBillingStatus,
  formatUsd,
  openBillingPortal,
  openCancelPlan,
  startCheckout,
} from '../billing/billing-client.ts';
import type { BillingStatus, Tier } from '../billing/billing-client.ts';
import { SignedIn } from '../auth/clerk.tsx';
import { signInConfigured } from '../auth/mode.ts';
import { SignupCreditOffer } from './SignupCreditOffer.tsx';
import { AutoReload } from './AutoReload.tsx';
import { AutoSubscribe } from './AutoSubscribe.tsx';

/**
 * The header's billing affordance: this caller's tier and usage, a picker to
 * upgrade off the free tier, and buttons for the things Stripe already
 * hosts for us (docs/decisions.md L12) -- the Checkout page, the Billing
 * Portal, and the portal's cancel page opened directly. `/api/billing/*` has
 * worked since it shipped; nothing in the shell called it until now.
 *
 * Wrapped in `SignedIn`, which is Clerk's `Show` under Clerk (D123): mounting
 * only while signed in means a fresh mount is always a fresh fetch, so
 * there is no separate re-fetch-on-sign-in wiring to keep in step with it.
 */
export function BillingStatusWidget() {
  if (!signInConfigured) return null;
  return (
    <SignedIn>
      <BillingStatusPanel />
    </SignedIn>
  );
}

const UPGRADE_TIERS: readonly Tier[] = ['build', 'ship'];

/** The signed-in half, exported so it can be mounted on its own. */
export function BillingStatusPanel() {
  const fieldId = useId();
  const [status, setStatus] = useState<BillingStatus | null | 'loading'>(
    'loading',
  );
  const [tierChoice, setTierChoice] = useState<'build' | 'ship'>('build');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Bumped to read the status again, after auto-reload is changed.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetchBillingStatus().then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, [reads]);

  // Nothing to show yet, nothing this deployment can answer, or a session
  // this widget's own fetch found already expired -- all the same "render
  // nothing" to a caller who never asked for this in the first place.
  if (status === 'loading' || status === null || !status.billingConfigured) {
    return null;
  }

  async function redirect(action: () => Promise<string>) {
    setProblem(null);
    setPending(true);
    try {
      window.location.href = await action();
    } catch (error) {
      setPending(false);
      setProblem(
        error instanceof Error
          ? error.message
          : 'The billing request failed. Try again shortly.',
      );
    }
  }

  return (
    <div className="billing">
      <p className="billing__usage">
        {TIER_LABELS[status.tier]} · {formatUsd(status.spentMicroUsd)} /{' '}
        {formatUsd(status.allowanceMicroUsd)}{' '}
        {status.freeTrial ? 'trial' : 'this month'}
        {/*
         * Credit is spendable money this readout used to drop on the floor.
         * `reserveBudget` falls through to it automatically once the monthly
         * allowance is exhausted, so a line that stops at the allowance says
         * somebody is finished for the month when they are not, and it never
         * shows back the balance they paid for or were granted (L4, and the
         * dollar a new account gets for adding a card). The route has always sent
         * it; only the screen was missing.
         */}
        {status.topupRemainingMicroUsd > 0
          ? ` · ${formatUsd(status.topupRemainingMicroUsd)} credit`
          : ''}
        {status.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
      </p>

      {/*
       * A plan an admin gave, and until when (D73): the tier above can be
       * one nobody is paying for, and it ends on its own.
       */}
      {describeGift(status) ? (
        <p className="pane-note" role="status">
          {describeGift(status)}
        </p>
      ) : null}

      {/*
       * Said here as well as on the refusal, because the refusal only
       * arrives once somebody has typed a prompt and pressed build.
       */}
      {status.suspended ? (
        <p className="pane-note pane-note--error" role="alert">
          This account is suspended because a payment on it was disputed and the
          dispute was lost. Email billing@vibld.com to resolve it.
        </p>
      ) : null}

      <SignupCreditOffer status={status} />

      {status.tier === 'free' ? (
        <div className="billing__upgrade">
          <label className="visually-hidden" htmlFor={fieldId}>
            Tier to upgrade to
          </label>
          <select
            id={fieldId}
            className="models__select"
            value={tierChoice}
            disabled={pending}
            onChange={(event) =>
              setTierChoice(event.target.value as 'build' | 'ship')
            }
          >
            {UPGRADE_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {TIER_LABELS[tier]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--primary"
            disabled={pending}
            onClick={() =>
              void redirect(() =>
                startCheckout({
                  kind: 'subscription',
                  tier: tierChoice,
                  interval: 'monthly',
                }),
              )
            }
          >
            Upgrade
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="chip"
        disabled={pending}
        onClick={() => void redirect(() => startCheckout({ kind: 'topup' }))}
      >
        Buy top-up
      </button>

      {/*
       * A suspended account is not offered auto-reload, but one that has it
       * on keeps the switch to turn it off: lifted later, the suspension
       * would otherwise charge the card before it had any way to opt out.
       */}
      {/*
       * Auto-subscribe (D167) is offered to an account on Free. One that has
       * it on keeps the switch to turn it off, as above, while suspended or
       * on another plan: that plan ending would otherwise start Build before
       * it had any way to opt out.
       */}
      {status.autoSubscribe &&
      ((status.tier === 'free' && !status.suspended) ||
        status.autoSubscribe.enabled) ? (
        <AutoSubscribe
          status={status.autoSubscribe}
          offOnly={status.suspended || status.tier !== 'free'}
          onChanged={() => setReads((n) => n + 1)}
          setAction={(action) => void redirect(action)}
        />
      ) : null}

      {status.autoReload && (!status.suspended || status.autoReload.enabled) ? (
        <AutoReload
          status={status.autoReload}
          offOnly={status.suspended}
          onChanged={() => setReads((n) => n + 1)}
          setAction={(action) => void redirect(action)}
        />
      ) : null}

      {status.hasStripeCustomer ? (
        <button
          type="button"
          className="chip"
          disabled={pending}
          onClick={() => void redirect(() => openBillingPortal())}
        >
          Manage billing
        </button>
      ) : null}

      {/*
       * Only for a plan that is live and not already ending. `planTier` is
       * what the status route reads from an active subscription, so "free"
       * means there is nothing here to cancel (a gifted plan is not one),
       * and a plan already set to
       * end says so in the readout above and is managed from the portal.
       * Cancelling goes through vibld rather than the portal's own page so
       * that a monthly plan is offered its retention coupon and an annual
       * one is not (`/api/billing/cancel`).
       */}
      {(status.planTier ?? status.tier) !== 'free' &&
      !status.cancelAtPeriodEnd ? (
        <button
          type="button"
          className="chip"
          disabled={pending}
          onClick={() => void redirect(() => openCancelPlan())}
        >
          Cancel plan
        </button>
      ) : null}

      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
