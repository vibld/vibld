import { useEffect, useState } from 'react';
import { formatUsd } from '../admin/admin-users-client.ts';
import {
  OVERVIEW_WINDOWS,
  describeBalance,
  fetchOverview,
  formatCents,
  formatRate,
  formatShortDay,
} from '../admin/overview-client.ts';
import type { Overview } from '../admin/overview-client.ts';
import { ADMIN_PATH, adminPageView } from '../admin/route.ts';
import { AdminLink } from './AdminAccountList.tsx';

/**
 * How the platform is doing, for a platform admin (docs/decisions.md
 * D128): sign-ups, who is active, builds and how they end, model spend
 * against money taken, and the providers' balances, over the last 7, 30
 * or 90 days.
 *
 * Nothing here is a permission. The route checks the caller is a platform
 * admin itself (ADR-0006); this decides what to draw.
 */
export function AdminOverview({ isAdmin }: { isAdmin: boolean | null }) {
  const view = adminPageView(isAdmin);
  if (view === 'checking') {
    return (
      <section className="adminpage" aria-label="Overview">
        <p className="pane-note" role="status">
          Checking your access.
        </p>
      </section>
    );
  }
  if (view === 'denied') {
    return (
      <section className="adminpage" aria-label="Overview">
        <h1 className="adminpage__title">Nothing here</h1>
        <p className="pane-note">This page is not part of your account.</p>
      </section>
    );
  }
  return <OverviewView />;
}

type Load =
  | { phase: 'loading' }
  | { phase: 'failed'; error: string }
  | { phase: 'ready'; overview: Overview };

function OverviewView() {
  const [days, setDays] = useState<number>(30);
  const [load, setLoad] = useState<Load>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    setLoad({ phase: 'loading' });
    void fetchOverview(days).then((result) => {
      if (!live) return;
      setLoad(
        result.ok
          ? { phase: 'ready', overview: result.value }
          : { phase: 'failed', error: result.error },
      );
    });
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <section className="adminpage adminpage--wide" aria-label="Overview">
      <div className="adminpage__head">
        <div>
          <h1 className="adminpage__title">Overview</h1>
          <p className="pane-note">
            {load.phase === 'ready'
              ? `${formatShortDay(load.overview.from)} to ${formatShortDay(load.overview.to)}, by UTC day.`
              : 'By UTC day.'}
          </p>
        </div>
        <AdminLink href={ADMIN_PATH} className="adminpage__back">
          Back to admin
        </AdminLink>
      </div>

      <div className="prompt__actions" role="group" aria-label="Window">
        {OVERVIEW_WINDOWS.map((window) => (
          <button
            key={window}
            type="button"
            className={window === days ? 'button button--primary' : 'button'}
            aria-pressed={window === days}
            onClick={() => setDays(window)}
          >
            {window} days
          </button>
        ))}
      </div>

      {load.phase === 'loading' ? (
        <p className="pane-note" role="status">
          Loading the overview.
        </p>
      ) : null}
      {load.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {load.error}
        </p>
      ) : null}
      {load.phase === 'ready' ? <Figures overview={load.overview} /> : null}
    </section>
  );
}

function Figures({ overview }: { overview: Overview }) {
  const { totals, accounts } = overview;
  const net = totals.revenueUsdCents - totals.refundedUsdCents;
  return (
    <div className="adminpage__tools">
      <div className="knowledge" role="group" aria-label="Totals">
        <p className="knowledge__summary">Over the window</p>
        <ul className="pane-note">
          <li>
            Sign-ups: {totals.signups}. People who built: {totals.builders}.
          </li>
          <li>
            Builds: {totals.builds} ({totals.accepted} accepted, {totals.failed}{' '}
            failed, {totals.cancelled} canceled). Failure rate:{' '}
            {formatRate(totals.failureRate)}.
          </li>
          <li>
            Model spend: {formatUsd(totals.spendMicroUsd)}. Taken:{' '}
            {formatCents(totals.revenueUsdCents)}, refunded{' '}
            {formatCents(totals.refundedUsdCents)}, net {formatCents(net)}.
          </li>
          <li>
            Accounts: {accounts.total}. Seen in the last day {accounts.seen1d},
            week {accounts.seen7d}, 30 days {accounts.seen30d}.
          </li>
          <li>Builds not yet ended: {overview.unendedBuilds}.</li>
        </ul>
      </div>

      <div className="knowledge" role="group" aria-label="Provider balances">
        <p className="knowledge__summary">Provider balances</p>
        {overview.balances.length === 0 ? (
          <p className="pane-note">
            No provider key here has a balance to read.
          </p>
        ) : (
          <ul className="pane-note">
            {overview.balances.map((balance) => (
              <li key={balance.provider}>
                {balance.provider}: {describeBalance(balance)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="knowledge" role="group" aria-label="By day">
        <p className="knowledge__summary">By day</p>
        <div className="accounts__scroll">
          <table className="accounts__table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Sign-ups</th>
                <th scope="col">Built</th>
                <th scope="col">Builds</th>
                <th scope="col">Accepted</th>
                <th scope="col">Failed</th>
                <th scope="col">Canceled</th>
                <th scope="col">Spend</th>
                <th scope="col">Taken</th>
                <th scope="col">Refunded</th>
              </tr>
            </thead>
            <tbody>
              {[...overview.days].reverse().map((day) => (
                <tr key={day.day}>
                  <td>{formatShortDay(day.day)}</td>
                  <td>{day.signups}</td>
                  <td>{day.builders}</td>
                  <td>{day.builds}</td>
                  <td>{day.accepted}</td>
                  <td>{day.failed}</td>
                  <td>{day.cancelled}</td>
                  <td>{formatUsd(day.spendMicroUsd)}</td>
                  <td>{formatCents(day.revenueUsdCents)}</td>
                  <td>{formatCents(day.refundedUsdCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
