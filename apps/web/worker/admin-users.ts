/**
 * The admin controls over one account (docs/decisions.md D73):
 *
 *     GET  /api/admin/user/detail         one account: who, what plan, what
 *                                         it has, what it spent, what ran,
 *                                         and what admins did to it
 *     POST /api/admin/user/gift           give a paid tier, no Stripe charge
 *     POST /api/admin/user/gift/revoke    take it back
 *     POST /api/admin/user/overrides      per-account project limit and
 *                                         monthly spend cap
 *     POST /api/admin/user/ban            ban: Clerk, every request, running
 *                                         builds and previews, live sites
 *     POST /api/admin/user/unban          lift a ban (held sites stay held)
 *     POST /api/admin/user/delete         the existing account deletion,
 *                                         asked for by an admin
 *     GET  /api/admin/audit               the most recent admin actions
 *
 * Every one of them asks `authorize` first and does nothing, not even read
 * its body, for a caller who is not a platform admin. The router passes
 * `requireAdmin`, the check every other `/api/admin/*` route makes.
 *
 * In its own module rather than in `index.ts`, which cannot be loaded under
 * `node --test`, so each action and the audit row it writes are exercised
 * against the real schema, with Clerk, the Workflow engine, the preview
 * service and the publish service replaced by fakes that record what they
 * were asked.
 */

import { AdminStore } from './admin-store.ts';
import type { AuditAction, AuditEntry } from './admin-store.ts';
import { AccountDeletionStore } from './account-deletion-store.ts';
import type { ImmediateResult } from './account-deletion.ts';
import type { DeletionRecord } from './account-deletion-store.ts';
import { BillingStore } from './billing-store.ts';
import type {
  ClerkBanResult,
  ClerkLookupResult,
  ClerkUserSummary,
} from './clerk-lookup.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  activeProjectLimitFor,
  monthlyAllowanceFor,
  monthlyAllowanceMicroUsd,
} from './entitlement.ts';
import type { Tier } from './entitlement.ts';
import type { HoldResult } from './publish-client.ts';
import { planOf } from './spendable.ts';

export interface AdminUsersEnv {
  DB?: D1Database;
  VIBLD_FREE_MONTHLY_MICRO_USD?: string;
}

/** What `requireAdmin` in `index.ts` answers. */
export type AdminGuard =
  { denied: Response } | { denied: null; adminEmail: string };

export type ServiceResult = { ok: true } | { ok: false; error: string };

export interface AdminUsersDeps {
  /** The platform-admin check. Asked before anything else, on every route. */
  authorize: (request: Request) => Promise<AdminGuard>;
  /** An email an admin typed, as the Clerk user id everything keys on. */
  lookupByEmail: (email: string) => Promise<ClerkLookupResult>;
  /** The Clerk user, or null where it cannot be read. */
  clerkUser: (userId: string) => Promise<ClerkUserSummary | null>;
  /** Ban or unban at Clerk. */
  setClerkBan: (userId: string, banned: boolean) => Promise<ClerkBanResult>;
  /**
   * What the account has spent: this month's allowance, and its top-up
   * credit over its life. Null where there is no ledger to ask.
   */
  usage:
    | ((
        userId: string,
        now: Date,
      ) => Promise<{ monthMicroUsd: number; topupMicroUsd: number }>)
    | null;
  /**
   * Stop every build the account has running (`stopAccountBuilds` in
   * `run-control.ts`). Null where there is no Workflow binding, so nothing
   * can be running.
   */
  stopBuilds:
    | ((userId: string) => Promise<{ stopped: string[]; failed: string[] }>)
    | null;
  /**
   * Stop the account's preview sandbox and those its share links started.
   * Null where there is no preview service.
   */
  stopPreviews: ((userId: string) => Promise<ServiceResult>) | null;
  /**
   * An operator hold on one site (`/api/admin/publish/hold`'s own path).
   * Null where there is no publish service, so nothing can be serving.
   */
  holdSite:
    ((slug: string, by: string, reason: string) => Promise<HoldResult>) | null;
  /**
   * The existing account deletion (`requestAccountDeletion`), with a
   * takedown that holds the account's sites. Never a second path.
   */
  requestDeletion: (
    userId: string,
    takeDown: () => Promise<unknown>,
  ) => Promise<{ record: DeletionRecord; result: ImmediateResult }>;
  now?: () => Date;
  newId?: () => string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Every route this module answers, for the router and its tests. */
export const ADMIN_USER_ROUTES = [
  '/api/admin/user/detail',
  '/api/admin/user/gift',
  '/api/admin/user/gift/revoke',
  '/api/admin/user/overrides',
  '/api/admin/user/ban',
  '/api/admin/user/unban',
  '/api/admin/user/delete',
  '/api/admin/audit',
] as const;

export type AdminUserRoute = (typeof ADMIN_USER_ROUTES)[number];

export function isAdminUserRoute(pathname: string): pathname is AdminUserRoute {
  return (ADMIN_USER_ROUTES as readonly string[]).includes(pathname);
}

/**
 * A Clerk user id, by shape. Not proof the account exists, only that the
 * string is one this code will put in a query and a log: Clerk's ids are
 * `user_` and letters and digits.
 */
function isUserId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^user_[A-Za-z0-9]+$/.test(value)
  );
}

