import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_FILTERS,
  describeExport,
  describeRange,
  describeSpend,
  describeStatus,
  fetchAccountList,
  fetchAccountsCsv,
  fetchAdminList,
  nextSort,
  pageCount,
  postAccountImport,
} from '../admin/accounts-client.ts';
import type {
  AccountFilters,
  AccountListPage,
  AccountSort,
  AdminListing,
} from '../admin/accounts-client.ts';
import { TIER_NAMES, formatDay } from '../admin/admin-users-client.ts';
import { ADMIN_PATH, adminPageView, adminUserPath } from '../admin/route.ts';
import { navigate } from '../admin/use-pathname.ts';

/**
 * Every account this deployment knows, for a platform admin
 * (docs/decisions.md D128): search, filter by plan, status and signup
 * date, sort, page through, export as CSV, and open any one of them. With
 * the admins listed underneath, read-only (D129): who is an admin is a
 * secret, which no session can change (L4).
 *
 * Nothing here is a permission. Every route checks the caller is a
 * platform admin itself (ADR-0006); this decides what to draw.
 */
export function AdminAccountList({ isAdmin }: { isAdmin: boolean | null }) {
  const view = adminPageView(isAdmin);
  if (view === 'checking') {
    return (
      <section className="adminpage" aria-label="Accounts">
        <p className="pane-note" role="status">
          Checking your access.
        </p>
      </section>
    );
  }
  if (view === 'denied') {
    return (
      <section className="adminpage" aria-label="Accounts">
        <h1 className="adminpage__title">Nothing here</h1>
        <p className="pane-note">This page is not part of your account.</p>
      </section>
    );
  }
  return <AccountList />;
}

type Load =
  | { phase: 'loading' }
  | { phase: 'failed'; error: string }
  | { phase: 'ready'; page: AccountListPage };

type Note = { tone: 'ok' | 'error'; text: string } | null;

const COLUMNS: { label: string; sort: AccountSort | null }[] = [
  { label: 'Account', sort: 'email' },
  { label: 'Plan', sort: null },
  { label: 'Status', sort: null },
  { label: 'Projects', sort: null },
  { label: 'Spend', sort: 'spend' },
  { label: 'Signed up', sort: 'signed_up' },
  { label: 'Last active', sort: 'last_active' },
];

