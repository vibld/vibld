import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { UNGATED_PATHS } from '../worker/access-gate.ts';
import { AdminStore } from '../worker/admin-store.ts';
import type { AuditEntry } from '../worker/admin-store.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  TIER_INCLUDED_MICRO_USD,
  activeProjectLimitFor,
  monthlyAllowanceFor,
} from '../worker/entitlement.ts';
import {
  PLAN_CACHE_MS,
  PLAN_ROUTES,
  codePlanLimits,
  forgetPlanLimits,
  handlePlanLimits,
  planLimitsFor,
  savedPlanLimits,
} from '../worker/plan-limits.ts';
import { projectLimitOf, spendableFor } from '../worker/spendable.ts';
import type { Principal } from '../worker/principal.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Plan limits set in the admin panel (docs/decisions.md D134): saved per
 * plan, used wherever a plan's limit is, behind an account's own override,
 * reset to the code's, and every change audited.
 */

const WORKER = join(import.meta.dirname, '..', 'worker');
const ADMIN = 'admin@example.com';
const FREE = 1_000_000;

function world() {
  const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
  const audits: AuditEntry[] = [];
  const call = async (path: string, body?: unknown) => {
    const response = await handlePlanLimits(
      new Request(`https://app.vibld.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      }),
      db,
      {
        adminEmail: ADMIN,
        audit: async (entry) => {
          audits.push(entry);
          return true;
        },
        freeAllowanceMicroUsd: FREE,
        now: () => new Date('2026-10-01T04:00:00.000Z'),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  return { db, audits, call };
}

const principal = (userId: string): Principal =>
  ({ userId, policyIdentity: `${userId}@example.com` }) as Principal;

beforeEach(() => forgetPlanLimits());

describe('a plan’s limits (D134)', () => {
  it('keeps the code’s until an admin saves some', async () => {
    const w = world();
    const listed = await w.call('/api/admin/plans');
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listed.body.plans.map((p: any) => [p.tier, p.limits, p.saved]),
      [
        [
          'free',
          { activeProjectLimit: 3, monthlyAllowanceMicroUsd: FREE },
          null,
        ],
        [
          'build',
          {
            activeProjectLimit: null,
            monthlyAllowanceMicroUsd: TIER_INCLUDED_MICRO_USD.build,
          },
          null,
        ],
        [
          'ship',
          {
            activeProjectLimit: null,
            monthlyAllowanceMicroUsd: TIER_INCLUDED_MICRO_USD.ship,
          },
          null,
        ],
      ],
    );
  });

  it('saves a plan’s limits, shows them beside the code’s, and audits it', async () => {
    const w = world();
    const saved = await w.call('/api/admin/plans', {
      tier: 'free',
      activeProjectLimit: 5,
      monthlyAllowanceUsdCents: 250,
    });
    assert.equal(saved.status, 200);
    const free = saved.body.plans.find((p: any) => p.tier === 'free');
    assert.deepEqual(free.limits, {
      activeProjectLimit: 5,
      monthlyAllowanceMicroUsd: 2_500_000,
    });
    assert.deepEqual(free.code, {
      activeProjectLimit: ACTIVE_PROJECT_LIMIT.free,
      monthlyAllowanceMicroUsd: FREE,
    });
    assert.equal(free.saved.updatedBy, ADMIN);
    assert.deepEqual(w.audits, [
      {
        at: '2026-10-01T04:00:00.000Z',
        adminEmail: ADMIN,
        action: 'plan-limits',
        targetUserId: null,
        target: 'free',
        reason: null,
        detail: { activeProjectLimit: 5, monthlyAllowanceMicroUsd: 2_500_000 },
      },
    ]);
  });

  it('can lift a plan’s project limit entirely, or set one where there was none', async () => {
    const w = world();
    await w.call('/api/admin/plans', {
      tier: 'free',
      activeProjectLimit: null,
      monthlyAllowanceUsdCents: 100,
    });
    await w.call('/api/admin/plans', {
      tier: 'build',
      activeProjectLimit: 20,
      monthlyAllowanceUsdCents: 1_000,
    });
    const saved = await savedPlanLimits(w.db);
    assert.equal(planLimitsFor('free', saved, FREE).activeProjectLimit, null);
    assert.equal(planLimitsFor('build', saved, FREE).activeProjectLimit, 20);
  });

  it('resets a plan to the code’s, and refuses a reset with nothing to reset', async () => {
    const w = world();
    await w.call('/api/admin/plans', {
      tier: 'ship',
      activeProjectLimit: 50,
      monthlyAllowanceUsdCents: 2_000,
    });
    const reset = await w.call('/api/admin/plans/reset', { tier: 'ship' });
    assert.equal(reset.status, 200);
    const ship = reset.body.plans.find((p: any) => p.tier === 'ship');
    assert.deepEqual(ship.limits, codePlanLimits('ship', FREE));
    assert.equal(ship.saved, null);
    assert.equal(w.audits.at(-1)!.action, 'plan-limits-reset');
    assert.equal(
      (await w.call('/api/admin/plans/reset', { tier: 'ship' })).status,
      409,
    );
    assert.equal(w.audits.length, 2);
  });

  it('refuses limits out of range, and an unknown plan, saving nothing', async () => {
    const w = world();
    for (const body of [
      { tier: 'gold', activeProjectLimit: 1, monthlyAllowanceUsdCents: 1 },
      { tier: 'free', activeProjectLimit: -1, monthlyAllowanceUsdCents: 1 },
      { tier: 'free', activeProjectLimit: 1.5, monthlyAllowanceUsdCents: 1 },
      { tier: 'free', activeProjectLimit: 1_001, monthlyAllowanceUsdCents: 1 },
      { tier: 'free', activeProjectLimit: 1, monthlyAllowanceUsdCents: null },
      {
        tier: 'free',
        activeProjectLimit: 1,
        monthlyAllowanceUsdCents: 1_000_001,
      },
      { tier: 'free', activeProjectLimit: '3', monthlyAllowanceUsdCents: 1 },
    ]) {
      assert.equal(
        (await w.call('/api/admin/plans', body)).status,
        400,
        JSON.stringify(body),
      );
    }
    assert.deepEqual(await savedPlanLimits(w.db), {});
    assert.deepEqual(w.audits, []);
  });

  it('reads once for requests that arrive together, and keeps no failed read', async () => {
    const w = world();
    let reads = 0;
    let fail = true;
    const flaky = {
      prepare: (sql: string) => {
        reads += 1;
        if (fail) throw new Error('D1 down');
        return w.db.prepare(sql);
      },
    } as unknown as D1Database;
    await assert.rejects(savedPlanLimits(flaky, 2_000_000));
    fail = false;
    const all = await Promise.all(
      Array.from({ length: 6 }, () => savedPlanLimits(flaky, 2_000_001)),
    );
    assert.equal(reads, 2);
    for (const saved of all) assert.deepEqual(saved, {});
  });

  it('reads the saved limits once per window', async () => {
    const w = world();
    await w.call('/api/admin/plans', {
      tier: 'free',
      activeProjectLimit: 4,
      monthlyAllowanceUsdCents: 100,
    });
    forgetPlanLimits();
    let reads = 0;
    const counting = {
      prepare: (sql: string) => {
        reads += 1;
        return w.db.prepare(sql);
      },
    } as unknown as D1Database;
    await savedPlanLimits(counting, 1_000_000);
    await savedPlanLimits(counting, 1_000_000 + PLAN_CACHE_MS - 1);
    assert.equal(reads, 1);
    await savedPlanLimits(counting, 1_000_000 + PLAN_CACHE_MS);
    assert.equal(reads, 2);
  });
});

describe('where a plan’s limits count', () => {
  it('comes after an account’s own override, and before the code’s', () => {
    const plan = { activeProjectLimit: 7, monthlyAllowanceMicroUsd: 3_000_000 };
    assert.equal(activeProjectLimitFor('free', null, plan), 7);
    assert.equal(activeProjectLimitFor('free', null), 3);
    assert.equal(
      activeProjectLimitFor(
        'free',
        { activeProjectLimit: 9, monthlySpendCapMicroUsd: null },
        plan,
      ),
      9,
    );
    // An override that leaves the limit to the plan.
    assert.equal(
      activeProjectLimitFor(
        'free',
        { activeProjectLimit: null, monthlySpendCapMicroUsd: 1 },
        plan,
      ),
      7,
    );
    // A plan with no limit at all, which an absent override keeps.
    assert.equal(
      activeProjectLimitFor('free', null, {
        activeProjectLimit: null,
        monthlyAllowanceMicroUsd: 1,
      }),
      null,
    );
    assert.equal(monthlyAllowanceFor('free', FREE, null, plan), 3_000_000);
    assert.equal(
      monthlyAllowanceFor(
        'free',
        FREE,
        { activeProjectLimit: null, monthlySpendCapMicroUsd: 5 },
        plan,
      ),
      5,
    );
  });

  it('holds a Free account to the saved project limit and allowance', async () => {
    const w = world();
    assert.equal(await projectLimitOf(w.db, 'user_a', 'free'), 3);
    await w.call('/api/admin/plans', {
      tier: 'free',
      activeProjectLimit: 6,
      monthlyAllowanceUsdCents: 300,
    });
    assert.equal(await projectLimitOf(w.db, 'user_a', 'free'), 6);
    const spendable = await spendableFor({ DB: w.db }, principal('user_a'));
    assert.equal(spendable.monthlyAllowance, 3_000_000);
    // An account's own override still comes first.
    await new AdminStore(w.db).setOverrides(
      'user_a',
      { activeProjectLimit: 1, monthlySpendCapMicroUsd: null },
      ADMIN,
      '2026-10-01T04:00:00.000Z',
      {
        at: '2026-10-01T04:00:00.000Z',
        adminEmail: ADMIN,
        action: 'overrides',
        targetUserId: 'user_a',
        target: null,
        reason: null,
        detail: null,
      },
    );
    assert.equal(await projectLimitOf(w.db, 'user_a', 'free'), 1);
  });

  it('is routed behind the admin check, and read wherever a plan’s limits are', async () => {
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const start = index.indexOf('if (isPlanRoute(pathname))');
    assert.ok(start > 0);
    const block = index.slice(start, index.indexOf('\n  }\n', start));
    assert.ok(
      block.indexOf('requireAdmin(request, env)') <
        block.indexOf('handlePlanLimits('),
    );
    for (const path of PLAN_ROUTES) {
      assert.equal(
        UNGATED_PATHS[path],
        'behind the platform-admin check instead',
      );
    }
    // `/api/plan`, the account page and the two readings every run and
    // every new project make.
    assert.match(index, /planLimitsFor\(tier, savedPlans, freeAllowance\)/);
    const users = await readFile(join(WORKER, 'admin-users.ts'), 'utf8');
    assert.match(users, /await savedPlanLimits\(db\)/);
    const spendable = await readFile(join(WORKER, 'spendable.ts'), 'utf8');
    assert.equal(spendable.split('savedPlanLimits(').length - 1, 2);
  });
});
