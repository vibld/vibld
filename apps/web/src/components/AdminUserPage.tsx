import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  TIER_NAMES,
  confirmsEmail,
  describeAuditEntry,
  describePlan,
  fetchAdminUser,
  formatDay,
  formatUsd,
  parseOverrideField,
  postAdminAction,
} from '../admin/admin-users-client.ts';
import type {
  AdminResult,
  AdminUserDetail,
} from '../admin/admin-users-client.ts';
import { ADMIN_PATH, adminPageView } from '../admin/route.ts';
import { navigate } from '../admin/use-pathname.ts';

/**
 * One account, for a platform admin (docs/decisions.md D73): who it is,
 * its plan and whether that is gifted, its limits and any override, what
 * it spent, its projects and recent runs, whether it is banned, and every
 * admin action taken on it. With the controls to give or revoke a plan,
 * set overrides, ban or unban, and delete.
 *
 * Nothing here is a permission. Every action is a `/api/admin/*` route that
 * checks the caller itself (ADR-0006); this decides what to draw.
 */
export function AdminUserPage({
  isAdmin,
  userId,
}: {
  isAdmin: boolean | null;
  userId: string;
}) {
  const view = adminPageView(isAdmin);
  if (view === 'checking') {
    return (
      <section className="adminpage" aria-label="Account">
        <p className="pane-note" role="status">
          Checking your access.
        </p>
      </section>
    );
  }
  if (view === 'denied') {
    return (
      <section className="adminpage" aria-label="Account">
        <h1 className="adminpage__title">Nothing here</h1>
        <p className="pane-note">This page is not part of your account.</p>
      </section>
    );
  }
  return <AccountView userId={userId} />;
}

type Load =
  | { phase: 'loading' }
  | { phase: 'failed'; error: string }
  | { phase: 'ready'; user: AdminUserDetail };

/** What the last action said, for the line under the controls. */
type Outcome = { tone: 'ok' | 'error'; lines: string[] } | null;

function AccountView({ userId }: { userId: string }) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    let live = true;
    setLoad({ phase: 'loading' });
    void fetchAdminUser({ userId }).then((result) => {
      if (!live) return;
      setLoad(
        result.ok
          ? { phase: 'ready', user: result.value }
          : { phase: 'failed', error: result.error },
      );
    });
    return () => {
      live = false;
    };
  }, [userId, attempt]);

  /**
   * Run one action, say what it came to, and read the account again. The
   * refresh is a second request: its failing says nothing about whether
   * the action landed, so the outcome line is set from the action's own
   * answer first.
   */
  async function act(
    run: () => Promise<AdminResult<Record<string, unknown>>>,
    describe: (answer: Record<string, unknown>) => string[],
  ) {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await run();
      setOutcome(
        result.ok
          ? {
              tone: 'ok',
              lines: [
                ...describe(result.value),
                ...(result.value.audited === false
                  ? ['It was done, but the audit log did not record it.']
                  : []),
              ],
            }
          : { tone: 'error', lines: [result.error] },
      );
    } finally {
      setBusy(false);
      setAttempt((n) => n + 1);
    }
  }

  return (
    <section className="adminpage" aria-label="Account">
      <div className="adminpage__head">
        <div>
          <h1 className="adminpage__title">
            {load.phase === 'ready' && load.user.email
              ? load.user.email
              : userId}
          </h1>
          <p className="pane-note">{userId}</p>
        </div>
        <a
          className="adminpage__back"
          href={ADMIN_PATH}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.button !== 0) return;
            event.preventDefault();
            navigate(ADMIN_PATH);
          }}
        >
          Back to admin
        </a>
      </div>

      {load.phase === 'loading' ? (
        <p className="pane-note" role="status">
          Loading the account.
        </p>
      ) : null}
      {load.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {load.error}
        </p>
      ) : null}
      {outcome ? (
        <div
          className={
            outcome.tone === 'error'
              ? 'pane-note pane-note--error'
              : 'pane-note'
          }
          role={outcome.tone === 'error' ? 'alert' : 'status'}
        >
          {outcome.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      {load.phase === 'ready' ? (
        <div className="adminpage__tools">
          <Overview user={load.user} />
          <PlanControls user={load.user} busy={busy} act={act} />
          <OverrideControls user={load.user} busy={busy} act={act} />
          <BanControls user={load.user} busy={busy} act={act} />
          <DeleteControls user={load.user} busy={busy} act={act} />
          <Projects user={load.user} />
          <Runs user={load.user} />
          <AuditList user={load.user} />
        </div>
      ) : null}
    </section>
  );
}

type Act = (
  run: () => Promise<AdminResult<Record<string, unknown>>>,
  describe: (answer: Record<string, unknown>) => string[],
) => Promise<void>;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="knowledge" role="group" aria-label={title}>
      <p className="knowledge__summary">{title}</p>
      {children}
    </div>
  );
}

