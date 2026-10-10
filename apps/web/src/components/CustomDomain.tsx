import { useEffect, useState } from 'react';
import {
  connectDomain,
  disconnectDomain,
  fetchDomain,
  recheckDomain,
} from '../generation/domain-client.ts';
import type {
  DnsRecord,
  DomainResult,
  DomainState,
  ProjectDomain,
} from '../generation/domain-client.ts';

type Phase =
  | { phase: 'loading' }
  | { phase: 'ready'; state: DomainState }
  | { phase: 'working'; state: DomainState }
  | { phase: 'confirming-removal'; state: DomainState; domain: ProjectDomain };

/** A request that never got an answer, such as one sent while offline. */
const UNREACHABLE =
  'vibld could not be reached. Check your connection and try again.';

const STATUS_TEXT: Record<ProjectDomain['status'], string> = {
  active: 'Live',
  pending: 'Waiting for DNS',
  failed: 'Check failed',
};

/**
 * A published site on its owner's own domain (docs/decisions.md D189).
 *
 * Shown under the publish controls while the site is live. One domain per
 * project: connect it, add the record shown at the domain's DNS provider,
 * check again until it is live, disconnect it. A deployment without custom
 * domains shows nothing; the Free plan is told which plans have them.
 */
export function CustomDomain({ projectId }: { projectId: string }) {
  const [view, setView] = useState<Phase>({ phase: 'loading' });
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The TXT record that proves a domain is the owner's, once the Worker
  // has asked for it; the form then connects again after it is added.
  const [proof, setProof] = useState<{
    hostname: string;
    record: DnsRecord;
  } | null>(null);

  // Bumped by "Try again" after the first load failed, to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void fetchDomain(projectId)
      .catch(() => ({ ok: false as const, error: UNREACHABLE }))
      .then((result) => {
        if (!live) return;
        if (result.ok) setView({ phase: 'ready', state: result.value });
        else {
          setError(result.error);
          setView({ phase: 'ready', state: { configured: false } });
        }
      });
    return () => {
      live = false;
    };
  }, [projectId, attempt]);

  if (view.phase === 'loading') return null;
  const { state } = view;
  if (!state.configured) {
    return error ? (
      <p className="pane-note pane-note--error" role="alert">
        {error}{' '}
        <button
          type="button"
          className="chip"
          onClick={() => {
            setError(null);
            setView({ phase: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </p>
    ) : null;
  }
  const busy = view.phase === 'working';

  async function run(
    act: () => ReturnType<typeof fetchDomain>,
    previous: DomainState,
    hostname?: string,
  ) {
    setView({ phase: 'working', state: previous });
    setError(null);
    const result = await act().catch((): DomainResult<DomainState> => ({
      ok: false,
      error: UNREACHABLE,
    }));
    if (result.ok) {
      setView({ phase: 'ready', state: result.value });
      setInput('');
      setProof(null);
    } else {
      setProof(
        hostname && result.code === 'verify-ownership' && result.record
          ? { hostname, record: result.record }
          : null,
      );
      setError(result.error);
      setView({ phase: 'ready', state: previous });
    }
  }

  async function remove(previous: Extract<DomainState, { configured: true }>) {
    setView({ phase: 'working', state: previous });
    setError(null);
    const result = await disconnectDomain(projectId).catch(() => ({
      ok: false as const,
      error: UNREACHABLE,
    }));
    if (result.ok) {
      setView({
        phase: 'ready',
        state: { ...previous, domain: null },
      });
    } else {
      setError(result.error);
      setView({ phase: 'ready', state: previous });
    }
  }

  const domain = state.domain;
  return (
    <div className="custom-domain" aria-label="Custom domain" role="group">
      {domain ? (
        <>
          <p className="pane-note">
            <strong>{domain.hostname}</strong>{' '}
            <span
              className={`custom-domain__status custom-domain__status--${domain.status}`}
            >
              {STATUS_TEXT[domain.status]}
            </span>
            {domain.status === 'active' ? (
              <>
                {' '}
                <a
                  href={`https://${domain.hostname}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              </>
            ) : null}
          </p>
          {domain.status !== 'active' ? (
            <>
              <p className="pane-note">
                Add{' '}
                {domain.records.length === 1 ? 'this record' : 'these records'}{' '}
                at your domain's DNS provider, then check again. It can take a
                few minutes.
                {domain.hostname.split('.').length === 2
                  ? ' For a domain without www, your provider has to allow a CNAME at the root (some call it ALIAS or flattening).'
                  : ''}
              </p>
              <table className="custom-domain__records">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Name</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.records.map((record) => (
                    <tr key={`${record.type}:${record.name}:${record.value}`}>
                      <td>{record.type}</td>
                      <td>
                        <code>{record.name}</code>
                      </td>
                      <td>
                        <code>{record.value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {domain.errors.map((message) => (
                <p key={message} className="pane-note pane-note--error">
                  {message}
                </p>
              ))}
            </>
          ) : null}
          {view.phase === 'confirming-removal' ? (
            <p className="pane-note">
              Disconnect <strong>{domain.hostname}</strong>? It stops showing
              this site. Your vibld address keeps working.{' '}
              <button
                type="button"
                className="chip chip--on"
                onClick={() => void remove(state)}
              >
                Disconnect
              </button>{' '}
              <button
                type="button"
                className="chip"
                onClick={() => setView({ phase: 'ready', state })}
              >
                Cancel
              </button>
            </p>
          ) : (
            <p className="custom-domain__actions">
              {domain.status !== 'active' ? (
                <button
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() =>
                    void run(() => recheckDomain(projectId), state)
                  }
                >
                  {busy ? 'Checking…' : 'Check again'}
                </button>
              ) : null}{' '}
              <button
                type="button"
                className="chip"
                disabled={busy}
                onClick={() =>
                  setView({ phase: 'confirming-removal', state, domain })
                }
              >
                Disconnect domain
              </button>
            </p>
          )}
        </>
      ) : state.eligible ? (
        <form
          className="custom-domain__form"
          onSubmit={(event) => {
            event.preventDefault();
            const hostname = input.trim();
            if (hostname === '') return;
            void run(() => connectDomain(projectId, hostname), state, hostname);
          }}
        >
          <input
            type="text"
            className="publish-button__slug"
            placeholder="www.example.com"
            aria-label="Your domain"
            autoComplete="off"
            spellCheck={false}
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="submit" className="chip" disabled={busy}>
            {busy
              ? 'Connecting…'
              : proof && proof.hostname === input.trim()
                ? 'Verify and connect'
                : 'Connect domain'}
          </button>
          {proof && proof.hostname === input.trim() ? (
            <table className="custom-domain__records">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Name</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{proof.record.type}</td>
                  <td>
                    <code>{proof.record.name}</code>
                  </td>
                  <td>
                    <code>{proof.record.value}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </form>
      ) : (
        <p className="pane-note">
          Use your own domain with the Build or Ship plan.
        </p>
      )}
      {error ? (
        <p className="pane-note pane-note--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
