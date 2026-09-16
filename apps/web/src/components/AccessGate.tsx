import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchAccess } from '../access/access-client.ts';
import type { AccessStatus } from '../access/access-client.ts';
import { Mark, WORDMARK } from './Mark.tsx';

/**
 * The screen between signing in and the builder, while the list is closed.
 *
 * Separate from `AuthGate` because they answer different questions and have
 * different answers for the person reading them. "You are not signed in" is
 * something they can fix in ten seconds. "You are signed in and not on the
 * list" is not, and showing them a builder that refuses every action would be
 * worse than saying so.
 *
 * `useBuilderSession` must not mount behind this, for the same reason it does
 * not mount behind `AuthGate`: it probes on mount, and those probes are
 * exactly what an uninvited account may not do.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccessStatus | null>(null);

  useEffect(() => {
    let live = true;
    void fetchAccess().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, []);

  // Nothing at all while it is unknown. A flash of the builder followed by a
  // refusal reads as a product that broke, rather than one that is closed.
  if (status === null) return null;
  if (status.allowed) return children;
  return <ClosedNotice status={status} />;
}

function ClosedNotice({ status }: { status: AccessStatus }) {
  return (
    <div className="auth-gate">
      <div className="auth-gate__brand">
        <span className="shell__logo">
          <Mark size={22} />
        </span>
        <div>
          <p className="shell__name">{WORDMARK}</p>
          <p className="shell__tagline">Vibe. Build. Ship.</p>
        </div>
      </div>
      <div className="banner" role="status">
        <p className="banner__title">You are on the waiting list</p>
        <p className="banner__detail">
          {status.message ??
            'This deployment is invite-only at the moment. Your account is ready and will work the moment it is let in.'}
        </p>
        <p className="banner__detail">
          Nothing has been charged, and nothing you do here costs anything until
          access opens.
        </p>
      </div>
    </div>
  );
}