function when(epochMs: number | null): string {
  return epochMs === null
    ? 'unknown'
    : formatDay(new Date(epochMs).toISOString());
}

function Overview({ user }: { user: AdminUserDetail }) {
  const { limits, spend } = user;
  return (
    <Panel title="Account">
      <p className="pane-note">
        Created {when(user.createdAt)}, last signed in {when(user.lastSignInAt)}
        .
      </p>
      <p className="pane-note">Plan: {describePlan(user.plan)}.</p>
      <p className="pane-note">
        Spent{' '}
        {spend.monthMicroUsd === null
          ? 'unknown'
          : formatUsd(spend.monthMicroUsd)}{' '}
        of {formatUsd(limits.monthlyAllowanceMicroUsd)} this month
        {limits.monthlyAllowanceMicroUsd !== limits.tierMonthlyAllowanceMicroUsd
          ? ` (override; the plan gives ${formatUsd(limits.tierMonthlyAllowanceMicroUsd)})`
          : ''}
        .{' '}
        {spend.creditRemainingMicroUsd === null
          ? 'Credit unknown.'
          : `${formatUsd(spend.creditRemainingMicroUsd)} credit left.`}
      </p>
      <p className="pane-note">
        Active projects allowed:{' '}
        {limits.activeProjects === null ? 'no limit' : limits.activeProjects}
        {limits.activeProjects !== limits.tierActiveProjects
          ? ` (override; the plan gives ${
              limits.tierActiveProjects === null
                ? 'no limit'
                : limits.tierActiveProjects
            })`
          : ''}
        .
      </p>
      {user.suspended ? (
        <p className="pane-note pane-note--error">
          Suspended after a lost dispute. Lift it from the credit tool on the
          admin page.
        </p>
      ) : null}
      {user.deletion ? (
        <p className="pane-note pane-note--error">
          Scheduled for deletion on {formatDay(user.deletion.purgeAfter)}.
        </p>
      ) : null}
    </Panel>
  );
}

function PlanControls({
  user,
  busy,
  act,
}: {
  user: AdminUserDetail;
  busy: boolean;
  act: Act;
}) {
  const tierId = useId();
  const endId = useId();
  const reasonId = useId();
  const [tier, setTier] = useState<'build' | 'ship'>('build');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const gift = user.plan.gift;

  return (
    <Panel title="Gifted plan">
      <p className="pane-note">
        {gift
          ? `${TIER_NAMES[gift.tier]} gifted by ${gift.grantedBy}, ${
              gift.endsAt
                ? `until ${formatDay(gift.endsAt)}`
                : 'with no end date'
            }${gift.reason ? ` ("${gift.reason}")` : ''}.`
          : 'No gifted plan.'}{' '}
        A gift charges nothing. While it lasts the account has the higher of the
        gift and any subscription it pays for.
      </p>
      <label className="prompt__label" htmlFor={tierId}>
        Tier
      </label>
      <select
        id={tierId}
        className="models__select"
        value={tier}
        disabled={busy}
        onChange={(event) => setTier(event.target.value as 'build' | 'ship')}
      >
        <option value="build">Build</option>
        <option value="ship">Ship</option>
      </select>
      <label className="prompt__label" htmlFor={endId}>
        Last day (optional, UTC)
      </label>
      <input
        id={endId}
        type="date"
        className="prompt__input"
        value={endsAt}
        disabled={busy}
        onChange={(event) => setEndsAt(event.target.value)}
      />
      <label className="prompt__label" htmlFor={reasonId}>
        Reason
      </label>
      <input
        id={reasonId}
        type="text"
        className="prompt__input"
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="prompt__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                postAdminAction('/api/admin/user/gift', {
                  userId: user.userId,
                  tier,
                  endsAt: endsAt === '' ? null : endsAt,
                  reason,
                }),
              () => [
                `Gave ${TIER_NAMES[tier]}${endsAt ? ` until ${formatDay(endsAt)}` : ' with no end date'}.`,
              ],
            )
          }
        >
          {gift ? 'Replace gift' : 'Give plan'}
        </button>
        {gift ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  postAdminAction('/api/admin/user/gift/revoke', {
                    userId: user.userId,
                    reason,
                  }),
                () => ['Revoked the gifted plan.'],
              )
            }
          >
            Revoke gift
          </button>
        ) : null}
      </div>
    </Panel>
  );
}

