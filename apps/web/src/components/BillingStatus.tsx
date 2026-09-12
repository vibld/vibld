import { Show } from '@clerk/react';
import { useEffect, useId, useState } from 'react';
import {
  TIER_LABELS,
  fetchBillingStatus,
  formatUsd,
  openBillingPortal,
  startCheckout,
} from '../billing/billing-client.ts';
import type { BillingStatus, Tier } from '../billing/billing-client.ts';
import { clerkConfigured } from '../auth/clerk-token.ts';

/**
 * The header's billing affordance: this caller's tier and usage, a picker to
 * upgrade off the free tier, and buttons for the two things Stripe already
 * hosts for us (docs/decisions.md L12) -- the Checkout page and the Billing
 * Portal. `/api/billing/*` has worked since it shipped; nothing in the shell
 * called it until now.
 *
 * Wrapped in `Show when="signed-in"` the same way `AuthStatus` is: mounting
 * only while signed in means a fresh mount is always a fresh fetch, so
 * there is no separate re-fetch-on-sign-in wiring to keep in step with it.
 */
export function BillingStatusWidget() {
  if (!clerkConfigured) return null;
  return (
    <Show when="signed-in">
      <BillingStatusPanel />
    </Show>
  );
}

const UPGRADE_TIERS: readonly Tier[] = ['build', 'ship'];

function BillingStatusPanel() {
  const fieldId = useId();
  const [status, setStatus] = useState<BillingStatus | null | 'loading'>(
    'loading',
  );
  const [tierChoice, setTierChoice] = useState<'build' | 'ship'>('build');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchBillingStatus().then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        {formatUsd(status.allowanceMicroUsd)} this month
        {status.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
      </p>

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

      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
