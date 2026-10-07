import { useState } from 'react';
import {
  autoSubscribeOffReason,
  setAutoSubscribe,
  startAutoReloadCardSetup,
} from '../billing/billing-client.ts';
import type { AutoSubscribeStatus } from '../billing/billing-client.ts';

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Opt-in auto-subscribe (D167): when a Free account runs out, the Build plan
 * is started, monthly, on the saved card, once. Off until it is turned on.
 * A decline turns it off, and the panel says so.
 */
export function AutoSubscribe({
  status,
  onChanged,
  setAction,
  offOnly = false,
  fetchImpl,
}: {
  status: AutoSubscribeStatus;
  /** Re-read the billing status after a change, so the panel says what is true. */
  onChanged: () => void;
  /** Hand a redirect to the panel's own handler, which shows its failures. */
  setAction: (action: () => Promise<string>) => void;
  /** Only turning it off is offered, as to a suspended account. */
  offOnly?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<{
    error: string;
    needsCard: boolean;
  } | null>(null);

  async function save(enabled: boolean) {
    setPending(true);
    setProblem(null);
    const result = await setAutoSubscribe(enabled, fetchImpl).catch(() => ({
      ok: false as const,
      error: 'Could not change auto-subscribe. Try again shortly.',
      needsCard: false,
    }));
    setPending(false);
    if (result.ok) onChanged();
    else setProblem({ error: result.error, needsCard: result.needsCard });
  }

  const offReason = status.enabled
    ? null
    : autoSubscribeOffReason(status.disabledReason);

  // It starts a plan once: after that, an account back on Free is told so
  // rather than offered a switch that would be refused.
  if (status.used && !status.enabled) {
    return (
      <div className="billing__auto-subscribe">
        <p className="pane-note">
          Auto-subscribe already started Build for this account once, and does
          not start it again.
        </p>
      </div>
    );
  }

  return (
    <div className="billing__auto-subscribe">
      <label>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={pending || (offOnly && !status.enabled)}
          onChange={(event) => void save(event.target.checked)}
        />{' '}
        Start Build ({dollars(status.buildMonthlyUsdCents)}/mo) when Free runs
        out
      </label>
      {status.enabled && status.card ? (
        <p className="pane-note">
          Starts on {status.card.brand} ending {status.card.last4}, once.
        </p>
      ) : null}
      {offReason ? (
        <p className="pane-note pane-note--error" role="alert">
          {offReason}
        </p>
      ) : null}
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem.error}{' '}
          {problem.needsCard ? (
            <button
              type="button"
              className="chip"
              onClick={() =>
                setAction(() => startAutoReloadCardSetup(fetchImpl))
              }
            >
              Add a card
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
