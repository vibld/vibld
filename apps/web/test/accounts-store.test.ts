import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AccountsStore,
  MAX_EXPORT_ROWS,
  accountsCsv,
  monthStart,
} from '../worker/accounts-store.ts';
import { AdminStore } from '../worker/admin-store.ts';
import type { AuditEntry } from '../worker/admin-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql, schemaSqlBetween } from './fakes/schema.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function world() {
  const db = new SqliteD1Database(schemaSql());
  const store = new AccountsStore(db);
  const exec = (sql: string, ...values: unknown[]) =>
    db
      .prepare(sql)
      .bind(...values)
      .run();
  return { db, store, exec };
}

async function seed(w: ReturnType<typeof world>) {
  const { store, exec } = w;
  await store.importAccounts([
    {
      userId: 'user_free',
      email: 'Free@Example.com',
      createdAt: '2026-09-01T00:00:00.000Z',
      lastSignInAt: '2026-10-01T00:00:00.000Z',
    },
    {
      userId: 'user_paid',
      email: 'paid@example.com',
      createdAt: '2026-09-10T00:00:00.000Z',
      lastSignInAt: '2026-10-14T00:00:00.000Z',
    },
    {
      userId: 'user_gift',
      email: 'gift@example.com',
      createdAt: '2026-10-05T00:00:00.000Z',
      lastSignInAt: null,
    },
    {
      userId: 'user_banned',
      email: 'banned@example.com',
      createdAt: '2026-09-20T00:00:00.000Z',
      lastSignInAt: '2026-09-21T00:00:00.000Z',
    },
  ]);
  await exec(
    `INSERT INTO billing_subscriptions
       (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
        price_id, current_period_end, cancel_at_period_end, created_at, updated_at)
     VALUES ('sub_1', 'user_paid', 'cus_1', 'build', 'active', 'price_1', NULL, 0,
             '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')`,
  );
  await exec(
    `INSERT INTO plan_gifts (id, user_id, tier, ends_at, granted_by, created_at)
     VALUES ('g1', 'user_gift', 'ship', NULL, 'admin@example.com', '2026-10-05T00:00:00.000Z')`,
  );
  await exec(
    `INSERT INTO user_bans (user_id, banned_at, banned_by, reason)
     VALUES ('user_banned', '2026-09-22T00:00:00.000Z', 'admin@example.com', 'spam')`,
  );
  await exec(
    `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
     VALUES ('p1', 'user_paid', 'Bakery', '2026-09-11T00:00:00.000Z',
             '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')`,
  );
  for (const [run, ended, cost] of [
    ['r1', '2026-09-12T00:00:00.000Z', 400_000],
    ['r2', '2026-10-02T00:00:00.000Z', 250_000],
  ] as const) {
    await exec(
      `INSERT INTO generation_run_traces
         (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
          output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at)
       VALUES (?1, 'p1', 'done', 'gpt-6-luna', 1, 0, 1, 1000, ?3, 1, ?2)`,
      run,
      ended,
      cost,
    );
  }
}

