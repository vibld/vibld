import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MAX_OVERVIEW_DAYS,
  handleOverview,
  overviewDays,
  overviewWindow,
  readBalances,
  readOverview,
} from '../worker/admin-overview.ts';
import { UNGATED_PATHS } from '../worker/access-gate.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The platform overview (docs/decisions.md D128), against the real schema:
 * each day's figures, the totals, the accounts seen lately, and the
 * balances this deployment can and cannot read.
 */

const NOW = new Date('2026-10-01T12:00:00.000Z');
const noBalances = async () => [];

function world() {
  const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
  const exec = (sql: string, ...values: unknown[]) =>
    db
      .prepare(sql)
      .bind(...values)
      .run();
  return { db, exec };
}

async function account(
  w: ReturnType<typeof world>,
  userId: string,
  firstSeen: string,
  lastSeen: string,
) {
  await w.exec(
    `INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
     VALUES (?1, NULL, ?2, ?3)`,
    userId,
    firstSeen,
    lastSeen,
  );
}

async function project(w: ReturnType<typeof world>, id: string, user: string) {
  await w.exec(
    `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
     VALUES (?1, ?2, ?1, ?3, ?3, ?3)`,
    id,
    user,
    '2026-09-01T00:00:00.000Z',
  );
}

async function stage(
  w: ReturnType<typeof world>,
  runId: string,
  projectId: string,
  state: string,
  at: string,
) {
  await w.exec(
    `INSERT INTO generation_stages
       (run_id, project_id, base_revision, state, snapshot_revision, created_at, updated_at)
     VALUES (?1, ?2, NULL, ?3, NULL, ?4, ?4)`,
    runId,
    projectId,
    state,
    at,
  );
}

async function trace(
  w: ReturnType<typeof world>,
  runId: string,
  projectId: string,
  cost: number,
  at: string,
) {
  await w.exec(
    `INSERT INTO generation_run_traces
       (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
        output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at)
     VALUES (?1, ?2, 'applied', 'm', 1, 0, 1, 1000, ?3, 10, ?4)`,
    runId,
    projectId,
    cost,
    at,
  );
}

async function payment(
  w: ReturnType<typeof world>,
  id: string,
  cents: number,
  at: string,
) {
  await w.exec(
    `INSERT INTO billing_payments (stripe_object_id, user_id, amount_usd_cents, cleared_at)
     VALUES (?1, 'user_a', ?2, ?3)`,
    id,
    cents,
    at,
  );
}

async function clawback(
  w: ReturnType<typeof world>,
  id: string,
  cause: 'refund' | 'dispute',
  charge: string,
  reversed: number,
  at: string,
) {
  await w.exec(
    `INSERT INTO billing_clawbacks
       (id, user_id, cause, stripe_charge_id, stripe_object_id, kind,
        charge_usd_cents, reversed_usd_cents, created_at)
     VALUES (?1, 'user_a', ?2, ?3, 'cs_1', 'topup', 2000, ?4, ?5)`,
    id,
    cause,
    charge,
    reversed,
    at,
  );
}

