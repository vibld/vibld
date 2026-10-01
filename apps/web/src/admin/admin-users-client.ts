import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's admin controls over one account (docs/decisions.md
 * D73, `worker/admin-users.ts`), and the pure helpers the page renders
 * with.
 *
 * JSX-free for the reason `generation/admin-client.ts` gives: the test
 * runner strips types and errors on JSX, so what a test imports has to
 * stay clear of it. `components/AdminUserPage.tsx` is the JSX half.
 *
 * Nothing here is a permission. Every route checks the caller is a
 * platform admin itself (ADR-0006).
 */

export type Tier = 'free' | 'build' | 'ship';

export interface AdminGift {
  tier: 'build' | 'ship';
  endsAt: string | null;
  grantedBy: string;
  reason: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface AdminAuditEntry {
  id: number;
  at: string;
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  target: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
}

export interface AdminProject {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
  site: { slug: string; state: 'live' | 'down' | 'held' } | null;
}

export interface AdminRun {
  runId: string;
  projectName: string;
  state: string;
  startedAt: string;
  stop: string | null;
  model: string | null;
  costMicroUsd: number | null;
  elapsedMs: number | null;
}

export interface AdminUserDetail {
  userId: string;
  email: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  clerkBanned: boolean | null;
  plan: {
    tier: Tier;
    gifted: boolean;
    subscriptionTier: Tier | null;
    currentPeriodEnd: string | null;
    gift: AdminGift | null;
  };
  gifts: AdminGift[];
  overrides: {
    activeProjectLimit: number | null;
    monthlySpendCapMicroUsd: number | null;
    updatedBy: string;
    updatedAt: string;
  } | null;
  limits: {
    activeProjects: number | null;
    tierActiveProjects: number | null;
    monthlyAllowanceMicroUsd: number;
    tierMonthlyAllowanceMicroUsd: number;
  };
  spend: {
    monthMicroUsd: number | null;
    creditRemainingMicroUsd: number | null;
  };
  suspended: boolean;
  ban: {
    bannedAt: string;
    bannedBy: string;
    reason: string;
    liftedAt: string | null;
    liftedBy: string | null;
  } | null;
  deletion: { requestedAt: string; purgeAfter: string } | null;
  projects: AdminProject[];
  runs: AdminRun[];
  audit: AdminAuditEntry[];
}

export type AdminResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);

async function authHeaders(
  getToken: GetToken,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(response: Response): Promise<string> {
  const problem: unknown = await response.json().catch(() => null);
  return typeof problem === 'object' &&
    problem !== null &&
    typeof (problem as { error?: unknown }).error === 'string'
    ? (problem as { error: string }).error
    : `The admin request failed (${response.status}).`;
}

const UNEXPECTED = 'The admin service returned an unexpected response.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const tierOf = (value: unknown): Tier | null =>
  value === 'free' || value === 'build' || value === 'ship' ? value : null;

function readGift(value: unknown): AdminGift | null {
  if (!isRecord(value)) return null;
  if (value.tier !== 'build' && value.tier !== 'ship') return null;
  return {
    tier: value.tier,
    endsAt: str(value.endsAt),
    grantedBy: str(value.grantedBy) ?? '',
    reason: str(value.reason),
    createdAt: str(value.createdAt) ?? '',
    revokedAt: str(value.revokedAt),
    revokedBy: str(value.revokedBy),
  };
}

export function readAuditEntry(value: unknown): AdminAuditEntry | null {
  if (!isRecord(value)) return null;
  const id = num(value.id);
  const at = str(value.at);
  const adminEmail = str(value.adminEmail);
  const action = str(value.action);
  if (id === null || at === null || adminEmail === null || action === null) {
    return null;
  }
  return {
    id,
    at,
    adminEmail,
    action,
    targetUserId: str(value.targetUserId),
    target: str(value.target),
    reason: str(value.reason),
    detail: isRecord(value.detail) ? value.detail : null,
  };
}

function readProject(value: unknown): AdminProject | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const name = str(value.name);
  if (id === null || name === null) return null;
  const site = isRecord(value.site) ? value.site : null;
  const state = site?.state;
  return {
    id,
    name,
    archived: value.archived === true,
    updatedAt: str(value.updatedAt) ?? '',
    site:
      site &&
      typeof site.slug === 'string' &&
      (state === 'live' || state === 'down' || state === 'held')
        ? { slug: site.slug, state }
        : null,
  };
}

function readRun(value: unknown): AdminRun | null {
  if (!isRecord(value)) return null;
  const runId = str(value.runId);
  const state = str(value.state);
  if (runId === null || state === null) return null;
  return {
    runId,
    projectName: str(value.projectName) ?? '',
    state,
    startedAt: str(value.startedAt) ?? '',
    stop: str(value.stop),
    model: str(value.model),
    costMicroUsd: num(value.costMicroUsd),
    elapsedMs: num(value.elapsedMs),
  };
}

