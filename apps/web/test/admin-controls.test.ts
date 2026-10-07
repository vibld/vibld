import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { requestAccountDeletion } from '../worker/account-deletion.ts';
import type { DeletionDeps } from '../worker/account-deletion.ts';
import { AccountDeletionStore } from '../worker/account-deletion-store.ts';
import { AdminStore } from '../worker/admin-store.ts';
import type { AuditEntry } from '../worker/admin-store.ts';
import {
  ADMIN_USER_ROUTES,
  appendAudit,
  handleAdminUsers,
  parseGiftEnd,
  withAudit,
} from '../worker/admin-users.ts';
import type { AdminUsersDeps } from '../worker/admin-users.ts';
import { UNGATED_PATHS } from '../worker/access-gate.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { fetchClerkUser, setClerkBan } from '../worker/clerk-lookup.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  TIER_INCLUDED_MICRO_USD,
  activeProjectLimitFor,
  effectiveTier,
  giftInForce,
  monthlyAllowanceFor,
} from '../worker/entitlement.ts';
import type { PlanGift } from '../worker/entitlement.ts';
import { D1GenerationStore } from '../worker/generation-store.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { TIER_MODELS } from '../worker/model-access.ts';
import {
  isPlatformAdmin,
  parsePlatformAdmins,
} from '../worker/platform-admins.ts';
import type { Principal, PrincipalGranted } from '../worker/principal.ts';
import { handleProjects } from '../worker/project-handlers.ts';
import { ProjectStore } from '../worker/project-store.ts';
import { stopAccountBuilds } from '../worker/run-control.ts';
import { planOf, spendableFor, tierOf } from '../worker/spendable.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { schemaSql } from './fakes/schema.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The admin controls over one account (docs/decisions.md D73), against the
 * real schema: a gifted plan and where it counts, per-account overrides, a
 * ban and everything it stops, a deletion through the existing flow, the
 * audit log, and that no route does anything for a caller who is not a
 * platform admin.
 *
 * Clerk, the Workflow engine, the preview service and the publish service
 * are fakes that record what they were asked; everything in D1 is real.
 */

const ORIGIN = 'https://app.vibld.com';
const USER = 'user_target0000000000000001';
const OTHER = 'user_other00000000000000002';
const EMAIL = 'target@example.com';
const ADMIN = 'admin@vibld.com';
const NOW = '2026-09-29T12:00:00.000Z';
const WORKER = join(import.meta.dirname, '..', 'worker');