describe('the platform overview (D128)', () => {
  it('reads a window of whole UTC days ending today', () => {
    assert.deepEqual(overviewWindow(NOW, 3), [
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
    assert.equal(overviewDays(null), 30);
    assert.equal(overviewDays('7'), 7);
    assert.equal(overviewDays('0'), 30);
    assert.equal(overviewDays('2.5'), 30);
    assert.equal(overviewDays('1000'), MAX_OVERVIEW_DAYS);
  });

  it('counts each day, and fills the days nothing happened', async () => {
    const w = world();
    await account(w, 'user_a', '2026-09-30T08:00:00.000Z', NOW.toISOString());
    await account(
      w,
      'user_b',
      '2026-09-30T09:00:00.000Z',
      '2026-09-30T09:00:00.000Z',
    );
    // Before the window: not a sign-up in it, but still an account.
    await account(
      w,
      'user_c',
      '2026-08-01T00:00:00.000Z',
      '2026-09-05T00:00:00.000Z',
    );
    await project(w, 'p_a', 'user_a');
    await project(w, 'p_b', 'user_b');
    await stage(w, 'r1', 'p_a', 'accepted', '2026-09-30T10:00:00.000Z');
    // A later stage of the same run is not a second build.
    await stage(w, 'r1:repair', 'p_a', 'failed', '2026-09-30T10:05:00.000Z');
    await stage(w, 'r2', 'p_a', 'failed', '2026-09-30T11:00:00.000Z');
    await stage(w, 'r3', 'p_b', 'cancelled', '2026-09-30T12:00:00.000Z');
    await stage(w, 'r4', 'p_b', 'building', '2026-10-01T11:00:00.000Z');
    await trace(w, 'r1', 'p_a', 120_000, '2026-09-30T10:04:00.000Z');
    await trace(w, 'r2', 'p_a', 30_000, '2026-09-30T11:02:00.000Z');
    await payment(w, 'in_1', 1_200, '2026-09-30T13:00:00.000Z');
    // Recorded, but nothing was taken.
    await payment(w, 'in_2', 0, '2026-09-30T13:00:00.000Z');

    const overview = await readOverview(w.db, NOW, 3, noBalances);
    assert.equal(overview.from, '2026-09-29');
    assert.equal(overview.to, '2026-10-01');
    assert.deepEqual(overview.days[0], {
      day: '2026-09-29',
      signups: 0,
      builders: 0,
      builds: 0,
      accepted: 0,
      failed: 0,
      cancelled: 0,
      spendMicroUsd: 0,
      revenueUsdCents: 0,
      refundedUsdCents: 0,
    });
    assert.deepEqual(overview.days[1], {
      day: '2026-09-30',
      signups: 2,
      builders: 2,
      builds: 3,
      accepted: 1,
      failed: 1,
      cancelled: 1,
      spendMicroUsd: 150_000,
      revenueUsdCents: 1_200,
      refundedUsdCents: 0,
    });
    assert.equal(overview.days[2]!.builds, 1);
    assert.equal(overview.totals.builds, 4);
    // Distinct over the window, not a sum of the days.
    assert.equal(overview.totals.builders, 2);
    assert.equal(overview.totals.failureRate, 0.5);
    assert.deepEqual(overview.accounts, {
      total: 3,
      seen1d: 1,
      seen7d: 2,
      seen30d: 3,
    });
    assert.equal(overview.unendedBuilds, 1);
  });

  it('counts a run as not ended while a later stage of it is still going', async () => {
    const w = world();
    await project(w, 'p_a', 'user_a');
    // Accepted itself, but its verify stage is still building.
    await stage(w, 'r1', 'p_a', 'accepted', '2026-10-01T10:00:00.000Z');
    await stage(w, 'r1:verify', 'p_a', 'building', '2026-10-01T10:01:00.000Z');
    await stage(
      w,
      'r1:repair',
      'p_a',
      'validating',
      '2026-10-01T10:02:00.000Z',
    );
    // Ended through and through.
    await stage(w, 'r2', 'p_a', 'accepted', '2026-10-01T11:00:00.000Z');
    await stage(w, 'r2:verify', 'p_a', 'accepted', '2026-10-01T11:01:00.000Z');
    const overview = await readOverview(w.db, NOW, 1, noBalances);
    assert.equal(overview.unendedBuilds, 1);
  });

  it('counts each refund once, on the day it happened, from cumulative amounts', async () => {
    const w = world();
    // Two partial refunds on one charge: $5, then $8 cumulative ($3 more).
    await clawback(
      w,
      'rf_1',
      'refund',
      'ch_1',
      500,
      '2026-09-25T00:00:00.000Z',
    );
    await clawback(
      w,
      'rf_2',
      'refund',
      'ch_1',
      800,
      '2026-09-30T00:00:00.000Z',
    );
    // A lost dispute is its amount.
    await clawback(
      w,
      'dp_1',
      'dispute',
      'ch_2',
      2_000,
      '2026-10-01T00:00:00.000Z',
    );
    const overview = await readOverview(w.db, NOW, 3, noBalances);
    assert.deepEqual(
      overview.days.map((day) => day.refundedUsdCents),
      [0, 300, 2_000],
    );
    assert.equal(overview.totals.refundedUsdCents, 2_300);
  });

  it('counts nothing for an older refund replayed after a newer one', async () => {
    const w = world();
    // $8 cumulative recorded before the window, then the older $5 event
    // replayed inside it: nothing more went back.
    await clawback(
      w,
      'rf_new',
      'refund',
      'ch_1',
      800,
      '2026-09-20T00:00:00.000Z',
    );
    await clawback(
      w,
      'rf_old',
      'refund',
      'ch_1',
      500,
      '2026-09-30T00:00:00.000Z',
    );
    // And a later, larger one still counts only what it adds.
    await clawback(
      w,
      'rf_more',
      'refund',
      'ch_1',
      1_000,
      '2026-10-01T00:00:00.000Z',
    );
    const overview = await readOverview(w.db, NOW, 3, noBalances);
    assert.deepEqual(
      overview.days.map((day) => day.refundedUsdCents),
      [0, 0, 200],
    );
  });

  it('does not wait on a provider that never answers', async () => {
    const started = Date.now();
    const overview = await readOverview(
      world().db,
      NOW,
      1,
      () => new Promise(() => {}),
      20,
    );
    assert.deepEqual(overview.balances, []);
    assert.ok(Date.now() - started < 2_000);
  });

  it('says a failure rate is unknown when nothing ended', async () => {
    const overview = await readOverview(world().db, NOW, 7, noBalances);
    assert.equal(overview.totals.failureRate, null);
    assert.equal(overview.days.length, 7);
  });

  it('still answers when the balances cannot be read', async () => {
    const overview = await readOverview(world().db, NOW, 1, async () => {
      throw new Error('down');
    });
    assert.deepEqual(overview.balances, []);
  });

  it('reads DeepSeek’s balance, and says why Anthropic’s is not read', async () => {
    const asked: string[] = [];
    const signals: unknown[] = [];
    const balances = await readBalances(
      { DEEPSEEK_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-ant-x' },
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push(String(input));
        signals.push(init?.signal);
        return Response.json({
          balance_infos: [{ currency: 'USD', total_balance: '42.50' }],
        });
      }) as typeof fetch,
    );
    assert.deepEqual(asked, ['https://api.deepseek.com/user/balance']);
    assert.ok(signals[0] instanceof AbortSignal, 'the read is bounded');
    assert.deepEqual(balances[0], {
      provider: 'DeepSeek',
      balance: { amount: 42.5, currency: 'USD' },
      note: null,
    });
    assert.equal(balances[1]!.provider, 'Anthropic');
    assert.equal(balances[1]!.balance, null);
    assert.match(balances[1]!.note!, /Admin API key/);

    const down = await readBalances(
      { DEEPSEEK_API_KEY: 'sk-x' },
      (async () => new Response('no', { status: 500 })) as typeof fetch,
    );
    assert.deepEqual(down, [
      { provider: 'DeepSeek', balance: null, note: 'DeepSeek did not answer.' },
    ]);
    assert.deepEqual(await readBalances({}), []);
  });

  it('answers GET only', async () => {
    const w = world();
    const refused = await handleOverview(
      new Request('https://app.vibld.com/api/admin/overview', {
        method: 'POST',
      }),
      w.db,
      noBalances,
      NOW,
    );
    assert.equal(refused.status, 405);
    const ok = await handleOverview(
      new Request('https://app.vibld.com/api/admin/overview?days=2'),
      w.db,
      noBalances,
      NOW,
    );
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { days: unknown[] }).days.length, 2);
  });

  it('is behind the platform-admin check, like every admin route', async () => {
    const index = await readFile(
      join(import.meta.dirname, '..', 'worker', 'index.ts'),
      'utf8',
    );
    const start = index.indexOf("if (pathname === '/api/admin/overview')");
    assert.ok(start > 0, 'the overview is routed');
    const block = index.slice(start, index.indexOf('\n  }\n', start));
    assert.ok(
      block.indexOf('requireAdmin(request, env)') <
        block.indexOf('handleOverview('),
      'asks who the caller is first',
    );
    assert.equal(
      UNGATED_PATHS['/api/admin/overview'],
      'behind the platform-admin check instead',
    );
  });
});