function OverrideControls({
  user,
  busy,
  act,
}: {
  user: AdminUserDetail;
  busy: boolean;
  act: Act;
}) {
  const limitId = useId();
  const capId = useId();
  const reasonId = useId();
  const current = user.overrides;
  const [limit, setLimit] = useState(
    current?.activeProjectLimit === null || current === null
      ? ''
      : String(current.activeProjectLimit),
  );
  const [cap, setCap] = useState(
    current?.monthlySpendCapMicroUsd === null || current === null
      ? ''
      : (current.monthlySpendCapMicroUsd / 1_000_000).toFixed(2),
  );
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function save() {
    const parsedLimit = parseOverrideField(limit, 'count');
    const parsedCap = parseOverrideField(cap, 'usd');
    if (!parsedLimit.ok || !parsedCap.ok) {
      setProblem('Enter whole projects and a dollar amount, or leave blank.');
      return;
    }
    setProblem(null);
    void act(
      () =>
        postAdminAction('/api/admin/user/overrides', {
          userId: user.userId,
          activeProjectLimit: parsedLimit.value,
          monthlySpendCapUsdCents: parsedCap.value,
          reason,
        }),
      () => ['Saved the overrides.'],
    );
  }

  return (
    <Panel title="Overrides">
      <p className="pane-note">
        Blank means the plan decides. An override takes precedence over the plan
        for this account only.
      </p>
      <label className="prompt__label" htmlFor={limitId}>
        Active project limit
      </label>
      <input
        id={limitId}
        type="number"
        min="0"
        step="1"
        className="prompt__input"
        placeholder={
          user.limits.tierActiveProjects === null
            ? 'no limit'
            : String(user.limits.tierActiveProjects)
        }
        value={limit}
        disabled={busy}
        onChange={(event) => setLimit(event.target.value)}
      />
      <label className="prompt__label" htmlFor={capId}>
        Monthly spend cap (USD)
      </label>
      <input
        id={capId}
        type="number"
        min="0"
        step="0.01"
        className="prompt__input"
        placeholder={(
          user.limits.tierMonthlyAllowanceMicroUsd / 1_000_000
        ).toFixed(2)}
        value={cap}
        disabled={busy}
        onChange={(event) => setCap(event.target.value)}
      />
      <label className="prompt__label" htmlFor={reasonId}>
        Reason
      </label>
      <input
        id={reasonId}
        type="text"
        className="prompt__input"
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="prompt__actions">
        <button type="button" className="button" disabled={busy} onClick={save}>
          Save overrides
        </button>
      </div>
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </Panel>
  );
}

/** What a ban's answer says it stopped, and what it could not. */
function describeBan(answer: Record<string, unknown>): string[] {
  const lines = ['Banned. Every request from this account is now refused.'];
  const clerk = answer.clerk as { ok?: boolean; error?: string } | undefined;
  lines.push(
    clerk?.ok
      ? 'Clerk has banned the sign-in.'
      : `Clerk was not updated: ${clerk?.error ?? 'no answer'}. Ban again to retry.`,
  );
  const builds = answer.builds as { stopped?: string[]; failed?: string[] };
  if (builds?.stopped?.length) {
    lines.push(`Stopped ${builds.stopped.length} running build(s).`);
  }
  if (builds?.failed?.length) {
    lines.push(`${builds.failed.length} build(s) could not be stopped.`);
  }
  const previews = answer.previews as { ok?: boolean; error?: string };
  if (previews && previews.ok === false) {
    lines.push(`Previews: ${previews.error ?? 'could not be stopped'}.`);
  }
  const sites = Array.isArray(answer.sites)
    ? (answer.sites as { slug: string; ok: boolean; error?: string }[])
    : [];
  for (const site of sites) {
    lines.push(
      site.ok
        ? `Held ${site.slug}.`
        : `${site.slug} is still serving: ${site.error ?? 'the hold failed'}.`,
    );
  }
  return lines;
}