async function count(
  db: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function exec(db: D1Database, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

function world() {
  const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
  const bucket = new InMemoryR2Bucket();
  const clock = { now: new Date(NOW) };
  const calls = {
    clerk: [] as [string, boolean][],
    clerkDown: false,
    holds: [] as { slug: string; by: string; reason: string }[],
    previews: [] as string[],
    terminated: [] as string[],
    authorized: 0,
  };
  let ids = 0;
  const deletionDeps: DeletionDeps = {
    store: new AccountDeletionStore(db),
    billing: new BillingStore(db),
    github: new GitHubStore(db),
    stripe: null,
    stopPreview: null,
    bucket: null,
    ledger: null,
    deleteClerkUser: async () => ({ ok: true }),
    now: () => clock.now,
  };
  const deps: AdminUsersDeps = {
    authorize: async () => {
      calls.authorized += 1;
      return { denied: null, adminEmail: ADMIN };
    },
    lookupByEmail: async (email) =>
      email.toLowerCase() === EMAIL
        ? { ok: true, userId: USER }
        : { ok: false, error: `No user found for ${email}.` },
    clerkUser: async (userId) =>
      userId === USER
        ? {
            email: EMAIL,
            createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
            lastSignInAt: null,
            banned: false,
          }
        : null,
    setClerkBan: async (userId, banned) => {
      calls.clerk.push([userId, banned]);
      return calls.clerkDown
        ? { ok: false, error: 'Could not reach Clerk to ban the user.' }
        : { ok: true };
    },
    usage: async () => ({ monthMicroUsd: 250_000, topupMicroUsd: 0 }),
    stopBuilds: (userId) =>
      stopAccountBuilds(
        new ProjectStore(db, bucket),
        new D1GenerationStore(db, bucket),
        userId,
        clock.now,
        {
          terminate: async (runId) => {
            calls.terminated.push(runId);
          },
        },
      ),
    stopPreviews: async (userId) => {
      calls.previews.push(userId);
      return { ok: true };
    },
    // What the publish service's hold does to the row this Worker reads.
    holdSite: async (slug, by, reason) => {
      calls.holds.push({ slug, by, reason });
      await exec(
        db,
        `UPDATE published_projects SET held_at = ?2, held_by = ?3,
                held_reason = ?4 WHERE slug = ?1`,
        slug,
        clock.now.toISOString(),
        by,
        reason,
      );
      return { ok: true, slug, state: 'held' };
    },
    requestDeletion: (userId, takeDown) =>
      requestAccountDeletion(deletionDeps, userId, { takeDown }),
    now: () => clock.now,
    newId: () => `gift-${String((ids += 1)).padStart(3, '0')}`,
  };

  async function call(
    path: string,
    body?: Record<string, unknown>,
    options: { method?: string; deps?: AdminUsersDeps } = {},
  ): Promise<{ status: number; body: Record<string, any> }> {
    const method = options.method ?? (body === undefined ? 'GET' : 'POST');
    const response = await handleAdminUsers(
      new Request(`${ORIGIN}${path}`, {
        method,
        ...(body !== undefined
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      }),
      { DB: db },
      options.deps ?? deps,
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }

  async function auditRows(userId = USER) {
    return new AdminStore(db).auditFor(userId);
  }

  return { db, bucket, clock, calls, deps, call, auditRows };
}

type World = ReturnType<typeof world>;

async function seedProject(w: World, id: string, user = USER) {
  await exec(
    w.db,
    `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?4)`,
    id,
    user,
    `Project ${id}`,
    '2026-09-01T00:00:00.000Z',
  );
}

async function seedRunningBuild(w: World, projectId: string, runId: string) {
  await exec(
    w.db,
    `INSERT INTO generation_stages
       (run_id, project_id, base_revision, state, snapshot_revision, created_at, updated_at)
     VALUES (?1, ?2, NULL, 'planning', NULL, ?3, ?3)`,
    runId,
    projectId,
    '2026-09-29T11:59:00.000Z',
  );
}

async function seedLiveSite(w: World, slug: string, projectId: string) {
  await exec(
    w.db,
    `INSERT INTO published_projects
       (slug, project_id, user_id, created_at, updated_at, generation)
     VALUES (?1, ?2, ?3, ?4, ?4, 'g1')`,
    slug,
    projectId,
    USER,
    '2026-09-01T00:00:00.000Z',
  );
}

function subscription(tier: 'build' | 'ship', status = 'active') {
  return { tier, status } as const;
}

const gift = (over: Partial<PlanGift> = {}): PlanGift => ({
  tier: 'build',
  endsAt: null,
  revokedAt: null,
  ...over,
});

const at = Date.parse(NOW);

// -------------------------------------------------------------------------

describe('the effective tier with a gifted plan', () => {
  it('gives the gifted tier to a free account while the gift is in force', () => {
    const result = effectiveTier(undefined, gift({ tier: 'ship' }), at);
    assert.equal(result.tier, 'ship');
    assert.equal(result.gifted, true);
  });

  it('gives nothing once the end date has passed', () => {
    const ended = gift({ endsAt: '2026-09-29T11:59:59.999Z' });
    assert.equal(giftInForce(ended, at), false);
    const result = effectiveTier(undefined, ended, at);
    assert.equal(result.tier, 'free');
    assert.equal(result.gifted, false);
    assert.equal(result.gift, null);
  });

  it('treats the end as exclusive', () => {
    assert.equal(giftInForce(gift({ endsAt: NOW }), at), false);
    assert.equal(giftInForce(gift({ endsAt: NOW }), at - 1), true);
  });

  it('gives nothing once revoked, whatever the end date', () => {
    const revoked = gift({ revokedAt: '2026-09-28T00:00:00.000Z' });
    assert.equal(effectiveTier(undefined, revoked, at).tier, 'free');
  });

  it('withholds a plan when the end date cannot be read', () => {
    assert.equal(giftInForce(gift({ endsAt: 'next tuesday' }), at), false);
  });

  it('takes the higher of the gift and a subscription', () => {
    const above = effectiveTier(
      subscription('build'),
      gift({ tier: 'ship' }),
      at,
    );
    assert.deepEqual([above.tier, above.gifted], ['ship', true]);

    const below = effectiveTier(
      subscription('ship'),
      gift({ tier: 'build' }),
      at,
    );
    assert.deepEqual([below.tier, below.gifted], ['ship', false]);
    // Still reported, so the panel can say a gift is there.
    assert.equal(below.gift?.tier, 'build');

    const equal = effectiveTier(
      subscription('build'),
      gift({ tier: 'build' }),
      at,
    );
    assert.deepEqual([equal.tier, equal.gifted], ['build', false]);
  });

  it('counts only a subscription in force against the gift', () => {
    const lapsed = effectiveTier(
      subscription('ship', 'past_due'),
      gift({ tier: 'build' }),
      at,
    );
    assert.deepEqual([lapsed.tier, lapsed.gifted], ['build', true]);
  });

  it('parses an end date as the last moment of that day in UTC', () => {
    const parsed = parseGiftEnd('2026-12-31', new Date(NOW));
    assert.deepEqual(parsed, { ok: true, value: '2026-12-31T23:59:59.999Z' });
    assert.deepEqual(parseGiftEnd(null, new Date(NOW)), {
      ok: true,
      value: null,
    });
    assert.equal(parseGiftEnd('2026-09-01', new Date(NOW)).ok, false);
    assert.equal(parseGiftEnd('soon', new Date(NOW)).ok, false);
  });
});

describe('a gifted plan counts wherever a paid plan does', () => {
  const principal: Principal = {
    userId: USER,
    policyIdentity: EMAIL,
  };
  const billed = (db: D1Database) => ({
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  });

  it('decides the models, the allowance and the project limit', async () => {
    const w = world();
    const given = await w.call('/api/admin/user/gift', {
      userId: USER,
      tier: 'ship',
      endsAt: '2026-12-31',
      reason: 'Launch partner',
    });
    assert.equal(given.status, 200);

    // Models: `tierOf` is what `/api/plan`, `/api/chat` and `/api/config`
    // hand `decideModel`, and a paid tier is held to no model list.
    assert.equal(await tierOf(billed(w.db), principal), 'ship');
    assert.equal(TIER_MODELS.ship, undefined);

    // Allowance: what every paid route reserves against.
    const spendable = await spendableFor({ DB: w.db }, principal);
    assert.equal(spendable.monthlyAllowance, TIER_INCLUDED_MICRO_USD.ship);

    // The project limit, read by the projects route with no tier injected.
    const projects = await handleProjects(
      new Request(`${ORIGIN}/api/projects`),
      { DB: w.db, PROJECT_CONTENT: w.bucket },
      {
        resolvePrincipal: async () =>
          ({ denied: null, principal }) as PrincipalGranted,
      },
    );
    const listed = (await projects.json()) as {
      limits: { tier: string; maxActive: number | null };
    };
    assert.equal(listed.limits.tier, 'ship');
    assert.equal(listed.limits.maxActive, ACTIVE_PROJECT_LIMIT.ship);
  });

  it('stops counting when revoked, and when it runs out', async () => {
    const w = world();
    await w.call('/api/admin/user/gift', {
      userId: USER,
      tier: 'build',
      endsAt: '2026-10-15',
    });
    assert.equal((await planOf(w.db, USER, at)).tier, 'build');
    // Past its last day.
    assert.equal(
      (await planOf(w.db, USER, Date.parse('2026-10-16T00:00:00.000Z'))).tier,
      'free',
    );

    const revoked = await w.call('/api/admin/user/gift/revoke', {
      userId: USER,
      reason: 'Partner programme ended',
    });
    assert.equal(revoked.status, 200);
    assert.equal(await tierOf(billed(w.db), principal), 'free');
    assert.equal(
      (await spendableFor({ DB: w.db }, principal)).monthlyAllowance,
      DEFAULT_FREE_INCLUDED_MICRO_USD,
    );
  });

  it('keeps a real subscription above a lesser gift', async () => {
    const w = world();
    await exec(
      w.db,
      `INSERT INTO billing_subscriptions
         (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
          price_id, current_period_end, cancel_at_period_end, created_at,
          updated_at)
       VALUES ('sub_1', ?1, 'cus_1', 'ship', 'active', 'price_ship', NULL, 0, ?2, ?2)`,
      USER,
      NOW,
    );
    await w.call('/api/admin/user/gift', { userId: USER, tier: 'build' });
    const plan = await planOf(w.db, USER, at);
    assert.deepEqual([plan.tier, plan.gifted], ['ship', false]);
    assert.equal(plan.subscription?.tier, 'ship');
  });

  it('replaces an earlier gift rather than stacking one on it', async () => {
    const w = world();
    await w.call('/api/admin/user/gift', { userId: USER, tier: 'ship' });
    await w.call('/api/admin/user/gift', { userId: USER, tier: 'build' });
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM plan_gifts WHERE user_id = ?1 AND revoked_at IS NULL`,
        USER,
      ),
      1,
    );
    assert.equal((await planOf(w.db, USER, at)).tier, 'build');
  });

  it('refuses a tier that is not paid, and an end already past', async () => {
    const w = world();
    const free = await w.call('/api/admin/user/gift', {
      userId: USER,
      tier: 'free',
    });
    assert.equal(free.status, 400);
    const past = await w.call('/api/admin/user/gift', {
      userId: USER,
      tier: 'build',
      endsAt: '2026-01-01',
    });
    assert.equal(past.status, 400);
    assert.equal(await count(w.db, `SELECT COUNT(*) AS n FROM plan_gifts`), 0);
    assert.equal(
      await count(w.db, `SELECT COUNT(*) AS n FROM admin_audit_log`),
      0,
    );
  });
});

describe('per-account overrides', () => {
  const principal: Principal = { userId: USER, policyIdentity: EMAIL };

  async function create(w: World) {
    const response = await handleProjects(
      new Request(`${ORIGIN}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ name: 'New' }),
      }),
      { DB: w.db, PROJECT_CONTENT: w.bucket },
      {
        resolvePrincipal: async () =>
          ({ denied: null, principal }) as PrincipalGranted,
      },
    );
    return response.status;
  }

  it('lets a free account past its project limit when raised', async () => {
    const w = world();
    const set = await w.call('/api/admin/user/overrides', {
      userId: USER,
      activeProjectLimit: 5,
      monthlySpendCapUsdCents: null,
    });
    assert.equal(set.status, 200);
    const statuses = [];
    for (let n = 0; n < 6; n += 1) statuses.push(await create(w));
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 403]);
  });

  it('holds an account below its tier when lowered', async () => {
    const w = world();
    await w.call('/api/admin/user/overrides', {
      userId: USER,
      activeProjectLimit: 1,
    });
    assert.deepEqual([await create(w), await create(w)], [201, 403]);
  });

  it('takes precedence over the tier for the monthly allowance, a gift included', async () => {
    const w = world();
    await w.call('/api/admin/user/gift', { userId: USER, tier: 'ship' });
    await w.call('/api/admin/user/overrides', {
      userId: USER,
      monthlySpendCapUsdCents: 250,
    });
    const spendable = await spendableFor({ DB: w.db }, principal);
    assert.equal(spendable.monthlyAllowance, 2_500_000);

    // Cleared, the plan decides again.
    await w.call('/api/admin/user/overrides', {
      userId: USER,
      activeProjectLimit: null,
      monthlySpendCapUsdCents: null,
    });
    assert.equal(
      (await spendableFor({ DB: w.db }, principal)).monthlyAllowance,
      TIER_INCLUDED_MICRO_USD.ship,
    );
  });

  it('is still zero for a suspended account', async () => {
    const w = world();
    await w.call('/api/admin/user/overrides', {
      userId: USER,
      monthlySpendCapUsdCents: 10_000,
    });
    await exec(
      w.db,
      `INSERT INTO billing_clawbacks
         (id, user_id, cause, stripe_event_id, stripe_charge_id,
          stripe_object_id, kind, charge_usd_cents, reversed_usd_cents,
          credit_removed_usd_cents, credit_shortfall_usd_cents,
          credit_granted_at, stripe_subscription_id, suspends, created_at)
       VALUES ('dispute:dp_1', ?1, 'dispute', 'evt_1', 'ch_1', 'cs_1',
               'topup', 100, 100, 0, 0, ?2, NULL, 1, ?2)`,
      USER,
      NOW,
    );
    const spendable = await spendableFor({ DB: w.db }, principal);
    assert.equal(spendable.monthlyAllowance, 0);
    assert.equal(spendable.suspended, true);
  });

  it('are pure where they are applied', () => {
    const none = { activeProjectLimit: null, monthlySpendCapMicroUsd: null };
    assert.equal(
      activeProjectLimitFor('free', none),
      ACTIVE_PROJECT_LIMIT.free,
    );
    assert.equal(
      activeProjectLimitFor('free', null),
      ACTIVE_PROJECT_LIMIT.free,
    );
    assert.equal(
      activeProjectLimitFor('ship', { ...none, activeProjectLimit: 2 }),
      2,
    );
    assert.equal(
      monthlyAllowanceFor('build', 1_000_000, {
        ...none,
        monthlySpendCapMicroUsd: 0,
      }),
      0,
    );
    assert.equal(
      monthlyAllowanceFor('build', 1_000_000, none),
      TIER_INCLUDED_MICRO_USD.build,
    );
  });

  it('refuses a value out of range and writes nothing', async () => {
    const w = world();
    for (const body of [
      { activeProjectLimit: -1 },
      { activeProjectLimit: 1.5 },
      { activeProjectLimit: 100_000 },
      { monthlySpendCapUsdCents: -5 },
      { monthlySpendCapUsdCents: 'lots' },
    ]) {
      const response = await w.call('/api/admin/user/overrides', {
        userId: USER,
        ...body,
      });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal(
      await count(w.db, `SELECT COUNT(*) AS n FROM user_overrides`),
      0,
    );
  });
});