/** A reason as the log stores it: trimmed, bounded, or null for none. */
function reasonOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, 500);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** The most an override may set, so a typo cannot hand out the moon. */
export const MAX_PROJECT_LIMIT_OVERRIDE = 1_000;
export const MAX_SPEND_CAP_USD_CENTS = 1_000_000;

async function readBody(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Append a row for an action that has already happened, and say whether it
 * landed. Never throws: the action is done either way, and telling the
 * admin it failed would invite doing it twice. The route reports a row
 * that did not land, so it can be written down by hand.
 */
export async function appendAudit(
  db: D1Database,
  entry: AuditEntry,
): Promise<boolean> {
  try {
    await new AdminStore(db).append(entry);
    return true;
  } catch (error) {
    console.error('admin action not recorded in the audit log', {
      action: entry.action,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * For the admin actions that predate the audit log (a credit grant, a
 * suspension lift, a site or share hold): once the route has answered
 * with success, append the row its answer describes, and add `audited` to
 * the answer. A refusal is passed through untouched, since nothing was
 * done.
 */
export async function withAudit(
  db: D1Database,
  response: Response,
  entryFor: (
    body: Record<string, unknown>,
  ) => Promise<AuditEntry | null> | AuditEntry | null,
): Promise<Response> {
  if (!response.ok) return response;
  let body: Record<string, unknown>;
  try {
    body = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    return response;
  }
  let entry: AuditEntry | null;
  try {
    entry = await entryFor(body);
  } catch (error) {
    console.error('could not describe an admin action for the audit log', {
      error: error instanceof Error ? error.message : String(error),
    });
    entry = null;
  }
  const audited = entry ? await appendAudit(db, entry) : false;
  return json({ ...body, audited }, response.status);
}

/** Build an audit entry with the fields every action fills the same way. */
function entry(
  now: Date,
  adminEmail: string,
  action: AuditAction,
  targetUserId: string,
  reason: string | null,
  detail: Record<string, unknown> | null = null,
): AuditEntry {
  return {
    at: now.toISOString(),
    adminEmail,
    action,
    targetUserId,
    target: null,
    reason,
    detail,
  };
}

/**
 * The end of a gift, from what an admin typed: an ISO instant, or a
 * calendar date meaning the end of that day in UTC, so "until 2026-12-31"
 * includes the 31st. Null for no end. An end already passed is refused: a
 * gift that is over before it starts is a mistake, not a gift.
 */
export function parseGiftEnd(
  raw: unknown,
  now: Date,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: '"endsAt" must be a date or null.' };
  }
  const trimmed = raw.trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const at = Date.parse(day ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (!Number.isFinite(at)) {
    return { ok: false, error: '"endsAt" is not a date.' };
  }
  // The last millisecond of that day, so the stored end names the day it
  // was given for and the gift still holds throughout it.
  const end = day ? at + 24 * 60 * 60 * 1000 - 1 : at;
  if (end <= now.getTime()) {
    return { ok: false, error: 'The end date has already passed.' };
  }
  return { ok: true, value: new Date(end).toISOString() };
}

/** An override field: a whole number in range, null to clear, or refused. */
function overrideOf(
  raw: unknown,
  name: string,
  most: number,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return {
      ok: false,
      error: `"${name}" must be a whole number of at least 0, or null.`,
    };
  }
  if (raw > most) {
    return { ok: false, error: `"${name}" may be at most ${most}.` };
  }
  return { ok: true, value: raw };
}

export async function handleAdminUsers(
  request: Request,
  env: AdminUsersEnv,
  deps: AdminUsersDeps,
): Promise<Response> {
  const guard = await deps.authorize(request);
  if (guard.denied) return guard.denied;
  if (!env.DB) {
    return json(
      { error: 'Admin access is not configured for this deployment.' },
      503,
    );
  }
  const db = env.DB;
  const route = new URL(request.url).pathname;
  const now = (deps.now ?? (() => new Date()))();
  const by = guard.adminEmail;
  const store = new AdminStore(db);

  if (route === '/api/admin/user/detail') {
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
    return detail(request, env, db, deps, now);
  }

  if (route === '/api/admin/audit') {
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    return json({ entries: await store.recentAudit(limit) });
  }

  if (!isAdminUserRoute(route)) return json({ error: 'Not found.' }, 404);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const body = await readBody(request);
  if (!body.ok) return json({ error: 'Body must be a JSON object.' }, 400);
  const { userId } = body.value;
  if (!isUserId(userId)) {
    return json({ error: 'A Clerk "userId" is required.' }, 400);
  }
  const reason = reasonOf(body.value.reason);

  if (route === '/api/admin/user/gift') {
    const tier = body.value.tier;
    if (tier !== 'build' && tier !== 'ship') {
      return json({ error: '"tier" must be "build" or "ship".' }, 400);
    }
    const endsAt = parseGiftEnd(body.value.endsAt, now);
    if (!endsAt.ok) return json({ error: endsAt.error }, 400);
    const id = (deps.newId ?? (() => crypto.randomUUID()))();
    await store.giveGift(
      {
        id,
        userId,
        tier,
        endsAt: endsAt.value,
        by,
        reason,
        now: now.toISOString(),
      },
      entry(now, by, 'gift', userId, reason, { tier, endsAt: endsAt.value }),
    );
    return json({ ok: true, userId, tier, endsAt: endsAt.value });
  }

  if (route === '/api/admin/user/gift/revoke') {
    const revoked = await store.revokeGift(
      userId,
      by,
      reason,
      now.toISOString(),
      entry(now, by, 'gift-revoke', userId, reason),
    );
    return revoked
      ? json({ ok: true, userId })
      : json({ error: 'This account has no gifted plan to revoke.' }, 409);
  }

  if (route === '/api/admin/user/overrides') {
    const limit = overrideOf(
      body.value.activeProjectLimit,
      'activeProjectLimit',
      MAX_PROJECT_LIMIT_OVERRIDE,
    );
    if (!limit.ok) return json({ error: limit.error }, 400);
    const cap = overrideOf(
      body.value.monthlySpendCapUsdCents,
      'monthlySpendCapUsdCents',
      MAX_SPEND_CAP_USD_CENTS,
    );
    if (!cap.ok) return json({ error: cap.error }, 400);
    const overrides = {
      activeProjectLimit: limit.value,
      monthlySpendCapMicroUsd: cap.value === null ? null : cap.value * 10_000,
    };
    await store.setOverrides(
      userId,
      overrides,
      by,
      now.toISOString(),
      entry(now, by, 'overrides', userId, reason, { ...overrides }),
    );
    return json({ ok: true, userId, ...overrides });
  }

  if (route === '/api/admin/user/ban') {
    if (reason === null) {
      return json({ error: 'Say why this account is being banned.' }, 400);
    }
    return ban(deps, store, userId, by, reason, now);
  }

  if (route === '/api/admin/user/unban') {
    const lifted = await store.liftBan(
      userId,
      by,
      reason,
      now.toISOString(),
      entry(now, by, 'unban', userId, reason),
    );
    if (!lifted) {
      return json({ error: 'This account is not banned.' }, 409);
    }
    const clerk = await deps.setClerkBan(userId, false);
    // Unbanning puts nothing back on the web. The sites the ban held are
    // still held, and releasing each is a separate decision, made with the
    // publish tools, for the reason a hold is never lifted by its owner.
    const heldSites = (await store.projectsOf(userId))
      .filter((project) => project.site?.state === 'held')
      .map((project) => project.site!.slug);
    return json({ ok: true, userId, clerk, heldSites });
  }

  // `/api/admin/user/delete`: the only route left.
  return remove(db, deps, userId, by, reason, body.value.confirmEmail, now);
}

/**
 * Ban an account, and stop what it has running.
 *
 * The ban row and its audit row land first, together: from that write on
 * `principal.ts` refuses every request the account makes, which is the part
 * that has to happen whatever else fails. Then each effect is attempted on
 * its own and reported, so a Clerk outage does not leave a preview running
 * and the admin is told which one to try again. Banning an account that is
 * already banned attempts them again.
 */
async function ban(
  deps: AdminUsersDeps,
  store: AdminStore,
  userId: string,
  by: string,
  reason: string,
  now: Date,
): Promise<Response> {
  const slugs = deps.holdSite ? await store.liveSiteSlugs(userId) : [];
  await store.recordBan(
    userId,
    by,
    reason,
    now.toISOString(),
    entry(now, by, 'ban', userId, reason, { sites: slugs }),
  );

  const clerk = await deps.setClerkBan(userId, true);

  let builds: { stopped: string[]; failed: string[] } = {
    stopped: [],
    failed: [],
  };
  if (deps.stopBuilds) {
    try {
      builds = await deps.stopBuilds(userId);
    } catch (error) {
      console.error('ban: could not stop builds', error);
      builds = { stopped: [], failed: ['(could not list builds)'] };
    }
  }

  let previews: ServiceResult = { ok: true };
  if (deps.stopPreviews) {
    try {
      previews = await deps.stopPreviews(userId);
    } catch {
      previews = { ok: false, error: 'Could not stop the previews.' };
    }
  }

  const sites: { slug: string; ok: boolean; error?: string }[] = [];
  for (const slug of slugs) {
    try {
      const held = await deps.holdSite!(slug, by, `Account banned: ${reason}`);
      sites.push(
        held.ok ? { slug, ok: true } : { slug, ok: false, error: held.error },
      );
    } catch {
      sites.push({
        slug,
        ok: false,
        error: 'Could not reach the publish service.',
      });
    }
  }

  // Said once more in the log, for a live tail: the rows are the record.
  console.log(
    JSON.stringify({
      event: 'admin.ban',
      userId,
      by,
      clerk: clerk.ok,
      buildsStillRunning: builds.failed.length,
      previews: previews.ok,
      sitesStillServing: sites.filter((site) => !site.ok).length,
    }),
  );
  return json({ ok: true, userId, clerk, builds, previews, sites });
}

/**
 * Delete an account on an admin's word, through the one deletion flow
 * there is (`requestAccountDeletion`, docs/decisions.md L32): the same
 * record, the same 30 days, the same immediate steps and the same purge.
 *
 * Two things differ from the owner asking. The confirmation is the
 * account's own email address, typed by the admin and checked here against
 * what Clerk holds, rather than a phrase. And the takedown is an operator
 * hold on each live site rather than the owner's own takedown, which only
 * the owner may reach (ADR-0013).
 */
async function remove(
  db: D1Database,
  deps: AdminUsersDeps,
  userId: string,
  by: string,
  reason: string | null,
  confirmEmail: unknown,
  now: Date,
): Promise<Response> {
  if (typeof confirmEmail !== 'string' || confirmEmail.trim() === '') {
    return json({ error: "Type the account's email address to confirm." }, 400);
  }
  const user = await deps.clerkUser(userId);
  if (!user?.email) {
    return json(
      {
        error:
          'Could not read this account’s email address from Clerk, so the confirmation cannot be checked. Nothing was deleted.',
      },
      503,
    );
  }
  if (user.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
    return json(
      {
        error: 'That is not this account’s email address. Nothing was deleted.',
      },
      400,
    );
  }

  const store = new AdminStore(db);
  const takeDown = async () => {
    if (!deps.holdSite) return;
    for (const slug of await store.liveSiteSlugs(userId)) {
      const held = await deps.holdSite(
        slug,
        by,
        `Account deleted by an admin${reason ? `: ${reason}` : ''}`,
      );
      if (!held.ok) throw new Error(held.error);
    }
  };

  let requested: Awaited<ReturnType<AdminUsersDeps['requestDeletion']>>;
  try {
    requested = await deps.requestDeletion(userId, takeDown);
  } catch (error) {
    console.error('admin deletion could not be recorded', error);
    return json(
      { error: 'The request could not be recorded. Nothing was deleted.' },
      503,
    );
  }
  const { record, result } = requested;
  const audited = await appendAudit(
    db,
    entry(now, by, 'delete', userId, reason, {
      purgeAfter: record.purgeAfter,
      done: result.done,
      failed: result.errors.length,
    }),
  );
  return json({
    ok: true,
    userId,
    purgeAfter: record.purgeAfter,
    done: result.done,
    errors: result.errors,
    audited,
  });
}

/**
 * One account, as the admin user page shows it. Looked up by `userId`, or
 * by `email` through Clerk.
 *
 * Reads only. Each part that depends on something optional (Clerk, the
 * ledger) is null where that cannot answer, rather than failing the page:
 * an admin looking at an account during an outage still needs the rest.
 */
async function detail(
  request: Request,
  env: AdminUsersEnv,
  db: D1Database,
  deps: AdminUsersDeps,
  now: Date,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  let userId = params.get('userId');
  const email = params.get('email');
  if (!userId && email) {
    const lookup = await deps.lookupByEmail(email.trim());
    if (!lookup.ok) return json({ error: lookup.error }, 404);
    userId = lookup.userId;
  }
  if (!isUserId(userId)) {
    return json({ error: 'A "userId" or "email" is required.' }, 400);
  }

  const store = new AdminStore(db);
  const billing = new BillingStore(db);
  const [
    clerk,
    plan,
    gifts,
    overrides,
    banned,
    suspended,
    credit,
    deletion,
    projects,
    runs,
    audit,
  ] = await Promise.all([
    deps.clerkUser(userId),
    planOf(db, userId, now.getTime()),
    store.gifts(userId),
    store.overrides(userId),
    store.ban(userId),
    billing.isSuspended(userId),
    billing.totalSpendableCreditMicroUsd(userId),
    new AccountDeletionStore(db).pending(userId),
    store.projectsOf(userId),
    store.recentRuns(userId, 20),
    store.auditFor(userId, 100),
  ]);
  let usage: { monthMicroUsd: number; topupMicroUsd: number } | null = null;
  if (deps.usage) {
    try {
      usage = await deps.usage(userId, now);
    } catch (error) {
      console.error('admin detail: ledger unavailable', error);
    }
  }

  const freeAllowance = positiveInt(
    env.VIBLD_FREE_MONTHLY_MICRO_USD,
    DEFAULT_FREE_INCLUDED_MICRO_USD,
  );
  const tier: Tier = plan.tier;
  return json({
    userId,
    email: clerk?.email ?? null,
    createdAt: clerk?.createdAt ?? null,
    lastSignInAt: clerk?.lastSignInAt ?? null,
    clerkBanned: clerk?.banned ?? null,
    plan: {
      tier,
      gifted: plan.gifted,
      subscriptionTier: plan.subscription?.tier ?? null,
      subscriptionStatus: plan.subscription?.status ?? null,
      currentPeriodEnd: plan.subscription?.currentPeriodEnd ?? null,
      gift: plan.gift,
    },
    gifts,
    overrides,
    limits: {
      activeProjects: activeProjectLimitFor(tier, overrides),
      tierActiveProjects: ACTIVE_PROJECT_LIMIT[tier],
      monthlyAllowanceMicroUsd: monthlyAllowanceFor(
        tier,
        freeAllowance,
        overrides,
      ),
      tierMonthlyAllowanceMicroUsd: monthlyAllowanceMicroUsd(
        tier,
        freeAllowance,
      ),
    },
    spend: {
      monthMicroUsd: usage?.monthMicroUsd ?? null,
      creditRemainingMicroUsd:
        usage === null ? null : Math.max(0, credit - usage.topupMicroUsd),
    },
    suspended,
    ban: banned,
    deletion,
    projects,
    runs,
    audit,
  });
}