function rows<T>(value: unknown, read: (row: unknown) => T | null): T[] {
  return Array.isArray(value)
    ? value.map(read).filter((row): row is T => row !== null)
    : [];
}

/** The route's answer, checked field by field like the rest of the admin client. */
export function readAdminUser(body: unknown): AdminUserDetail | null {
  if (!isRecord(body) || typeof body.userId !== 'string') return null;
  const plan = isRecord(body.plan) ? body.plan : null;
  const limits = isRecord(body.limits) ? body.limits : null;
  const tier = tierOf(plan?.tier);
  if (!plan || !limits || tier === null) return null;
  const spend = isRecord(body.spend) ? body.spend : {};
  const overrides = isRecord(body.overrides) ? body.overrides : null;
  const ban = isRecord(body.ban) ? body.ban : null;
  const deletion = isRecord(body.deletion) ? body.deletion : null;
  return {
    userId: body.userId,
    email: str(body.email),
    createdAt: num(body.createdAt),
    lastSignInAt: num(body.lastSignInAt),
    clerkBanned:
      typeof body.clerkBanned === 'boolean' ? body.clerkBanned : null,
    plan: {
      tier,
      gifted: plan.gifted === true,
      subscriptionTier: tierOf(plan.subscriptionTier),
      currentPeriodEnd: str(plan.currentPeriodEnd),
      gift: readGift(plan.gift),
    },
    gifts: rows(body.gifts, readGift),
    overrides: overrides
      ? {
          activeProjectLimit: num(overrides.activeProjectLimit),
          monthlySpendCapMicroUsd: num(overrides.monthlySpendCapMicroUsd),
          updatedBy: str(overrides.updatedBy) ?? '',
          updatedAt: str(overrides.updatedAt) ?? '',
        }
      : null,
    limits: {
      activeProjects: num(limits.activeProjects),
      tierActiveProjects: num(limits.tierActiveProjects),
      monthlyAllowanceMicroUsd: num(limits.monthlyAllowanceMicroUsd) ?? 0,
      tierMonthlyAllowanceMicroUsd:
        num(limits.tierMonthlyAllowanceMicroUsd) ?? 0,
    },
    spend: {
      monthMicroUsd: num(spend.monthMicroUsd),
      creditRemainingMicroUsd: num(spend.creditRemainingMicroUsd),
    },
    suspended: body.suspended === true,
    ban:
      ban && typeof ban.bannedAt === 'string'
        ? {
            bannedAt: ban.bannedAt,
            bannedBy: str(ban.bannedBy) ?? '',
            reason: str(ban.reason) ?? '',
            liftedAt: str(ban.liftedAt),
            liftedBy: str(ban.liftedBy),
          }
        : null,
    deletion:
      deletion && typeof deletion.purgeAfter === 'string'
        ? {
            requestedAt: str(deletion.requestedAt) ?? '',
            purgeAfter: deletion.purgeAfter,
          }
        : null,
    projects: rows(body.projects, readProject),
    runs: rows(body.runs, readRun),
    audit: rows(body.audit, readAuditEntry),
  };
}