describe('banning an account', () => {
  async function seeded() {
    const w = world();
    await seedProject(w, 'proj_a');
    await seedProject(w, 'proj_b');
    await seedRunningBuild(w, 'proj_a', 'run_live_1');
    await seedLiveSite(w, 'target-site', 'proj_b');
    await exec(
      w.db,
      `UPDATE projects SET share_token = 'tok_shared', shared_at = ?1 WHERE id = 'proj_a'`,
      NOW,
    );
    return w;
  }

  it('needs a reason, and does nothing without one', async () => {
    const w = await seeded();
    const refused = await w.call('/api/admin/user/ban', { userId: USER });
    assert.equal(refused.status, 400);
    assert.equal(await new AdminStore(w.db).isBanned(USER), false);
    assert.deepEqual(w.calls.clerk, []);
    assert.deepEqual(w.calls.holds, []);
  });

  it('bans at Clerk, refuses the account, stops its builds and previews, and holds its sites', async () => {
    const w = await seeded();
    const banned = await w.call('/api/admin/user/ban', {
      userId: USER,
      reason: 'Phishing pages',
    });
    assert.equal(banned.status, 200);

    // Recorded first: this is what `principal.ts` refuses on.
    assert.equal(await new AdminStore(w.db).isBanned(USER), true);
    // Clerk: the sign-in.
    assert.deepEqual(w.calls.clerk, [[USER, true]]);
    // The running build, by the same stop the owner's Stop takes.
    assert.deepEqual(w.calls.terminated, ['run_live_1']);
    assert.deepEqual(banned.body.builds, {
      stopped: ['run_live_1'],
      failed: [],
    });
    const stage = await w.db
      .prepare(
        `SELECT state FROM generation_stages WHERE run_id = 'run_live_1'`,
      )
      .first<{ state: string }>();
    assert.equal(stage?.state, 'cancelled');
    // Previews.
    assert.deepEqual(w.calls.previews, [USER]);
    // Sites, by the operator hold, with who and why.
    assert.deepEqual(w.calls.holds, [
      {
        slug: 'target-site',
        by: ADMIN,
        reason: 'Account banned: Phishing pages',
      },
    ]);
    assert.deepEqual(banned.body.sites, [{ slug: 'target-site', ok: true }]);
    // The share link stops serving with the account.
    assert.equal(
      await new ProjectStore(w.db, w.bucket).findShared('tok_shared'),
      null,
    );
  });

  it('records who and why, in the ban and in the audit log', async () => {
    const w = await seeded();
    await w.call('/api/admin/user/ban', { userId: USER, reason: 'Spam' });
    const record = await new AdminStore(w.db).ban(USER);
    assert.equal(record?.bannedBy, ADMIN);
    assert.equal(record?.reason, 'Spam');
    const [row] = await w.auditRows();
    assert.equal(row?.action, 'ban');
    assert.equal(row?.adminEmail, ADMIN);
    assert.equal(row?.reason, 'Spam');
    assert.deepEqual(row?.detail, { sites: ['target-site'] });
  });

  it('keeps the ban when Clerk cannot be reached, and says so', async () => {
    const w = await seeded();
    w.calls.clerkDown = true;
    const banned = await w.call('/api/admin/user/ban', {
      userId: USER,
      reason: 'Spam',
    });
    assert.equal(banned.status, 200);
    assert.equal(banned.body.clerk.ok, false);
    assert.equal(await new AdminStore(w.db).isBanned(USER), true);
    // Everything else still happened.
    assert.deepEqual(w.calls.terminated, ['run_live_1']);
    assert.equal(w.calls.holds.length, 1);
  });

  it('lifts sign-in and the refusal on unban, and republishes nothing', async () => {
    const w = await seeded();
    await w.call('/api/admin/user/ban', { userId: USER, reason: 'Spam' });
    const lifted = await w.call('/api/admin/user/unban', {
      userId: USER,
      reason: 'Appeal upheld',
    });
    assert.equal(lifted.status, 200);
    assert.equal(await new AdminStore(w.db).isBanned(USER), false);
    assert.deepEqual(w.calls.clerk, [
      [USER, true],
      [USER, false],
    ]);
    // Still held: releasing is a separate decision.
    assert.deepEqual(lifted.body.heldSites, ['target-site']);
    const site = await w.db
      .prepare(
        `SELECT held_at FROM published_projects WHERE slug = 'target-site'`,
      )
      .first<{ held_at: string | null }>();
    assert.notEqual(site?.held_at, null);
    const actions = (await w.auditRows()).map((row) => row.action);
    assert.deepEqual(actions, ['unban', 'ban']);
    // The share link was never held, so it serves again.
    assert.notEqual(
      await new ProjectStore(w.db, w.bucket).findShared('tok_shared'),
      null,
    );
  });

  it('refuses to unban an account that is not banned, and records nothing', async () => {
    const w = world();
    const refused = await w.call('/api/admin/user/unban', { userId: USER });
    assert.equal(refused.status, 409);
    assert.deepEqual(await w.auditRows(), []);
    assert.deepEqual(w.calls.clerk, []);
  });
});