function AccountList() {
  const searchId = useId();
  const planId = useId();
  const statusId = useId();
  const sinceId = useId();
  const [filters, setFilters] = useState<AccountFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    let live = true;
    setLoad({ phase: 'loading' });
    void fetchAccountList(filters).then((result) => {
      if (!live) return;
      setLoad(
        result.ok
          ? { phase: 'ready', page: result.value }
          : { phase: 'failed', error: result.error },
      );
    });
    return () => {
      live = false;
    };
  }, [filters, attempt]);

  const change = (next: Partial<AccountFilters>) =>
    setFilters((current) => ({ ...current, ...next, page: 1 }));

  async function exportCsv() {
    setBusy('export');
    setNote(null);
    try {
      const result = await fetchAccountsCsv(filters);
      if (!result.ok) {
        setNote({ tone: 'error', text: result.error });
        return;
      }
      const cut = describeExport(result.value.exported, result.value.total);
      if (cut) setNote({ tone: 'error', text: cut });
      const url = URL.createObjectURL(result.value.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.value.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Import Clerk's directory, one bounded request after another until it
   * says it has read the last page. A failure part way keeps what was
   * imported and says so.
   */
  async function importAccounts() {
    setBusy('import');
    setNote(null);
    let imported = 0;
    let after: number | null = null;
    let unaudited = false;
    try {
      for (;;) {
        const result = await postAccountImport(after);
        if (!result.ok) {
          // Rows written before a failure part way stay written.
          imported += result.imported;
          unaudited ||= !result.audited;
          setNote({
            tone: 'error',
            text: `${result.error} It had imported ${imported} before it stopped; importing again is safe.${
              unaudited ? ' The audit log did not record all of it.' : ''
            }`,
          });
          return;
        }
        imported += result.value.imported;
        unaudited ||= !result.value.audited;
        setNote({ tone: 'ok', text: `Imported ${imported} so far.` });
        if (result.value.next === null) break;
        after = result.value.next;
      }
      setNote({
        tone: 'ok',
        text: `Imported ${imported} account${imported === 1 ? '' : 's'} from Clerk.${
          unaudited ? ' The audit log did not record it.' : ''
        }`,
      });
    } finally {
      setBusy(null);
      setAttempt((n) => n + 1);
    }
  }

  const page = load.phase === 'ready' ? load.page : null;

  return (
    <section className="adminpage adminpage--wide" aria-label="Accounts">
      <div className="adminpage__head">
        <div>
          <h1 className="adminpage__title">Accounts</h1>
          <p className="pane-note">
            Everyone who has signed in, and everyone this copy holds data for.
          </p>
        </div>
        <AdminLink href={ADMIN_PATH} className="adminpage__back">
          Back to admin
        </AdminLink>
      </div>

      <form
        className="accounts__filters"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          change({ search });
        }}
      >
        <div className="accounts__field accounts__field--search">
          <label className="prompt__label" htmlFor={searchId}>
            Email or account id
          </label>
          <div className="prompt__row">
            <input
              id={searchId}
              type="search"
              className="prompt__input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit" className="button">
              Search
            </button>
          </div>
        </div>
        <div className="accounts__field">
          <label className="prompt__label" htmlFor={planId}>
            Plan
          </label>
          <select
            id={planId}
            className="prompt__input"
            value={filters.plan}
            onChange={(event) =>
              change({ plan: event.target.value as AccountFilters['plan'] })
            }
          >
            <option value="">Any</option>
            <option value="free">{TIER_NAMES.free}</option>
            <option value="build">{TIER_NAMES.build}</option>
            <option value="ship">{TIER_NAMES.ship}</option>
          </select>
        </div>
        <div className="accounts__field">
          <label className="prompt__label" htmlFor={statusId}>
            Status
          </label>
          <select
            id={statusId}
            className="prompt__input"
            value={filters.status}
            onChange={(event) =>
              change({
                status: event.target.value as AccountFilters['status'],
              })
            }
          >
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div className="accounts__field">
          <label className="prompt__label" htmlFor={sinceId}>
            Signed up since
          </label>
          <input
            id={sinceId}
            type="date"
            className="prompt__input"
            value={filters.since}
            onChange={(event) => change({ since: event.target.value })}
          />
        </div>
      </form>

      <div className="accounts__actions">
        <button
          type="button"
          className="button button--small"
          disabled={busy !== null}
          onClick={() => void exportCsv()}
        >
          {busy === 'export' ? 'Exporting…' : 'Export CSV'}
        </button>
        {page?.canImport ? (
          <button
            type="button"
            className="button button--small"
            disabled={busy !== null}
            onClick={() => void importAccounts()}
          >
            {busy === 'import' ? 'Importing…' : 'Import from Clerk'}
          </button>
        ) : null}
        {note ? (
          <p
            className={
              note.tone === 'error' ? 'pane-note pane-note--error' : 'pane-note'
            }
            role={note.tone === 'error' ? 'alert' : 'status'}
          >
            {note.text}
          </p>
        ) : null}
      </div>

      {load.phase === 'loading' ? (
        <p className="pane-note" role="status">
          Loading accounts.
        </p>
      ) : null}
      {load.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {load.error}{' '}
          <button
            type="button"
            className="button button--small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      ) : null}

      {page ? (
        <>
          <p className="pane-note" role="status">
            {describeRange(page)}{' '}
            {page.accounts.length === 0 && page.total > 0 ? (
              <button
                type="button"
                className="button button--small"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: pageCount(page),
                  }))
                }
              >
                Go to page {pageCount(page)}
              </button>
            ) : null}
          </p>
          {page.accounts.length > 0 ? (
            <div className="accounts__scroll">
              <table className="accounts__table">
                <thead>
                  <tr>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.label}
                        scope="col"
                        aria-sort={
                          column.sort !== null && filters.sort === column.sort
                            ? filters.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                      >
                        {column.sort === null ? (
                          column.label
                        ) : (
                          <button
                            type="button"
                            className="accounts__sort"
                            onClick={() =>
                              setFilters((current) =>
                                nextSort(current, column.sort!),
                              )
                            }
                          >
                            {column.label}
                            {filters.sort === column.sort
                              ? filters.direction === 'asc'
                                ? ' ↑'
                                : ' ↓'
                              : ''}
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.accounts.map((row) => (
                    <tr key={row.userId}>
                      <td>
                        <AdminLink href={adminUserPath(row.userId)}>
                          {row.email ?? row.userId}
                        </AdminLink>
                        {row.email ? (
                          <span className="accounts__id">{row.userId}</span>
                        ) : null}
                      </td>
                      <td>
                        {TIER_NAMES[row.plan]}
                        {row.gifted ? ' (gifted)' : ''}
                      </td>
                      <td
                        className={
                          row.banned || row.suspended
                            ? 'accounts__flag'
                            : undefined
                        }
                      >
                        {describeStatus(row)}
                      </td>
                      <td className="accounts__num">{row.activeProjects}</td>
                      <td className="accounts__num">{describeSpend(row)}</td>
                      <td>{formatDay(row.firstSeenAt)}</td>
                      <td>{formatDay(row.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {pageCount(page) > 1 ? (
            <nav className="accounts__pager" aria-label="Pages">
              <button
                type="button"
                className="button button--small"
                disabled={filters.page <= 1}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: current.page - 1,
                  }))
                }
              >
                Previous
              </button>
              <span className="pane-note">
                Page {filters.page} of {pageCount(page)}
              </span>
              <button
                type="button"
                className="button button--small"
                disabled={filters.page >= pageCount(page)}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: current.page + 1,
                  }))
                }
              >
                Next
              </button>
            </nav>
          ) : null}
        </>
      ) : null}

      <PlatformAdmins />
    </section>
  );
}