function BanControls({
  user,
  busy,
  act,
}: {
  user: AdminUserDetail;
  busy: boolean;
  act: Act;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const banned = user.ban !== null && user.ban.liftedAt === null;

  return (
    <Panel title="Ban">
      {banned ? (
        <p className="pane-note pane-note--error">
          Banned {formatDay(user.ban!.bannedAt)} by {user.ban!.bannedBy}:
          &ldquo;
          {user.ban!.reason}&rdquo;.
        </p>
      ) : (
        <p className="pane-note">
          A ban stops sign-in, refuses every request the account makes even from
          a session it still holds, stops its running builds and previews, and
          holds its published sites.
          {user.ban
            ? ` Last ban lifted ${formatDay(user.ban.liftedAt!)} by ${user.ban.liftedBy ?? 'unknown'}.`
            : ''}
        </p>
      )}
      <label className="prompt__label" htmlFor={reasonId}>
        {banned ? 'Reason for lifting (optional)' : 'Reason (required)'}
      </label>
      <input
        id={reasonId}
        type="text"
        className="prompt__input"
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="prompt__actions">
        {banned ? (
          <>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    postAdminAction('/api/admin/user/unban', {
                      userId: user.userId,
                      reason,
                    }),
                  (answer) => {
                    const clerk = answer.clerk as
                      { ok?: boolean; error?: string } | undefined;
                    const held = Array.isArray(answer.heldSites)
                      ? (answer.heldSites as string[])
                      : [];
                    return [
                      'Ban lifted.',
                      clerk?.ok
                        ? 'Clerk allows sign-in again.'
                        : `Clerk was not updated: ${clerk?.error ?? 'no answer'}.`,
                      held.length > 0
                        ? `Still held, not republished: ${held.join(', ')}. Release each from Site takedown on the admin page if it should come back.`
                        : 'No held sites.',
                    ];
                  },
                )
              }
            >
              Lift ban
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                void act(
                  () =>
                    postAdminAction('/api/admin/user/ban', {
                      userId: user.userId,
                      reason,
                    }),
                  describeBan,
                )
              }
            >
              Ban again (retry what failed)
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={busy || reason.trim() === ''}
            onClick={() =>
              void act(
                () =>
                  postAdminAction('/api/admin/user/ban', {
                    userId: user.userId,
                    reason,
                  }),
                describeBan,
              )
            }
          >
            Ban account
          </button>
        )}
      </div>
      <p className="pane-note">
        Lifting a ban lets the account sign in and use the product again. It
        does not republish the sites the ban held: release each one from Site
        takedown on the admin page.
      </p>
    </Panel>
  );
}

function DeleteControls({
  user,
  busy,
  act,
}: {
  user: AdminUserDetail;
  busy: boolean;
  act: Act;
}) {
  const emailId = useId();
  const reasonId = useId();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  if (user.deletion) {
    return (
      <Panel title="Delete">
        <p className="pane-note">
          Deletion requested {formatDay(user.deletion.requestedAt)}. Everything
          is purged on {formatDay(user.deletion.purgeAfter)}.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Delete">
      <p className="pane-note">
        The same deletion the account&rsquo;s owner can ask for: it is refused
        at once, its subscription is cancelled, previews stop, its sites are
        held, and everything is purged after 30 days. Until then the owner can
        sign in and keep the account, unless it is also banned.
      </p>
      <label className="prompt__label" htmlFor={emailId}>
        Type the account&rsquo;s email address to confirm
      </label>
      <input
        id={emailId}
        type="email"
        className="prompt__input"
        value={typed}
        disabled={busy}
        onChange={(event) => setTyped(event.target.value)}
      />
      <label className="prompt__label" htmlFor={reasonId}>
        Reason
      </label>
      <input
        id={reasonId}
        type="text"
        className="prompt__input"
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="prompt__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !confirmsEmail(typed, user.email)}
          onClick={() =>
            void act(
              () =>
                postAdminAction('/api/admin/user/delete', {
                  userId: user.userId,
                  confirmEmail: typed,
                  reason,
                }),
              (answer) => {
                const errors = Array.isArray(answer.errors)
                  ? (answer.errors as string[])
                  : [];
                return [
                  `Deletion requested. The purge runs on ${
                    typeof answer.purgeAfter === 'string'
                      ? formatDay(answer.purgeAfter)
                      : 'the date shown'
                  }.`,
                  ...errors,
                ];
              },
            )
          }
        >
          Delete account
        </button>
      </div>
    </Panel>
  );
}

function Projects({ user }: { user: AdminUserDetail }) {
  return (
    <Panel title={`Projects (${user.projects.length})`}>
      {user.projects.length === 0 ? (
        <p className="pane-note">No projects.</p>
      ) : (
        <ul className="pane-note">
          {user.projects.map((project) => (
            <li key={project.id}>
              {project.name}
              {project.archived ? ' (archived)' : ''} · updated{' '}
              {formatDay(project.updatedAt)}
              {project.site
                ? ` · ${project.site.slug} (${project.site.state})`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Runs({ user }: { user: AdminUserDetail }) {
  return (
    <Panel title="Recent runs">
      {user.runs.length === 0 ? (
        <p className="pane-note">No runs.</p>
      ) : (
        <ul className="pane-note">
          {user.runs.map((run) => (
            <li key={run.runId}>
              {formatDay(run.startedAt)} · {run.projectName} · {run.state}
              {run.stop && run.stop !== 'applied' ? ` · ${run.stop}` : ''}
              {run.model ? ` · ${run.model}` : ''}
              {run.costMicroUsd !== null
                ? ` · ${formatUsd(run.costMicroUsd)}`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AuditList({ user }: { user: AdminUserDetail }) {
  return (
    <Panel title="Admin actions on this account">
      {user.audit.length === 0 ? (
        <p className="pane-note">None.</p>
      ) : (
        <ul className="pane-note">
          {user.audit.map((entry) => (
            <li key={entry.id}>
              {formatDay(entry.at)} · {describeAuditEntry(entry)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
