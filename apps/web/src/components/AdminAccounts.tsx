import { useEffect, useId, useState } from 'react';
import {
  describeAuditEntry,
  fetchAdminUser,
  fetchAuditLog,
  formatDay,
} from '../admin/admin-users-client.ts';
import type { AdminAuditEntry } from '../admin/admin-users-client.ts';
import { adminUserPath } from '../admin/route.ts';
import { navigate } from '../admin/use-pathname.ts';

/**
 * Finding an account's admin page, and the most recent admin actions
 * across every account (docs/decisions.md D73).
 *
 * The finder takes an email because that is what a support request
 * carries; the page it opens is addressed by the Clerk user id, so the
 * address never holds the email.
 */
export function AdminAccounts() {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [entries, setEntries] = useState<AdminAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchAuditLog(30).then((result) => {
      if (!live) return;
      if (result.ok) setEntries(result.value);
      else setAuditError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  async function find(event: { preventDefault(): void }) {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed === '') return;
    setFinding(true);
    setProblem(null);
    try {
      const result = await fetchAdminUser({ email: trimmed });
      if (result.ok) navigate(adminUserPath(result.value.userId));
      else setProblem(result.error);
    } finally {
      setFinding(false);
    }
  }

  return (
    <div className="knowledge" role="group" aria-label="Accounts">
      <p className="knowledge__summary">Accounts</p>
      <form onSubmit={(event) => void find(event)}>
        <label className="prompt__label" htmlFor={emailId}>
          Open an account by email
        </label>
        <div className="prompt__row">
          <input
            id={emailId}
            type="email"
            className="prompt__input"
            placeholder="user@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="submit"
            className="button"
            disabled={finding || email.trim() === ''}
          >
            {finding ? 'Finding…' : 'Open'}
          </button>
        </div>
      </form>
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}

      <p className="prompt__label">Recent admin actions</p>
      {auditError ? (
        <p className="pane-note pane-note--error" role="alert">
          {auditError}
        </p>
      ) : entries === null ? (
        <p className="pane-note" role="status">
          Loading.
        </p>
      ) : entries.length === 0 ? (
        <p className="pane-note">None yet.</p>
      ) : (
        <ul className="pane-note">
          {entries.map((entry) => (
            <li key={entry.id}>
              {formatDay(entry.at)} · {describeAuditEntry(entry)}
              {entry.targetUserId?.startsWith('user_') ? (
                <>
                  {' '}
                  <a
                    href={adminUserPath(entry.targetUserId)}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.button !== 0
                      ) {
                        return;
                      }
                      event.preventDefault();
                      navigate(adminUserPath(entry.targetUserId!));
                    }}
                  >
                    Open
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