/**
 * Who can use these tools, read-only (D129). Adding or removing an admin
 * is a change to the `VIBLD_PLATFORM_ADMINS` secret, made where secrets
 * are, which an admin's own session cannot do (L4).
 */
export function PlatformAdmins() {
  const [admins, setAdmins] = useState<AdminListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchAdminList().then((result) => {
      if (!live) return;
      if (result.ok) setAdmins(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="knowledge" role="group" aria-label="Platform admins">
      <p className="knowledge__summary">Platform admins</p>
      {error ? (
        <p className="pane-note pane-note--error" role="alert">
          {error}
        </p>
      ) : admins === null ? (
        <p className="pane-note" role="status">
          Loading.
        </p>
      ) : admins.length === 0 ? (
        <p className="pane-note">None are listed.</p>
      ) : (
        <ul className="pane-note">
          {admins.map((admin) => (
            <li key={admin.identity}>
              {admin.userId ? (
                <AdminLink href={adminUserPath(admin.userId)}>
                  {admin.identity}
                </AdminLink>
              ) : (
                admin.identity
              )}
              {admin.source === 'owner'
                ? ' · the owner of this copy'
                : admin.userId
                  ? ''
                  : ' · has not signed in yet'}
            </li>
          ))}
        </ul>
      )}
      {admins?.some((admin) => admin.source === 'owner') ? (
        <p className="pane-note">
          Read-only. This copy has one owner, who signs in with the owner
          password and is its only admin. The address shown is{' '}
          <code>VIBLD_OWNER_EMAIL</code>.
        </p>
      ) : (
        <p className="pane-note">
          Read-only. Admins are the addresses in the{' '}
          <code>VIBLD_PLATFORM_ADMINS</code> secret; change that secret to add
          or remove one.
        </p>
      )}
    </div>
  );
}

/**
 * A real link that stays in the document on a plain click, so the builder
 * session mounted underneath survives it.
 */
function AdminLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