describe('the account list (D128)', () => {
  it("reads each account's plan, status, projects and spend from where they live", async () => {
    const w = world();
    await seed(w);
    const page = await w.store.list({}, NOW);
    assert.equal(page.total, 4);
    const byId = Object.fromEntries(page.accounts.map((a) => [a.userId, a]));
    assert.equal(byId.user_free!.email, 'free@example.com');
    assert.equal(byId.user_free!.plan, 'free');
    assert.equal(byId.user_paid!.plan, 'build');
    assert.equal(byId.user_paid!.gifted, false);
    assert.equal(byId.user_paid!.activeProjects, 1);
    assert.equal(byId.user_paid!.spendMicroUsd, 650_000);
    assert.equal(byId.user_paid!.monthSpendMicroUsd, 250_000);
    assert.equal(byId.user_gift!.plan, 'ship');
    assert.equal(byId.user_gift!.gifted, true);
    assert.equal(byId.user_banned!.banned, true);
    // Most recently active first, by default.
    assert.equal(page.accounts[0]!.userId, 'user_paid');
  });

  it('shows a refunded or disputed subscription as the Free plan it now is', async () => {
    const w = world();
    await seed(w);
    await w.exec(
      `INSERT INTO billing_clawbacks
         (id, user_id, cause, stripe_charge_id, stripe_object_id, kind,
          charge_usd_cents, reversed_usd_cents, stripe_subscription_id, created_at)
       VALUES ('cb1', 'user_paid', 'refund', 'ch_1', 'in_1', 'subscription',
               2000, 2000, 'sub_1', '2026-10-01T00:00:00.000Z')`,
    );
    const page = await w.store.list({ plan: 'build' }, NOW);
    assert.equal(page.total, 0);
    const paid = (await w.store.list({ search: 'user_paid' }, NOW))
      .accounts[0]!;
    assert.equal(paid.plan, 'free');
    // A refund is not a suspension; only a lost dispute is.
    assert.equal(paid.suspended, false);
  });

  it('lists an account under one status only, a ban outranking a suspension', async () => {
    const w = world();
    await seed(w);
    await w.exec(
      `INSERT INTO billing_clawbacks
         (id, user_id, cause, stripe_charge_id, stripe_object_id, kind,
          charge_usd_cents, reversed_usd_cents, suspends, created_at)
       VALUES ('cb2', 'user_banned', 'dispute', 'ch_2', 'cs_2', 'topup',
               500, 500, 1, '2026-10-01T00:00:00.000Z')`,
    );
    const ids = async (status: 'banned' | 'suspended' | 'active') =>
      (await w.store.list({ status }, NOW)).accounts.map((a) => a.userId);
    assert.deepEqual(await ids('banned'), ['user_banned']);
    assert.deepEqual(await ids('suspended'), []);
    assert.equal((await ids('active')).includes('user_banned'), false);
  });

  it('filters, searches, sorts and pages', async () => {
    const w = world();
    await seed(w);
    const ids = async (query: Parameters<AccountsStore['list']>[0]) =>
      (await w.store.list(query, NOW)).accounts.map((a) => a.userId);
    assert.deepEqual(await ids({ plan: 'ship' }), ['user_gift']);
    assert.deepEqual(await ids({ status: 'banned' }), ['user_banned']);
    assert.deepEqual((await ids({ status: 'active' })).length, 3);
    assert.deepEqual(await ids({ search: 'PAID@' }), ['user_paid']);
    assert.deepEqual(await ids({ search: 'user_gift' }), ['user_gift']);
    // LIKE's own wildcards are matched literally.
    assert.deepEqual(await ids({ search: '%' }), []);
    assert.deepEqual(await ids({ since: '2026-10-01' }), ['user_gift']);
    assert.deepEqual(await ids({ sort: 'spend', pageSize: 1 }), ['user_paid']);
    assert.deepEqual(
      await ids({ sort: 'email', direction: 'asc', pageSize: 2, page: 2 }),
      ['user_gift', 'user_paid'],
    );
    const page = await w.store.list({ pageSize: 2, page: 2 }, NOW);
    assert.equal(page.total, 4);
    assert.equal(page.accounts.length, 2);
    // A page past the last match still says how many there are.
    const beyond = await w.store.list({ pageSize: 2, page: 9 }, NOW);
    assert.deepEqual([beyond.accounts.length, beyond.total], [0, 4]);
  });

  it('keeps the address current and writes a visit at most hourly', async () => {
    const w = world();
    await w.store.recordSeen('user_a', 'a@example.com', NOW);
    await w.store.recordSeen(
      'user_a',
      'a@example.com',
      new Date(NOW.getTime() + 10 * 60 * 1000),
    );
    let row = (await w.store.list({}, NOW)).accounts[0]!;
    assert.equal(row.lastSeenAt, NOW.toISOString());
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    await w.store.recordSeen('user_a', 'new@example.com', later);
    row = (await w.store.list({}, NOW)).accounts[0]!;
    assert.equal(row.lastSeenAt, later.toISOString());
    assert.equal(row.email, 'new@example.com');
    assert.equal(row.firstSeenAt, NOW.toISOString());
    assert.equal(await w.store.userIdForEmail('NEW@example.com'), 'user_a');
    assert.equal(await w.store.emailForUserId('user_a'), 'new@example.com');
  });

  it('writes no row for an account whose purge has begun, or for a tombstone', async () => {
    const w = world();
    await w.exec(
      `INSERT INTO account_deletions
         (user_id, tombstone, requested_at, purge_after, purge_step)
       VALUES ('user_purging', 'tomb_1', '2026-09-01T00:00:00.000Z',
               '2026-10-01T00:00:00.000Z', 6),
              ('user_waiting', 'tomb_2', '2026-10-01T00:00:00.000Z',
               '2026-10-31T00:00:00.000Z', 0)`,
    );
    // Clerk still lists someone mid-purge, and they may still sign in.
    await w.store.importAccounts([
      {
        userId: 'user_purging',
        email: 'gone@example.com',
        createdAt: '2026-08-01T00:00:00.000Z',
        lastSignInAt: null,
      },
      {
        userId: 'tomb_1',
        email: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        lastSignInAt: null,
      },
    ]);
    await w.store.recordSeen('user_purging', 'gone@example.com', NOW);
    // A deletion still waiting out its 30 days can be cancelled: that
    // account is still one, and is recorded.
    await w.store.recordSeen('user_waiting', 'waiting@example.com', NOW);
    const ids = (await w.store.list({}, NOW)).accounts.map((a) => a.userId);
    assert.deepEqual(ids, ['user_waiting']);
  });

  it('lists an account an admin acted on, whichever way the audit row is written', async () => {
    const w = world();
    const admin = new AdminStore(w.db);
    await w.store.recordSeen('user_known', 'known@example.com', NOW);
    await w.exec(
      `INSERT INTO account_deletions
         (user_id, tombstone, requested_at, purge_after, purge_step)
       VALUES ('user_purging', 'tomb_9', '2026-09-01T00:00:00.000Z',
               '2026-10-01T00:00:00.000Z', 3)`,
    );
    const at = new Date(NOW.getTime() + 60_000).toISOString();
    const audit = (action: AuditEntry['action'], targetUserId: string) => ({
      at,
      adminEmail: 'admin@example.com',
      action,
      targetUserId,
      target: null,
      reason: null,
      detail: null,
    });
    // In the same batch as the change it records.
    await admin.giveGift(
      {
        id: 'g_new',
        userId: 'user_gifted',
        tier: 'build',
        endsAt: null,
        by: 'admin@example.com',
        reason: null,
        now: at,
      },
      audit('gift', 'user_gifted'),
    );
    await admin.recordBan(
      'user_banned_early',
      'admin@example.com',
      'spam',
      at,
      audit('ban', 'user_banned_early'),
    );
    // On its own.
    await admin.append(audit('topup', 'user_credited'));
    await admin.append(audit('overrides', 'user_known'));
    await admin.append(audit('ban', 'user_purging'));
    await admin.append(audit('delete', 'user_gone'));
    await admin.append(audit('accounts-import', null as unknown as string));

    const byId = Object.fromEntries(
      (await w.store.list({}, NOW)).accounts.map((a) => [a.userId, a]),
    );
    assert.deepEqual(Object.keys(byId).sort(), [
      'user_banned_early',
      'user_credited',
      'user_gifted',
      'user_known',
    ]);
    assert.equal(byId.user_gifted!.firstSeenAt, at);
    assert.equal(byId.user_gifted!.plan, 'build');
    assert.equal(byId.user_banned_early!.banned, true);
    // An account already listed keeps its own dates and address.
    assert.equal(byId.user_known!.lastSeenAt, NOW.toISOString());
    assert.equal(byId.user_known!.email, 'known@example.com');
  });

  it('exports CSV a spreadsheet will not run', () => {
    const csv = accountsCsv([
      {
        userId: 'user_1',
        email: '=HYPERLINK("x"),a@example.com',
        firstSeenAt: '2026-10-01T00:00:00.000Z',
        lastSeenAt: '2026-10-02T00:00:00.000Z',
        plan: 'free',
        gifted: false,
        banned: false,
        suspended: false,
        activeProjects: 2,
        spendMicroUsd: 1_234_567,
        monthSpendMicroUsd: 0,
      },
    ]);
    const [header, line] = csv.trim().split('\r\n');
    assert.match(header!, /^user_id,email,plan/);
    assert.match(
      line!,
      /^user_1,"'=HYPERLINK\(""x""\),a@example.com",free,no,active,2,1\.2346,0\.0000,/,
    );
  });

  it('carries 0040 into accounts, and finds the accounts it already had data for', async () => {
    const db = new SqliteD1Database(schemaSqlBetween('', '0041'));
    // 0040 kept a row per address: sub-x changed address, so it has two.
    await db
      .prepare(
        `INSERT INTO access_accounts (email, user_id, first_seen_at, last_seen_at)
         VALUES ('x@example.com', 'sub-x', '2026-09-30T00:00:00.000Z', '2026-09-30T01:00:00.000Z'),
                ('old-x@example.com', 'sub-x', '2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
         VALUES ('p9', 'user_old', 'Old', '2026-08-01T00:00:00.000Z',
                 '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      )
      .run();
    // An account known only by a gift an admin gave it, and the rows a
    // purge kept for accounting, re-keyed to a tombstone (0031).
    await db
      .prepare(
        `INSERT INTO plan_gifts (id, user_id, tier, ends_at, granted_by, created_at)
         VALUES ('g9', 'user_gifted', 'build', NULL, 'admin@example.com',
                 '2026-07-01T00:00:00.000Z')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO account_deletions
           (user_id, tombstone, requested_at, purge_after, purged_at)
         VALUES ('deleted_tomb', 'deleted_tomb', '2026-06-01T00:00:00.000Z',
                 '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO billing_customers (user_id, stripe_customer_id, created_at, updated_at)
         VALUES ('deleted_tomb', 'cus_gone', '2026-05-01T00:00:00.000Z',
                 '2026-05-01T00:00:00.000Z')`,
      )
      .run();
    // sub-x also made a project before Access first saw it.
    await db
      .prepare(
        `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
         VALUES ('p8', 'sub-x', 'Earlier', '2026-09-10T00:00:00.000Z',
                 '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')`,
      )
      .run();
    // Someone waiting out a deletion they can still cancel, with no other
    // data: they cannot sign in meanwhile, so the backfill is their row.
    await db
      .prepare(
        `INSERT INTO account_deletions
           (user_id, tombstone, requested_at, purge_after, purge_step)
         VALUES ('user_leaving', 'tomb_leaving', '2026-06-15T00:00:00.000Z',
                 '2026-07-15T00:00:00.000Z', 0)`,
      )
      .run();
    db.exec(schemaSqlBetween('0041', '0042'));
    const page = await new AccountsStore(db).list({ sort: 'email' }, NOW);
    assert.deepEqual(
      page.accounts.map((a) => [a.userId, a.email, a.firstSeenAt]),
      [
        ['sub-x', 'x@example.com', '2026-09-10T00:00:00.000Z'],
        ['user_gifted', null, '2026-07-01T00:00:00.000Z'],
        ['user_leaving', null, '2026-06-15T00:00:00.000Z'],
        ['user_old', null, '2026-08-01T00:00:00.000Z'],
      ],
    );
  });

  it('says how many matched when an export is cut at its limit', async () => {
    const w = world();
    await w.store.importAccounts(
      Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, n) => ({
        userId: `user_${n}`,
        email: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        lastSignInAt: null,
      })),
    );
    const { rows, total } = await w.store.exportRows({}, NOW);
    assert.deepEqual(
      [rows.length, total],
      [MAX_EXPORT_ROWS, MAX_EXPORT_ROWS + 1],
    );
  });

  it('backfills in statements D1 accepts', async () => {
    // D1 refuses a compound SELECT of many terms ("too many terms in
    // compound SELECT"), which a UNION of every source table was. Applying
    // the migrations to a local D1 is what found it; this keeps it out.
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      new URL('../migrations/0041_accounts.sql', import.meta.url),
      'utf8',
    ).replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\bUNION\b/i);
  });

  it('dates a month from its first instant, UTC', () => {
    assert.equal(monthStart(NOW), '2026-10-01T00:00:00.000Z');
  });
});
