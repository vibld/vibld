import { useId, useState } from 'react';
import {
  autoReloadOffReason,
  setAutoReload,
  startAutoReloadCardSetup,
} from '../billing/billing-client.ts';
import type { AutoReloadStatus } from '../billing/billing-client.ts';

/** The caps an account may pick: whole $10 top-ups, from $10 to $100. */
const CAPS_USD_CENTS = [
  1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
];

function dollars(cents: number): string {
  return `$${cents / 100}`;
}

/**
 * Opt-in auto-reload (D166): when what is left to spend drops below $1, the
 * saved card is charged for the $10 top-up, up to the monthly cap chosen
 * here. Off until it is turned on. A decline turns it off, and the panel
 * says so above the one-click top-up, which stays.
 */
export function AutoReload({
  status,
  onChanged,
  setAction,
  offOnly = false,
  fetchImpl,
}: {
  status: AutoReloadStatus;
  /** Re-read the billing status after a change, so the panel says what is true. */
  onChanged: () => void;
  /** Hand a redirect to the panel's own handler, which shows its failures. */
  setAction: (action: () => Promise<string>) => void;
  /** Only turning it off is offered, as to a suspended account. */
  offOnly?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const capId = useId();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<{
    error: string;
    needsCard: boolean;
  } | null>(null);

  async function save(enabled: boolean, monthlyCapUsdCents: number) {
    setPending(true);
    setProblem(null);
    const result = await setAutoReload(
      { enabled, monthlyCapUsdCents },
      fetchImpl,
    ).catch(() => ({
      ok: false as const,
      error: 'Could not change auto-reload. Try again shortly.',
      needsCard: false,
    }));
    setPending(false);
    if (result.ok) onChanged();
    else setProblem({ error: result.error, needsCard: result.needsCard });
  }

  const offReason = status.enabled
    ? null
    : autoReloadOffReason(status.disabledReason);

  return (
    <div className="billing__auto-reload">
      <label>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={pending || (offOnly && !status.enabled)}
          onChange={(event) =>
            void save(event.target.checked, status.monthlyCapUsdCents)
          }
        />{' '}
        Auto-reload $10 when under $1
      </label>{' '}
      <label className="visually-hidden" htmlFor={capId}>
        Most auto-reload may charge a month
      </label>
      <select
        id={capId}
        className="models__select"
        value={status.monthlyCapUsdCents}
        disabled={pending || offOnly}
        onChange={(event) =>
          void save(status.enabled, Number(event.target.value))
        }
      >
        {CAPS_USD_CENTS.map((cents) => (
          <option key={cents} value={cents}>
            up to {dollars(cents)} a month
          </option>
        ))}
      </select>
      {status.enabled && status.card ? (
        <p className="pane-note">
          Charges {status.card.brand} ending {status.card.last4}.{' '}
          {status.reloadsThisMonth > 0
            ? `${dollars(status.reloadsThisMonth * 1000)} reloaded this month.`
            : ''}
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