/** One account's page, by Clerk user id or by the email an admin typed. */
export async function fetchAdminUser(
  who: { userId: string } | { email: string },
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<AdminUserDetail>> {
  const query =
    'userId' in who
      ? `userId=${encodeURIComponent(who.userId)}`
      : `email=${encodeURIComponent(who.email)}`;
  let response: Response;
  try {
    response = await fetchImpl(`/api/admin/user/detail?${query}`, {
      headers: await authHeaders(getToken),
    });
  } catch {
    return { ok: false, error: 'The admin service could not be reached.' };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  const detail = readAdminUser(await response.json().catch(() => null));
  return detail
    ? { ok: true, value: detail }
    : { ok: false, error: UNEXPECTED };
}

/** The most recent admin actions across every account. */
export async function fetchAuditLog(
  limit = 50,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<AdminAuditEntry[]>> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/admin/audit?limit=${limit}`, {
      headers: await authHeaders(getToken),
    });
  } catch {
    return { ok: false, error: 'The admin service could not be reached.' };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.entries)) {
    return { ok: false, error: UNEXPECTED };
  }
  return { ok: true, value: rows(body.entries, readAuditEntry) };
}

/**
 * One admin action. The route's answer is returned as it came, for the
 * page to read the fields it shows; a refusal is its sentence.
 */
export async function postAdminAction(
  path:
    | '/api/admin/user/gift'
    | '/api/admin/user/gift/revoke'
    | '/api/admin/user/overrides'
    | '/api/admin/user/ban'
    | '/api/admin/user/unban'
    | '/api/admin/user/delete',
  body: Record<string, unknown>,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<Record<string, unknown>>> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'The admin service could not be reached.' };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  const answer: unknown = await response.json().catch(() => null);
  return isRecord(answer)
    ? { ok: true, value: answer }
    : { ok: false, error: UNEXPECTED };
}

// -------------------------------------------------------------------------
// What the page says.
// -------------------------------------------------------------------------

export function formatUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

export const TIER_NAMES: Record<Tier, string> = {
  free: 'Free',
  build: 'Build',
  ship: 'Ship',
};

/** A date as the page shows it: the day, in UTC, which the gift ends on. */
export function formatDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * The plan line: the tier, whether it is gifted and until when, and the
 * subscription underneath a gift that outranks it.
 */
export function describePlan(plan: AdminUserDetail['plan']): string {
  const name = TIER_NAMES[plan.tier];
  if (plan.gifted && plan.gift) {
    const until = plan.gift.endsAt
      ? `until ${formatDay(plan.gift.endsAt)}`
      : 'with no end date';
    const paid = plan.subscriptionTier
      ? `; pays for ${TIER_NAMES[plan.subscriptionTier]}`
      : '';
    return `${name}, gifted ${until}${paid}`;
  }
  if (plan.gift) {
    return `${name} (subscription); also gifted ${TIER_NAMES[plan.gift.tier]}`;
  }
  return plan.subscriptionTier ? `${name} (subscription)` : `${name}`;
}

const ACTION_NAMES: Record<string, string> = {
  gift: 'Gave a plan',
  'gift-revoke': 'Revoked a gifted plan',
  ban: 'Banned',
  unban: 'Lifted a ban',
  delete: 'Deleted the account',
  overrides: 'Set overrides',
  topup: 'Granted credit',
  'suspension-lift': 'Lifted a suspension',
  'site-hold': 'Held a site',
  'site-release': 'Released a site',
  'share-hold': 'Held a share link',
  'share-release': 'Released a share link',
  'accounts-import': 'Imported accounts from Clerk',
};

/** One audit row, as a sentence an admin reads down a list. */
export function describeAuditEntry(entry: AdminAuditEntry): string {
  const what = ACTION_NAMES[entry.action] ?? entry.action;
  const detail = entry.detail ?? {};
  const facts: string[] = [];
  if (entry.action === 'gift' && typeof detail.tier === 'string') {
    const tier = TIER_NAMES[detail.tier as Tier] ?? detail.tier;
    facts.push(
      typeof detail.endsAt === 'string'
        ? `${tier} until ${formatDay(detail.endsAt)}`
        : `${tier}, no end date`,
    );
  }
  if (
    entry.action === 'accounts-import' &&
    typeof detail.imported === 'number'
  ) {
    facts.push(
      detail.partial === true
        ? `${detail.imported} accounts, stopped part way`
        : `${detail.imported} accounts`,
    );
  }
  if (entry.action === 'topup' && typeof detail.creditUsdCents === 'number') {
    facts.push(formatUsd(detail.creditUsdCents * 10_000));
  }
  if (entry.action === 'overrides') {
    facts.push(
      `project limit ${
        typeof detail.activeProjectLimit === 'number'
          ? detail.activeProjectLimit
          : 'from plan'
      }, spend cap ${
        typeof detail.monthlySpendCapMicroUsd === 'number'
          ? formatUsd(detail.monthlySpendCapMicroUsd)
          : 'from plan'
      }`,
    );
  }
  const on = entry.target ?? entry.targetUserId;
  return [
    `${what}${on ? ` (${on})` : ''}`,
    ...facts,
    entry.reason ? `"${entry.reason}"` : null,
    `by ${entry.adminEmail}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/**
 * Whether the address typed to confirm a deletion is the account's. The
 * route checks it again against Clerk; this only decides when the button
 * wakes up.
 */
export function confirmsEmail(typed: string, email: string | null): boolean {
  return (
    email !== null &&
    typed.trim() !== '' &&
    typed.trim().toLowerCase() === email.trim().toLowerCase()
  );
}

/**
 * An override typed into a field: blank is "the plan decides" (null), a
 * whole number of at least 0 is the override, anything else is refused
 * before it is sent.
 */
export function parseOverrideField(
  raw: string,
  unit: 'count' | 'usd',
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { ok: false };
  if (unit === 'count') {
    return Number.isInteger(value) ? { ok: true, value } : { ok: false };
  }
  return { ok: true, value: Math.round(value * 100) };
}