describe('deleting an account', () => {
  it('needs the account’s own email typed, and records nothing otherwise', async () => {
    const w = world();
    for (const confirmEmail of [undefined, '', 'someone@else.com']) {
      const refused = await w.call('/api/admin/user/delete', {
        userId: USER,
        confirmEmail,
      });
      assert.equal(refused.status, 400);
    }
    assert.equal(await new AccountDeletionStore(w.db).pending(USER), null);
    assert.deepEqual(await w.auditRows(), []);
  });

  it('refuses when Clerk cannot say what the address is', async () => {
    const w = world();
    const refused = await w.call('/api/admin/user/delete', {
      userId: OTHER,
      confirmEmail: EMAIL,
    });
    assert.equal(refused.status, 503);
    assert.equal(await new AccountDeletionStore(w.db).pending(OTHER), null);
  });

  it('runs the existing deletion flow, holding sites in place of the owner’s takedown', async () => {
    const w = world();
    await seedProject(w, 'proj_a');
    await seedLiveSite(w, 'target-site', 'proj_a');
    const deleted = await w.call('/api/admin/user/delete', {
      userId: USER,
      confirmEmail: '  Target@Example.com ',
      reason: 'Asked by email',
    });
    assert.equal(deleted.status, 200);

    // The very record the self-serve route makes: `principal.ts` now
    // refuses the account, and the nightly pass will purge it.
    const record = await new AccountDeletionStore(w.db).find(USER);
    assert.ok(record);
    assert.equal(record.requestedAt, NOW);
    assert.equal(record.purgeAfter, '2026-10-29T12:00:00.000Z');
    assert.equal(deleted.body.purgeAfter, record.purgeAfter);
    // The sites step is done by the hold.
    assert.notEqual(record.done.sites, null);
    assert.deepEqual(w.calls.holds, [
      {
        slug: 'target-site',
        by: ADMIN,
        reason: 'Account deleted by an admin: Asked by email',
      },
    ]);

    const [row] = await w.auditRows();
    assert.equal(row?.action, 'delete');
    assert.equal(row?.reason, 'Asked by email');
  });

  it('writes no deletion of its own', async () => {
    // D73: an admin's deletion is the existing flow, asked for by someone
    // else. A second path would be one that could come to delete
    // differently.
    const source = await readFile(join(WORKER, 'admin-users.ts'), 'utf8');
    assert.doesNotMatch(source, /DELETE FROM/);
    assert.doesNotMatch(source, /account_deletions/);
    assert.match(source, /deps\.requestDeletion\(/);
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    assert.match(
      index,
      /requestDeletion: \(userId, takeDown\) =>\s+requestAccountDeletion\(deletionDepsFor\(env\), userId, \{ takeDown \}\)/,
    );
  });
});

describe('the audit log', () => {
  it('has a row for every action this module takes, newest first', async () => {
    const w = world();
    await w.call('/api/admin/user/gift', { userId: USER, tier: 'build' });
    await w.call('/api/admin/user/gift/revoke', { userId: USER });
    await w.call('/api/admin/user/overrides', {
      userId: USER,
      activeProjectLimit: 4,
    });
    await w.call('/api/admin/user/ban', { userId: USER, reason: 'Spam' });
    await w.call('/api/admin/user/unban', { userId: USER });
    await w.call('/api/admin/user/delete', {
      userId: USER,
      confirmEmail: EMAIL,
    });
    const rows = await w.auditRows();
    assert.deepEqual(
      rows.map((row) => row.action),
      ['delete', 'unban', 'ban', 'overrides', 'gift-revoke', 'gift'],
    );
    for (const row of rows) {
      assert.equal(row.adminEmail, ADMIN);
      assert.equal(row.targetUserId, USER);
      assert.equal(row.at, NOW);
    }
    const listed = await w.call('/api/admin/audit');
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listed.body.entries.map((row: { action: string }) => row.action),
      rows.map((row) => row.action),
    );
  });

  it('writes no row for an action that did nothing', async () => {
    const w = world();
    const refused = await w.call('/api/admin/user/gift/revoke', {
      userId: USER,
    });
    assert.equal(refused.status, 409);
    assert.deepEqual(await w.auditRows(), []);
  });

  it('is append-only in the database itself', async () => {
    const w = world();
    const store = new AdminStore(w.db);
    await store.append({
      at: NOW,
      adminEmail: ADMIN,
      action: 'topup',
      targetUserId: USER,
      target: null,
      reason: 'goodwill',
      detail: { creditUsdCents: 500 },
    });
    await assert.rejects(
      exec(w.db, `DELETE FROM admin_audit_log`),
      /append-only/,
    );
    await assert.rejects(
      exec(w.db, `UPDATE admin_audit_log SET reason = 'edited'`),
      /append-only/,
    );
    await assert.rejects(
      exec(w.db, `UPDATE admin_audit_log SET action = 'gift'`),
      /append-only/,
    );
    // The one change allowed: the account purge re-keying the target.
    await exec(
      w.db,
      `UPDATE admin_audit_log SET target_user_id = 'deleted-x' WHERE target_user_id = ?1`,
      USER,
    );
    assert.equal((await store.auditFor('deleted-x')).length, 1);
  });

  it('records an older action once its route answers with success, and not before', async () => {
    const w = world();
    const entry: AuditEntry = {
      at: NOW,
      adminEmail: ADMIN,
      action: 'site-hold',
      targetUserId: USER,
      target: 'target-site',
      reason: 'Malware',
      detail: null,
    };
    const ok = await withAudit(
      w.db,
      new Response(JSON.stringify({ slug: 'target-site', state: 'held' })),
      () => entry,
    );
    assert.deepEqual(await ok.json(), {
      slug: 'target-site',
      state: 'held',
      audited: true,
    });
    const refused = await withAudit(
      w.db,
      new Response(JSON.stringify({ error: 'No such site.' }), { status: 404 }),
      () => entry,
    );
    assert.equal(refused.status, 404);
    assert.deepEqual(await refused.json(), { error: 'No such site.' });
    assert.equal((await w.auditRows()).length, 1);
  });

  it('says so, rather than failing the action, when the row cannot be written', async () => {
    const broken = {
      prepare() {
        throw new Error('D1 is unavailable');
      },
    } as unknown as D1Database;
    assert.equal(
      await appendAudit(broken, {
        at: NOW,
        adminEmail: ADMIN,
        action: 'topup',
        targetUserId: USER,
        target: null,
        reason: null,
        detail: null,
      }),
      false,
    );
  });

  it('is written by the admin actions that came before it', async () => {
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const body = (name: string) => {
      const start = index.indexOf(`async function ${name}(`);
      assert.ok(start > 0, `no ${name}`);
      return index.slice(start, index.indexOf('\n}', start));
    };
    assert.match(body('handleAdminTopup'), /appendAudit\(/);
    assert.match(body('handleAdminTopup'), /action: 'topup'/);
    assert.match(body('handleAdminLiftSuspension'), /withAudit\(/);
    assert.match(body('handleAdminLiftSuspension'), /'suspension-lift'/);
    const hold = body('handleAdminHold');
    for (const action of [
      "'site-hold'",
      "'site-release'",
      "'share-hold'",
      "'share-release'",
    ]) {
      assert.ok(hold.includes(action), `${action} is not recorded`);
    }
    // Twice for the share path and once each for hold and release.
    assert.ok((hold.match(/withAudit\(|audit\(/g) ?? []).length >= 3);
  });

  it('never stores a share token, only the project it belongs to', async () => {
    const w = world();
    await seedProject(w, 'proj_a');
    await exec(
      w.db,
      `UPDATE projects SET share_token = 'tok_secret' WHERE id = 'proj_a'`,
    );
    assert.deepEqual(await new AdminStore(w.db).shareOwner('tok_secret'), {
      projectId: 'proj_a',
      userId: USER,
    });
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    assert.match(
      index,
      /target: owner \? `project:\$\{owner\.projectId\}` : 'share link'/,
    );
  });
});

describe('the account page', () => {
  it("shows a Free account on the trial its trial, not a month's (D159)", async () => {
    const w = world();
    const periods: (string | undefined)[] = [];
    const response = await handleAdminUsers(
      new Request(`${ORIGIN}/api/admin/user/detail?userId=${USER}`),
      { DB: w.db, STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' },
      {
        ...w.deps,
        usage: async (_userId, _now, period) => {
          periods.push(period);
          return { monthMicroUsd: 150_000, topupMicroUsd: 0 };
        },
      },
    );
    const body = (await response.json()) as Record<string, any>;
    assert.deepEqual(periods, ['trial']);
    assert.equal(body.limits.trial, true);
    assert.equal(body.limits.monthlyAllowanceMicroUsd, 200_000);
    assert.equal(body.limits.tierMonthlyAllowanceMicroUsd, 1_000_000);
    assert.equal(body.spend.monthMicroUsd, 150_000);
  });

  it('finds an account by email and shows what it has', async () => {
    const w = world();
    await seedProject(w, 'proj_a');
    await seedRunningBuild(w, 'proj_a', 'run_1');
    await seedLiveSite(w, 'target-site', 'proj_a');
    await w.call('/api/admin/user/gift', {
      userId: USER,
      tier: 'build',
      endsAt: '2026-12-31',
    });
    await w.call('/api/admin/user/overrides', {
      userId: USER,
      activeProjectLimit: 7,
    });

    const page = await w.call(`/api/admin/user/detail?email=${EMAIL}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.userId, USER);
    assert.equal(page.body.email, EMAIL);
    assert.equal(page.body.plan.tier, 'build');
    assert.equal(page.body.plan.gifted, true);
    assert.equal(page.body.plan.gift.endsAt, '2026-12-31T23:59:59.999Z');
    assert.equal(page.body.limits.activeProjects, 7);
    assert.equal(page.body.limits.tierActiveProjects, null);
    assert.equal(page.body.spend.monthMicroUsd, 250_000);
    assert.deepEqual(page.body.projects[0].site, {
      slug: 'target-site',
      state: 'live',
      url: 'https://target-site.vibld-preview.dev/',
    });
    assert.deepEqual(
      page.body.running.map((run: { runId: string }) => run.runId),
      ['run_1'],
    );
    assert.equal(page.body.canStopBuilds, true);
    assert.equal(page.body.runs[0].runId, 'run_1');
    assert.equal(page.body.runs[0].state, 'planning');
    assert.deepEqual(
      page.body.audit.map((row: { action: string }) => row.action),
      ['overrides', 'gift'],
    );
    assert.equal(page.body.ban, null);
  });

  it('answers 404 for an address Clerk does not know', async () => {
    const w = world();
    const page = await w.call(
      '/api/admin/user/detail?email=nobody@example.com',
    );
    assert.equal(page.status, 404);
  });
});

describe('the deeper account page (D128)', () => {
  async function trace(
    w: World,
    runId: string,
    projectId: string,
    endedAt: string,
    cost: number,
  ) {
    await exec(
      w.db,
      `INSERT INTO generation_run_traces
         (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
          output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at)
       VALUES (?1, ?2, 'applied', 'm', 1, 0, 1, 1000, ?3, 10, ?4)`,
      runId,
      projectId,
      cost,
      endedAt,
    );
  }

  it('adds up spend by month for a year, the account’s own traces included', async () => {
    const w = world();
    await seedProject(w, 'proj_a');
    await seedProject(w, 'proj_other', OTHER);
    await trace(w, 'r1', 'proj_a', '2026-09-03T00:00:00.000Z', 100_000);
    await trace(w, 'r2', 'proj_a', '2026-09-20T00:00:00.000Z', 50_000);
    // Written against the account itself (a chat turn), not a project.
    await trace(w, 'r3', USER, '2026-08-31T23:59:59.000Z', 7_000);
    // More than a year back: outside the table.
    await trace(w, 'r4', 'proj_a', '2025-09-30T00:00:00.000Z', 999);
    // Somebody else's.
    await trace(w, 'r5', 'proj_other', '2026-09-03T00:00:00.000Z', 1);
    const page = await w.call(`/api/admin/user/detail?userId=${USER}`);
    assert.deepEqual(page.body.spendByMonth, [
      { month: '2026-09', costMicroUsd: 150_000, runs: 2 },
      { month: '2026-08', costMicroUsd: 7_000, runs: 1 },
    ]);
  });

  it('starts the year on the first of the month eleven months back', async () => {
    const { spendSince } = await import('../worker/admin-users.ts');
    assert.equal(
      spendSince(new Date('2026-09-29T12:00:00.000Z')),
      '2025-10-01T00:00:00.000Z',
    );
    assert.equal(
      spendSince(new Date('2026-01-01T00:00:00.000Z')),
      '2025-02-01T00:00:00.000Z',
    );
  });

  it('shows the GitHub sign-in and repositories, and never a token', async () => {
    const w = world();
    await seedProject(w, 'proj_a');
    await exec(
      w.db,
      `INSERT INTO github_connections
         (user_id, login, installation_id, connected_at, granted_by_email)
       VALUES (?1, 'octo', 42, '2026-09-02T00:00:00.000Z', ?2)`,
      USER,
      EMAIL,
    );
    await exec(
      w.db,
      `INSERT INTO github_project_bindings
         (project_id, user_id, installation_id, owner, repo, default_branch,
          granted_at, granted_by_email, expires_at)
       VALUES ('proj_a', ?1, 42, 'octo', 'site', 'main',
               '2026-09-02T00:00:00.000Z', ?2, '2026-12-02T00:00:00.000Z')`,
      USER,
      EMAIL,
    );
    const page = await w.call(`/api/admin/user/detail?userId=${USER}`);
    assert.deepEqual(page.body.github, {
      connection: {
        login: 'octo',
        connectedAt: '2026-09-02T00:00:00.000Z',
        revokedAt: null,
      },
      repositories: [
        {
          projectId: 'proj_a',
          projectName: 'Project proj_a',
          owner: 'octo',
          repo: 'site',
          defaultBranch: 'main',
          grantedAt: '2026-09-02T00:00:00.000Z',
          expiresAt: '2026-12-02T00:00:00.000Z',
          revokedAt: null,
        },
      ],
    });
    const other = await w.call(`/api/admin/user/detail?userId=${OTHER}`);
    assert.deepEqual(other.body.github, { connection: null, repositories: [] });
  });

  it('stops the running builds without banning, and records it', async () => {
    const w = world();
    await seedProject(w, 'proj_a');
    await seedRunningBuild(w, 'proj_a', 'run_live_1');
    const stopped = await w.call('/api/admin/user/stop-builds', {
      userId: USER,
      reason: 'Looping',
    });
    assert.equal(stopped.status, 200);
    assert.deepEqual(stopped.body.builds, {
      stopped: ['run_live_1'],
      failed: [],
    });
    assert.equal(stopped.body.audited, true);
    assert.deepEqual(w.calls.terminated, ['run_live_1']);
    // Not a ban: no Clerk call, no refusal, no previews, no sites.
    assert.equal(await new AdminStore(w.db).isBanned(USER), false);
    assert.deepEqual(w.calls.clerk, []);
    assert.deepEqual(w.calls.previews, []);
    const [row] = await w.auditRows();
    assert.equal(row?.action, 'stop-builds');
    assert.equal(row?.reason, 'Looping');
    assert.deepEqual(row?.detail, { stopped: 1, stillRunning: 0 });
    const page = await w.call(`/api/admin/user/detail?userId=${USER}`);
    assert.deepEqual(page.body.running, []);
  });

  it('says so where the deployment runs no builds, and records nothing', async () => {
    const w = world();
    const refused = await w.call(
      '/api/admin/user/stop-builds',
      { userId: USER },
      { deps: { ...w.deps, stopBuilds: null } },
    );
    assert.equal(refused.status, 409);
    assert.deepEqual(await w.auditRows(), []);
    const page = await w.call(
      `/api/admin/user/detail?userId=${USER}`,
      undefined,
      {
        deps: { ...w.deps, stopBuilds: null },
      },
    );
    assert.equal(page.body.canStopBuilds, false);
  });

  it('answers 502, and records nothing, when the builds cannot be listed', async () => {
    const w = world();
    const failed = await w.call(
      '/api/admin/user/stop-builds',
      { userId: USER },
      {
        deps: {
          ...w.deps,
          stopBuilds: async () => {
            throw new Error('D1 down');
          },
        },
      },
    );
    assert.equal(failed.status, 502);
    assert.deepEqual(await w.auditRows(), []);
  });
});

describe('who may use these routes', () => {
  const METHOD: Record<string, string> = {
    '/api/admin/user/detail': 'GET',
    '/api/admin/audit': 'GET',
  };

  it('refuses every route to a caller who is not an admin, before doing anything', async () => {
    const w = world();
    let asked = 0;
    const denied: AdminUsersDeps = {
      ...w.deps,
      authorize: async () => {
        asked += 1;
        return {
          denied: new Response(JSON.stringify({ error: 'Not authorized.' }), {
            status: 403,
          }),
        };
      },
      setClerkBan: async () => {
        throw new Error('reached Clerk');
      },
      requestDeletion: async () => {
        throw new Error('reached the deletion');
      },
    };
    for (const route of ADMIN_USER_ROUTES) {
      const method = METHOD[route] ?? 'POST';
      const response = await w.call(
        method === 'GET' ? `${route}?userId=${USER}` : route,
        method === 'GET'
          ? undefined
          : {
              userId: USER,
              tier: 'ship',
              reason: 'x',
              confirmEmail: EMAIL,
              activeProjectLimit: 9,
            },
        { method, deps: denied },
      );
      assert.equal(response.status, 403, route);
    }
    assert.equal(asked, ADMIN_USER_ROUTES.length);
    for (const table of [
      'plan_gifts',
      'user_overrides',
      'user_bans',
      'admin_audit_log',
      'account_deletions',
    ]) {
      assert.equal(
        await count(w.db, `SELECT COUNT(*) AS n FROM ${table}`),
        0,
        table,
      );
    }
  });

  it('decides by the platform-admin list, on a verified email only', async () => {
    const admins = parsePlatformAdmins(ADMIN);
    const guardFor = (claims: { email?: string; emailVerified?: boolean }) =>
      (async () =>
        isPlatformAdmin(claims, admins)
          ? { denied: null, adminEmail: claims.email! }
          : {
              denied: new Response(
                JSON.stringify({ error: 'Not authorized.' }),
                { status: 403 },
              ),
            }) as AdminUsersDeps['authorize'];
    const w = world();
    const as = async (claims: { email?: string; emailVerified?: boolean }) =>
      (
        await w.call(`/api/admin/user/detail?userId=${USER}`, undefined, {
          deps: { ...w.deps, authorize: guardFor(claims) },
        })
      ).status;
    assert.equal(await as({ email: EMAIL, emailVerified: true }), 403);
    assert.equal(await as({ email: ADMIN, emailVerified: false }), 403);
    assert.equal(await as({}), 403);
    assert.equal(await as({ email: ADMIN, emailVerified: true }), 200);
  });

  it('is wired to the same check as every other admin route', async () => {
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    // Routed by the module's own list, so a route added there is routed.
    assert.match(
      index,
      /if \(isAdminUserRoute\(pathname\)\) \{\s*return handleAdminUsers\(/,
    );
    for (const route of ADMIN_USER_ROUTES) {
      assert.equal(
        UNGATED_PATHS[route],
        'behind the platform-admin check instead',
      );
    }
    assert.match(
      index,
      /return handleAdminUsers\(request, env, adminUsersDeps\(env\)\);/,
    );
    const start = index.indexOf('function adminUsersDeps(');
    const deps = index.slice(start, index.indexOf('\n}', start));
    assert.match(deps, /authorize: \(req\) => requireAdmin\(req, env\)/);
    // The operator hold, only ever through the one function that calls it.
    assert.match(deps, /operatorHold\(env, slug, by, reason\)/);
    assert.doesNotMatch(deps, /handleUnpublish/);
  });

  it('asks before it reads the body', async () => {
    const source = await readFile(join(WORKER, 'admin-users.ts'), 'utf8');
    const start = source.indexOf('export async function handleAdminUsers(');
    const body = source.slice(start);
    assert.ok(
      body.indexOf('deps.authorize(') < body.indexOf('readBody('),
      'reads the body before checking the caller',
    );
  });
});

describe('the Clerk calls', () => {
  it('bans and unbans through the Backend API with the Worker’s secret', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const env = { CLERK_SECRET_KEY: 'sk_test_x' };
    assert.deepEqual(await setClerkBan(env, USER, true, fetchImpl), {
      ok: true,
    });
    assert.deepEqual(await setClerkBan(env, USER, false, fetchImpl), {
      ok: true,
    });
    assert.deepEqual(
      calls.map((call) => [call.url, call.init.method]),
      [
        [`https://api.clerk.com/v1/users/${USER}/ban`, 'POST'],
        [`https://api.clerk.com/v1/users/${USER}/unban`, 'POST'],
      ],
    );
    assert.equal(
      (calls[0]!.init.headers as Record<string, string>).authorization,
      'Bearer sk_test_x',
    );
  });

  it('reports a refusal and a missing secret rather than claiming success', async () => {
    const refusing = (async () =>
      new Response('{}', { status: 404 })) as unknown as typeof fetch;
    const refused = await setClerkBan(
      { CLERK_SECRET_KEY: 'sk' },
      USER,
      true,
      refusing,
    );
    assert.equal(refused.ok, false);
    const unset = await setClerkBan({}, USER, true, refusing);
    assert.equal(unset.ok, false);
  });

  it('reads the primary address of a user', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          primary_email_address_id: 'idn_2',
          email_addresses: [
            { id: 'idn_1', email_address: 'old@example.com' },
            { id: 'idn_2', email_address: EMAIL },
          ],
          created_at: 1_700_000_000_000,
          last_sign_in_at: null,
          banned: true,
        }),
      )) as unknown as typeof fetch;
    const user = await fetchClerkUser(
      { CLERK_SECRET_KEY: 'sk' },
      USER,
      fetchImpl,
    );
    assert.deepEqual(user, {
      email: EMAIL,
      createdAt: 1_700_000_000_000,
      lastSignInAt: null,
      banned: true,
    });
  });
});
