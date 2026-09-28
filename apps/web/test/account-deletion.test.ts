import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONFIRMATION_PHRASE,
  DELETIONS_PER_NIGHT,
  MIN_DELETION_SHARE,
  PURGE_STEPS,
  QUERIES_PER_RETRY,
  QUERIES_TO_FIND_DELETIONS,
  deleteClerkUser,
  findDeletionWork,
  purgeAccount,
  purgeQueriesLeft,
  QueryAllowance,
  requestAccountDeletion,
  runDeletionNight,
  runImmediateSteps,
} from '../worker/account-deletion.ts';
import type {
  DeletionDeps,
  StripeSubscriptions,
} from '../worker/account-deletion.ts';
import {
  AccountDeletionStore,
  BACKOFF_AFTER_ATTEMPTS,
  KEPT_BILLING_TABLES,
} from '../worker/account-deletion-store.ts';
import {
  handleAccountDelete,
  handleAccountDeleteCancel,
  handleAdminDeletions,
} from '../worker/account-deletion-handlers.ts';
import type { ResolveCaller } from '../worker/account-deletion-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import { CONFIRMATION_PHRASE as BROWSER_PHRASE } from '../src/account/deletion-client.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Self-serve account deletion (docs/decisions.md L32), against the real
 * schema over SQLite.
 *
 * What is promised to somebody who presses the button, in the order they
 * would notice it broken: the request lands even when Stripe does not;
 * every step that failed is finished by asking again or by the nightly
 * pass, and a step that happened is not done twice; nothing is purged a
 * minute before the 30 days are up; and after the purge, nothing in the
 * database still says who they were, while the accounting rows are all
 * still there.
 */

const SCHEMA = schemaSql();

const USER = 'user_leaver000000000000000001';
const OTHER = 'user_stays00000000000000000002';
const FRIEND = 'user_friend0000000000000000003';
const EMAIL = 'leaver@example.com';

const REQUESTED = '2026-09-01T00:00:00.000Z';
const PURGE_AT = '2026-10-01T00:00:00.000Z';

/** A D1 over SQLite that counts statements, because the allowance does. */
function countingDb(): { db: D1Database; statements: () => number } {
  const inner = new SqliteD1Database(SCHEMA);
  let statements = 0;
  const counted = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (key === 'bind') {
          return (...values: unknown[]) => counted(target.bind(...values));
        }
        if (key === 'run' || key === 'first' || key === 'all') {
          return (...args: unknown[]) => {
            statements += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
  const db = {
    prepare: (query: string) => counted(inner.prepare(query)),
  } as unknown as D1Database;
  return { db, statements: () => statements };
}

async function exec(db: D1Database, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

interface FakeStripe extends StripeSubscriptions {
  cancelled: { id: string; params: unknown }[];
  down: boolean;
  statuses: Map<string, string>;
}

function fakeStripe(): FakeStripe {
  const stripe: FakeStripe = {
    cancelled: [],
    down: false,
    statuses: new Map([['sub_live', 'active']]),
    subscriptions: {
      async list() {
        if (stripe.down) throw new Error('Stripe is unreachable');
        return {
          data: [...stripe.statuses].map(([id, status]) => ({ id, status })),
        };
      },
      async cancel(id, params) {
        if (stripe.down) throw new Error('Stripe is unreachable');
        stripe.cancelled.push({ id, params });
        stripe.statuses.set(id, 'canceled');
        return {};
      },
    },
  };
  return stripe;
}

interface World {
  db: D1Database;
  statements: () => number;
  deps: DeletionDeps;
  stripe: FakeStripe;
  bucket: InMemoryR2Bucket;
  store: AccountDeletionStore;
  clock: { now: Date };
  preview: { down: boolean; stopped: string[] };
  clerk: { deleted: string[]; down: boolean };
  ledger: string[];
}

function world(): World {
  const { db, statements } = countingDb();
  const stripe = fakeStripe();
  const bucket = new InMemoryR2Bucket();
  const store = new AccountDeletionStore(db);
  const clock = { now: new Date(REQUESTED) };
  const preview = { down: false, stopped: [] as string[] };
  const clerk = { deleted: [] as string[], down: false };
  const ledger: string[] = [];
  const deps: DeletionDeps = {
    store,
    billing: new BillingStore(db),
    github: new GitHubStore(db),
    stripe,
    stopPreview: async (userId) => {
      if (preview.down) return { ok: false, error: 'preview service down' };
      preview.stopped.push(userId);
      return { ok: true };
    },
    bucket,
    ledger: (name) => ({
      forget: async () => {
        ledger.push(name);
      },
    }),
    deleteClerkUser: async (userId) => {
      if (clerk.down) return { ok: false, error: 'Clerk is unreachable' };
      clerk.deleted.push(userId);
      return { ok: true };
    },
    now: () => clock.now,
  };
  return {
    db,
    statements,
    deps,
    stripe,
    bucket,
    store,
    clock,
    preview,
    clerk,
    ledger,
  };
}

/**
 * Everything an account can leave behind, for `USER`, and a little of the
 * same for `OTHER`, who is not leaving and must not notice.
 */
async function seed(w: World, { siteLive = false } = {}) {
  const { db, bucket } = w;
  const at = '2026-08-01T00:00:00.000Z';
  for (const [user, customer] of [
    [USER, 'cus_leaver'],
    [OTHER, 'cus_stays'],
  ] as const) {
    await exec(
      db,
      `INSERT INTO billing_customers VALUES (?1, ?2, ?3, ?3)`,
      user,
      customer,
      at,
    );
    await exec(
      db,
      `INSERT INTO billing_subscriptions
         (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
          price_id, current_period_end, cancel_at_period_end, created_at,
          updated_at)
       VALUES (?1, ?2, ?3, 'build', 'active', 'price_build', NULL, 0, ?4, ?4)`,
      `sub_${customer}`,
      user,
      customer,
      at,
    );
    await exec(
      db,
      `INSERT INTO billing_topups VALUES (?1, ?2, ?3, 800, ?4)`,
      `cs_${customer}`,
      user,
      customer,
      at,
    );
    await exec(
      db,
      `INSERT INTO billing_payments (stripe_object_id, user_id, amount_usd_cents, cleared_at)
       VALUES (?1, ?2, 2900, ?3)`,
      `in_${customer}`,
      user,
      at,
    );
    await exec(
      db,
      `INSERT INTO generation_projects VALUES (?1, 'r1', ?2, ?2)`,
      user,
      at,
    );
    await exec(
      db,
      `INSERT INTO generation_stages VALUES (?1, ?2, NULL, 'accepted', 'r1', ?3, ?3)`,
      `run_${customer}`,
      user,
      at,
    );
    await exec(
      db,
      `INSERT INTO generation_run_traces VALUES (?1, ?2, 'accepted', 'm', 1, 0, 1, 100, 5, 10, ?3)`,
      `run_${customer}`,
      user,
      at,
    );
    await exec(
      db,
      `INSERT INTO project_media
         (id, user_id, path, kind, content_type, bytes, sha256, git_sha, created_at)
       VALUES (?1, ?2, 'media/hero.png', 'image', 'image/png', 3, 'x', 'y', ?3)`,
      `m_${customer}`,
      user,
      at,
    );
    await bucket.put(`projects/${user}/snapshots/r1.json`, '{}');
    await bucket.put(`media/${user}/m_${customer}`, 'png');

    // The project the migration made of that one (0033's backfill), and a
    // second one made since, with its own id, code, conversation and runs:
    // what an account looks like now that it can have several.
    await exec(
      db,
      `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
       VALUES (?1, ?1, 'Untitled project', ?2, ?2, ?2)`,
      user,
      at,
    );
    const second = `proj_${customer}`;
    await exec(
      db,
      `INSERT INTO projects
         (id, user_id, name, created_at, updated_at, last_opened_at,
          transcript_key, transcript_turns)
       VALUES (?1, ?2, 'Second', ?3, ?3, ?3, ?4, 1)`,
      second,
      user,
      at,
      `projects/${second}/transcript.json`,
    );
    await exec(
      db,
      `INSERT INTO generation_projects VALUES (?1, 'r2', ?2, ?2)`,
      second,
      at,
    );
    await exec(
      db,
      `INSERT INTO generation_stages VALUES (?1, ?2, NULL, 'accepted', 'r2', ?3, ?3)`,
      `run2_${customer}`,
      second,
      at,
    );
    await exec(
      db,
      `INSERT INTO generation_run_traces VALUES (?1, ?2, 'accepted', 'm', 1, 0, 1, 100, 5, 10, ?3)`,
      `run2_${customer}`,
      second,
      at,
    );
    await bucket.put(`projects/${second}/snapshots/r2.json`, '{}');
    await bucket.put(`projects/${second}/transcript.json`, '[]');
  }

  await exec(
    db,
    `INSERT INTO billing_scheduled_cancellations VALUES (?1, ?2, ?3, NULL)`,
    'sub_cus_leaver',
    USER,
    at,
  );
  await exec(
    db,
    `INSERT INTO billing_signup_offers VALUES (?1, 100, ?2)`,
    USER,
    at,
  );
  await exec(
    db,
    `INSERT INTO billing_signup_cards VALUES ('seti_1', ?1, 'fp_1', 'granted', ?2)`,
    USER,
    at,
  );
  await exec(
    db,
    `INSERT INTO billing_purchase_starts VALUES (?1, ?2)`,
    USER,
    at,
  );
  // A lost dispute on the top-up: the credit it removed and the suspension
  // it left are money records too, and one of them is keyed by the account.
  await exec(
    db,
    `INSERT INTO billing_clawbacks
       (id, user_id, cause, stripe_event_id, stripe_charge_id,
        stripe_object_id, kind, charge_usd_cents, reversed_usd_cents,
        credit_removed_usd_cents, credit_shortfall_usd_cents,
        credit_granted_at, stripe_subscription_id, suspends, created_at)
     VALUES ('dispute:dp_leaver', ?1, 'dispute', 'evt_dp', 'ch_leaver',
             'cs_cus_leaver', 'topup', 2000, 2000, 800, 0, ?2, NULL, 1, ?2)`,
    USER,
    at,
  );
  // USER was referred by OTHER and it paid out: both grants are ledger.
  await exec(
    db,
    `INSERT INTO referral_attributions
       (referred_user_id, referrer_user_id, code, created_at, claimed_at, paid_at)
     VALUES (?1, ?2, 'OTHERCODE', ?3, ?3, ?3)`,
    USER,
    OTHER,
    at,
  );
  await exec(
    db,
    `INSERT INTO billing_admin_credits VALUES (?1, ?2, 500, 'referral', 'Referral', ?3)`,
    `referral:referrer:${USER}`,
    OTHER,
    at,
  );
  await exec(
    db,
    `INSERT INTO billing_admin_credits VALUES (?1, ?2, 500, 'referral', 'Referral', ?3)`,
    `referral:referred:${USER}`,
    USER,
    at,
  );
  // USER referred FRIEND, who has paid and not yet been paid out.
  await exec(
    db,
    `INSERT INTO referral_attributions
       (referred_user_id, referrer_user_id, code, created_at)
     VALUES (?1, ?2, 'LEAVERCODE', ?3)`,
    FRIEND,
    USER,
    at,
  );
  await exec(
    db,
    `INSERT INTO referral_codes VALUES (?1, 'LEAVERCODE', ?2)`,
    USER,
    at,
  );
  await exec(
    db,
    `INSERT INTO github_bindings VALUES (?1, 7, 'leaver', 'site', 'main', ?2, ?3, '2027-01-01T00:00:00.000Z', NULL)`,
    USER,
    at,
    EMAIL,
  );
  await exec(
    db,
    `INSERT INTO github_pushes (user_id, owner, repo, revision, base_sha, branch, started_at)
     VALUES (?1, 'leaver', 'site', 'r1', 'base', 'vibld/r1', ?2)`,
    USER,
    at,
  );
  await exec(
    db,
    `INSERT INTO access_invites VALUES (?1, 'admin@vibld.com', ?2, ?3, ?2, NULL)`,
    EMAIL,
    at,
    USER,
  );
  await exec(
    db,
    `INSERT INTO published_projects
       (slug, project_id, user_id, created_at, updated_at, generation, unpublished_at)
     VALUES ('leaver-site', ?1, ?1, ?2, ?2, ?3, ?4)`,
    USER,
    at,
    siteLive ? 'g1' : null,
    siteLive ? null : at,
  );
  await exec(
    db,
    `INSERT INTO published_generations (slug, generation, created_at) VALUES ('leaver-site', 'g0', ?1)`,
    at,
  );
  // A Stripe event nobody could attribute when it arrived, carrying what
  // Stripe puts in a Checkout Session.
  await exec(
    db,
    `INSERT INTO billing_unattributed_events VALUES ('evt_1', 'checkout.session.completed', 1, ?1, ?2, ?2, 0)`,
    JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_parked',
          customer: 'cus_leaver',
          customer_email: EMAIL,
          customer_details: { email: EMAIL, name: 'Lee Leaver' },
          metadata: { vibld_user_id: USER },
        },
      },
    }),
    at,
  );
}

/** Every text value in every table that contains `needle`, as `table.column`. */
async function whereIs(db: D1Database, needle: string): Promise<string[]> {
  const tables =
    (
      await db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all<{ name: string }>()
    ).results ?? [];
  const found: string[] = [];
  for (const { name } of tables) {
    const columns =
      (await db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>())
        .results ?? [];
    for (const column of columns) {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${name} WHERE instr(CAST(${column.name} AS TEXT), ?1) > 0`,
        )
        .bind(needle)
        .first<{ n: number }>();
      if ((row?.n ?? 0) > 0) found.push(`${name}.${column.name}`);
    }
  }
  return found;
}

async function count(db: D1Database, sql: string, ...values: unknown[]) {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('the confirmation phrase', () => {
  it('is the same string in the page and in the Worker', () => {
    // The Worker checks it too, so a page that asked for a different one
    // would ask for a phrase the server then refused.
    assert.equal(BROWSER_PHRASE, CONFIRMATION_PHRASE);
  });
});

describe('asking to be deleted', () => {
  it('records the request with a date 30 days out, and asking again does not move it', async () => {
    const w = world();
    await seed(w);
    const first = await requestAccountDeletion(w.deps, USER);
    assert.equal(first.record.requestedAt, REQUESTED);
    assert.equal(first.record.purgeAfter, PURGE_AT);

    w.clock.now = new Date('2026-09-10T00:00:00.000Z');
    const again = await requestAccountDeletion(w.deps, USER);
    assert.equal(again.record.purgeAfter, PURGE_AT, 'the date moved');
    assert.equal(again.record.tombstone, first.record.tombstone);
  });

  it('is what refuses the account from then on, until it is taken back', async () => {
    const w = world();
    assert.equal(await w.store.pending(USER), null);
    await requestAccountDeletion(w.deps, USER);
    assert.deepEqual(await w.store.pending(USER), {
      requestedAt: REQUESTED,
      purgeAfter: PURGE_AT,
    });

    assert.equal(await w.store.cancel(USER, REQUESTED), true);
    assert.equal(await w.store.pending(USER), null);

    // Asking after keeping it is a new decision, with a new date.
    w.clock.now = new Date('2026-09-05T00:00:00.000Z');
    const renewed = await requestAccountDeletion(w.deps, USER);
    assert.equal(renewed.record.purgeAfter, '2026-10-05T00:00:00.000Z');
    assert.notEqual(await w.store.pending(USER), null);
  });

  it('cannot be taken back once the purge has started', async () => {
    const w = world();
    await requestAccountDeletion(w.deps, USER);
    await w.store.advancePurge(USER, 1);
    assert.equal(await w.store.cancel(USER, REQUESTED), false);
    assert.notEqual(await w.store.pending(USER), null);
  });

  it('is recorded even when every step after it fails', async () => {
    const w = world();
    await seed(w, { siteLive: true });
    w.stripe.down = true;
    w.preview.down = true;
    const { record, result } = await requestAccountDeletion(w.deps, USER, {
      takeDown: async () => {
        throw new Error('the publish service is down');
      },
    });
    assert.equal(record.userId, USER);
    assert.notEqual(await w.store.pending(USER), null);
    assert.deepEqual(result.done.sort(), ['github', 'referrals']);
    assert.equal(result.errors.length, 3);
    const stored = await w.store.find(USER);
    assert.match(
      stored!.lastError ?? '',
      /subscription could not be cancelled/,
    );
  });
});

describe('the immediate steps', () => {
  it('cancels the subscription now, without proration, once', async () => {
    const w = world();
    await seed(w);
    w.stripe.statuses.set('sub_old', 'canceled');
    const { result } = await requestAccountDeletion(w.deps, USER);
    assert.ok(result.done.includes('subscription'));
    assert.deepEqual(w.stripe.cancelled, [
      { id: 'sub_live', params: { invoice_now: false, prorate: false } },
    ]);

    // Asking again finds the step done and does not ask Stripe at all.
    const record = await w.store.find(USER);
    await runImmediateSteps(w.deps, record!);
    assert.equal(w.stripe.cancelled.length, 1);
  });

  it('asks Stripe for nothing when the account never reached Checkout', async () => {
    const w = world();
    let asked = 0;
    w.deps.stripe = {
      subscriptions: {
        async list() {
          asked += 1;
          return { data: [] };
        },
        async cancel() {
          asked += 1;
          return {};
        },
      },
    };
    const { result } = await requestAccountDeletion(w.deps, USER);
    assert.ok(result.done.includes('subscription'));
    assert.equal(asked, 0);
  });

  it('finishes a cancellation Stripe refused, on the retry', async () => {
    const w = world();
    await seed(w);
    w.stripe.down = true;
    const { result } = await requestAccountDeletion(w.deps, USER);
    assert.ok(!result.done.includes('subscription'));
    assert.equal(w.stripe.cancelled.length, 0);

    w.stripe.down = false;
    const retried = await runImmediateSteps(
      w.deps,
      (await w.store.find(USER))!,
    );
    assert.ok(retried.done.includes('subscription'));
    assert.equal(w.stripe.cancelled.length, 1);
    const stored = await w.store.find(USER);
    assert.notEqual(stored!.done.subscription, null);
    assert.equal(stored!.lastError, null);
  });

  it('stops the preview through the service, and retries it when the service fails', async () => {
    const w = world();
    w.preview.down = true;
    const { result } = await requestAccountDeletion(w.deps, USER);
    assert.ok(!result.done.includes('preview'));

    w.preview.down = false;
    await runImmediateSteps(w.deps, (await w.store.find(USER))!);
    assert.deepEqual(w.preview.stopped, [USER]);
    await runImmediateSteps(w.deps, (await w.store.find(USER))!);
    assert.deepEqual(w.preview.stopped, [USER], 'stopped twice');
  });

  it('takes the site down as its owner while they ask, and is done only once it is down', async () => {
    const w = world();
    await seed(w, { siteLive: true });
    let takedowns = 0;
    const takeDown = async () => {
      takedowns += 1;
      await exec(
        w.db,
        `UPDATE published_projects SET unpublished_at = ?1, generation = NULL WHERE slug = 'leaver-site'`,
        REQUESTED,
      );
    };
    const { result } = await requestAccountDeletion(w.deps, USER, {
      takeDown,
    });
    assert.equal(takedowns, 1);
    assert.ok(result.done.includes('sites'));
    await runImmediateSteps(w.deps, (await w.store.find(USER))!, { takeDown });
    assert.equal(takedowns, 1, 'taken down again');
  });

  it('never takes a site down from the nightly pass, and counts one taken down since', async () => {
    // ADR-0013: nothing automated reaches the takedown. A retry without the
    // person present only checks whether the site is still serving.
    const w = world();
    await seed(w, { siteLive: true });
    await requestAccountDeletion(w.deps, USER);
    assert.equal((await w.store.find(USER))!.done.sites, null);

    const night = await findDeletionWork(w.deps);
    await runDeletionNight(w.deps, night, 500);
    assert.equal((await w.store.find(USER))!.done.sites, null);
    assert.equal(await w.store.liveSite(USER), 'leaver-site');

    // An operator's hold is also "not serving".
    await exec(
      w.db,
      `UPDATE published_projects SET held_at = ?1 WHERE slug = 'leaver-site'`,
      REQUESTED,
    );
    w.clock.now = new Date('2026-09-02T00:00:00.000Z');
    await runDeletionNight(w.deps, await findDeletionWork(w.deps), 500);
    assert.notEqual((await w.store.find(USER))!.done.sites, null);
  });

  it('revokes the GitHub grant, and doing it twice changes nothing', async () => {
    const w = world();
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    const first = await w.db
      .prepare(`SELECT revoked_at FROM github_bindings WHERE user_id = ?1`)
      .bind(USER)
      .first<{ revoked_at: string }>();
    assert.equal(first?.revoked_at, REQUESTED);

    w.clock.now = new Date('2026-09-03T00:00:00.000Z');
    await w.deps.github.revoke(USER, w.clock.now);
    const second = await w.db
      .prepare(`SELECT revoked_at FROM github_bindings WHERE user_id = ?1`)
      .bind(USER)
      .first<{ revoked_at: string }>();
    assert.equal(second?.revoked_at, REQUESTED);
  });

  it('cancels unpaid referral rewards, leaves paid ones, and retires the code', async () => {
    const w = world();
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    const referrals = new ReferralStore(w.db);
    // FRIEND's reward from USER's code was never paid: cancelled.
    assert.equal(
      (await referrals.attributionFor(FRIEND))?.reversedAt,
      REQUESTED,
    );
    // USER's own referral was paid out: that is ledger, and untouched.
    assert.equal((await referrals.attributionFor(USER))?.reversedAt, null);
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM referral_codes WHERE user_id = ?1`,
        USER,
      ),
      0,
    );

    // Again, later: the first reversal's time stands.
    w.clock.now = new Date('2026-09-04T00:00:00.000Z');
    await w.store.cancelReferralPayouts(USER, w.clock.now.toISOString());
    assert.equal(
      (await referrals.attributionFor(FRIEND))?.reversedAt,
      REQUESTED,
    );
  });

  it('costs the nightly pass no more queries than it declares', async () => {
    // The worst case: nothing done yet, and no customer mapping, so the
    // mirror is read as well.
    const w = world();
    await exec(
      w.db,
      `INSERT INTO account_deletions (user_id, tombstone, requested_at, purge_after)
       VALUES (?1, 'deleted-x', ?2, ?3)`,
      USER,
      REQUESTED,
      PURGE_AT,
    );
    const record = (await w.store.find(USER))!;
    const before = w.statements();
    await runImmediateSteps(w.deps, record);
    assert.ok(
      w.statements() - before <= QUERIES_PER_RETRY,
      `${w.statements() - before} > ${QUERIES_PER_RETRY}`,
    );
  });
});

describe('the nightly selection', () => {
  it('does nothing for a finished request until the 30 days are up, and purges it then', async () => {
    const w = world();
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    assert.deepEqual(w.clerk.deleted, []);

    // A minute before: nothing is waiting, so nothing is found.
    w.clock.now = new Date('2026-09-30T23:59:00.000Z');
    const early = await findDeletionWork(w.deps);
    assert.equal(early.records.length, 0);
    assert.equal(early.need, 0);
    await runDeletionNight(w.deps, early, 500);
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM generation_projects WHERE id = ?1`,
        USER,
      ),
      1,
    );

    w.clock.now = new Date(PURGE_AT);
    const due = await findDeletionWork(w.deps);
    assert.equal(due.records.length, 1);
    const result = await runDeletionNight(w.deps, due, 500);
    assert.equal(result.purged, 1);
    assert.deepEqual(w.clerk.deleted, [USER]);
  });

  it('never purges before the date, even when handed a record directly', async () => {
    const w = world();
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date('2026-09-30T23:59:59.000Z');
    const result = await purgeAccount(
      w.deps,
      (await w.store.find(USER))!,
      new QueryAllowance(500),
    );
    assert.deepEqual(result, { state: 'blocked', reason: 'not due' });
    assert.equal((await w.store.find(USER))!.purgeStep, 0);
  });

  it('does not purge while an immediate step is undone', async () => {
    // A purge that tombstoned the billing rows while a subscription was
    // still live would leave Stripe charging an account nobody can find.
    const w = world();
    await seed(w);
    w.stripe.down = true;
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date(PURGE_AT);
    const result = await runDeletionNight(
      w.deps,
      await findDeletionWork(w.deps),
      500,
    );
    assert.equal(result.purged, 0);
    assert.equal(result.blocked, 1);
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM generation_projects WHERE id = ?1`,
        USER,
      ),
      1,
    );
  });

  it('tries a request that keeps failing once a week rather than every night', async () => {
    const w = world();
    await seed(w);
    w.stripe.down = true;
    await requestAccountDeletion(w.deps, USER);
    for (let night = 1; night < BACKOFF_AFTER_ATTEMPTS; night += 1) {
      w.clock.now = new Date(Date.parse(REQUESTED) + night * 86_400_000);
      await runDeletionNight(w.deps, await findDeletionWork(w.deps), 500);
    }
    assert.equal((await w.store.find(USER))!.attempts, BACKOFF_AFTER_ATTEMPTS);

    w.clock.now = new Date(
      Date.parse(REQUESTED) + BACKOFF_AFTER_ATTEMPTS * 86_400_000,
    );
    assert.equal((await findDeletionWork(w.deps)).records.length, 0);
    w.clock.now = new Date(
      Date.parse(REQUESTED) + (BACKOFF_AFTER_ATTEMPTS + 6) * 86_400_000,
    );
    assert.equal((await findDeletionWork(w.deps)).records.length, 1);
  });

  it('looks at no more than a bounded number of requests a night', async () => {
    const w = world();
    for (let n = 0; n < DELETIONS_PER_NIGHT + 3; n += 1) {
      await exec(
        w.db,
        `INSERT INTO account_deletions (user_id, tombstone, requested_at, purge_after)
         VALUES (?1, ?2, ?3, ?4)`,
        `user_${n}`,
        `deleted-${n}`,
        REQUESTED,
        PURGE_AT,
      );
    }
    assert.equal(
      (await findDeletionWork(w.deps)).records.length,
      DELETIONS_PER_NIGHT,
    );
  });
});

describe('the purge', () => {
  async function purged(w: World) {
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date(PURGE_AT);
    const result = await runDeletionNight(
      w.deps,
      await findDeletionWork(w.deps),
      500,
    );
    assert.equal(result.purged, 1);
    const audit = await w.db
      .prepare(`SELECT * FROM account_deletions`)
      .first<{ user_id: string; purged_at: string; forget_after: string }>();
    return audit!;
  }

  it('leaves nothing anywhere in the database that names the account or its email', async () => {
    const w = world();
    await purged(w);
    assert.deepEqual(await whereIs(w.db, USER), []);
    assert.deepEqual(await whereIs(w.db, EMAIL), []);
  });

  it('deletes the project content and the account rows', async () => {
    const w = world();
    await purged(w);
    for (const [table, column] of [
      ['generation_projects', 'id'],
      ['generation_stages', 'project_id'],
      ['generation_run_traces', 'project_id'],
      ['projects', 'user_id'],
      ['project_media', 'user_id'],
      ['github_bindings', 'user_id'],
      ['github_pushes', 'user_id'],
      ['referral_codes', 'user_id'],
    ] as const) {
      assert.equal(
        await count(
          w.db,
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?1`,
          USER,
        ),
        0,
        table,
      );
    }
    // The second project, which is keyed by its own id and names its owner
    // only in `projects`: its rows go with it.
    for (const [table, column] of [
      ['projects', 'id'],
      ['generation_projects', 'id'],
      ['generation_stages', 'project_id'],
      ['generation_run_traces', 'project_id'],
    ] as const) {
      assert.equal(
        await count(
          w.db,
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?1`,
          'proj_cus_leaver',
        ),
        0,
        `${table} of the second project`,
      );
    }
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM access_invites WHERE email = ?1`,
        EMAIL,
      ),
      0,
    );
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM published_generations WHERE slug = 'leaver-site'`,
      ),
      0,
    );
  });

  it("deletes the stored bytes, and only this account's", async () => {
    const w = world();
    await purged(w);
    assert.deepEqual(w.bucket.keys().sort(), [
      `media/${OTHER}/m_cus_stays`,
      'projects/proj_cus_stays/snapshots/r2.json',
      'projects/proj_cus_stays/transcript.json',
      `projects/${OTHER}/snapshots/r1.json`,
    ]);
  });

  it('forgets both spend ledgers and deletes the Clerk user, last', async () => {
    const w = world();
    await purged(w);
    assert.deepEqual(w.ledger, [USER, `${USER}:topup`]);
    assert.deepEqual(w.clerk.deleted, [USER]);
    assert.equal(PURGE_STEPS.at(-1)?.name, 'sign-in account');
  });

  it('keeps every billing, payment and referral row, under the tombstone', async () => {
    const w = world();
    const audit = await purged(w);
    const tombstone = audit.user_id;
    assert.match(tombstone, /^deleted-/);
    for (const table of KEPT_BILLING_TABLES) {
      assert.equal(
        await count(
          w.db,
          `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`,
          tombstone,
        ),
        1,
        table,
      );
    }
    // Both grants of the paid referral, one of them OTHER's.
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM billing_admin_credits WHERE id IN (?1, ?2)`,
        `referral:referrer:${tombstone}`,
        `referral:referred:${tombstone}`,
      ),
      2,
    );
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM billing_admin_credits WHERE user_id = ?1`,
        OTHER,
      ),
      1,
    );
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM referral_attributions WHERE referred_user_id = ?1 AND referrer_user_id = ?2 AND paid_at IS NOT NULL`,
        tombstone,
        OTHER,
      ),
      1,
    );
    // The parked event is still there to be applied, without the email.
    const parked = await w.db
      .prepare(`SELECT payload FROM billing_unattributed_events`)
      .first<{ payload: string }>();
    const event = JSON.parse(parked!.payload) as {
      data: { object: Record<string, unknown> };
    };
    assert.equal(event.data.object.customer, 'cus_leaver');
    assert.equal(event.data.object.customer_email, undefined);
    assert.equal(event.data.object.customer_details, undefined);
    assert.deepEqual(event.data.object.metadata, { vibld_user_id: tombstone });
    // The published name is never released (ADR-0010).
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM published_projects WHERE slug = 'leaver-site' AND user_id = ?1`,
        tombstone,
      ),
      1,
    );
  });

  it('leaves the other account exactly as it was', async () => {
    const w = world();
    await purged(w);
    for (const table of [
      'billing_customers',
      'billing_subscriptions',
      'billing_payments',
      'project_media',
    ]) {
      assert.equal(
        await count(
          w.db,
          `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`,
          OTHER,
        ),
        1,
        table,
      );
    }
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM generation_projects WHERE id = ?1`,
        OTHER,
      ),
      1,
    );
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM projects WHERE user_id = ?1`,
        OTHER,
      ),
      2,
    );
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM generation_projects WHERE id = ?1`,
        'proj_cus_stays',
      ),
      1,
    );
  });

  it('keeps the audit record for 12 months under the tombstone, then forgets it', async () => {
    const w = world();
    const audit = await purged(w);
    assert.equal(audit.purged_at, PURGE_AT);
    assert.equal(audit.forget_after, '2027-10-01T00:00:00.000Z');

    w.clock.now = new Date('2027-09-30T23:59:00.000Z');
    await runDeletionNight(w.deps, await findDeletionWork(w.deps), 500);
    assert.equal(
      await count(w.db, `SELECT COUNT(*) AS n FROM account_deletions`),
      1,
    );

    w.clock.now = new Date('2027-10-01T00:00:00.000Z');
    const lookup = await findDeletionWork(w.deps);
    assert.deepEqual(lookup.expired, [audit.user_id]);
    const result = await runDeletionNight(w.deps, lookup, 500);
    assert.equal(result.forgotten, 1);
    assert.equal(
      await count(w.db, `SELECT COUNT(*) AS n FROM account_deletions`),
      0,
    );
  });

  it('waits for a site still serving rather than taking it down', async () => {
    const w = world();
    await seed(w, { siteLive: true });
    await requestAccountDeletion(w.deps, USER);
    // Every step marked done, as if the site had gone down and come back
    // between the request and tonight: the purge reads D1 again rather
    // than trusting the mark.
    await w.store.recordAttempt(
      USER,
      ['subscription', 'preview', 'sites', 'github', 'referrals'],
      null,
      REQUESTED,
    );
    w.clock.now = new Date(PURGE_AT);
    const result = await runDeletionNight(
      w.deps,
      await findDeletionWork(w.deps),
      500,
    );
    assert.equal(result.purged, 0);
    assert.equal(result.blocked, 1);
    assert.equal(await w.store.liveSite(USER), 'leaver-site');
    assert.match(
      (await w.store.find(USER))!.lastError ?? '',
      /published site is still online/,
    );
    assert.deepEqual(w.clerk.deleted, []);
  });

  it('marks a held site unpublished, so lifting the hold cannot put it back', async () => {
    const w = world();
    await seed(w, { siteLive: true });
    await exec(
      w.db,
      `UPDATE published_projects SET held_at = ?1 WHERE slug = 'leaver-site'`,
      REQUESTED,
    );
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date(PURGE_AT);
    await runDeletionNight(w.deps, await findDeletionWork(w.deps), 500);
    const row = await w.db
      .prepare(
        `SELECT unpublished_at, held_at, generation FROM published_projects WHERE slug = 'leaver-site'`,
      )
      .first<{ unpublished_at: string; held_at: string; generation: string }>();
    assert.equal(row?.unpublished_at, PURGE_AT);
    // The hold and its bytes are the operator's to decide on.
    assert.equal(row?.held_at, REQUESTED);
    assert.equal(row?.generation, 'g1');
  });

  it('resumes where it stopped when Clerk fails, and deletes nothing twice', async () => {
    const w = world();
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date(PURGE_AT);
    w.clerk.down = true;
    const first = await runDeletionNight(
      w.deps,
      await findDeletionWork(w.deps),
      500,
    );
    assert.equal(first.purged, 0);
    const stuck = (await w.store.find(USER))!;
    assert.equal(stuck.purgeStep, PURGE_STEPS.length - 1);
    assert.match(stuck.lastError ?? '', /Clerk/);
    assert.equal(w.ledger.length, 2);

    w.clerk.down = false;
    w.clock.now = new Date('2026-10-02T00:00:00.000Z');
    const second = await runDeletionNight(
      w.deps,
      await findDeletionWork(w.deps),
      500,
    );
    assert.equal(second.purged, 1);
    assert.equal(w.ledger.length, 2, 'a finished step ran again');
  });

  it('stays inside a small share every night, and finishes over several', async () => {
    const w = world();
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date(PURGE_AT);
    let nights = 0;
    while (w.clerk.deleted.length === 0) {
      nights += 1;
      assert.ok(nights < 20, 'the purge never finished');
      const before = w.statements();
      const lookup = await findDeletionWork(w.deps);
      const result = await runDeletionNight(w.deps, lookup, MIN_DELETION_SHARE);
      const spent = w.statements() - before - QUERIES_TO_FIND_DELETIONS;
      assert.ok(spent <= MIN_DELETION_SHARE, `night ${nights}: ${spent}`);
      assert.ok(result.queries <= MIN_DELETION_SHARE);
      w.clock.now = new Date(w.clock.now.getTime() + 86_400_000);
    }
    assert.ok(nights > 1, 'a small share did the whole purge at once');
    assert.deepEqual(await whereIs(w.db, USER), []);
  });

  it('spends no more than the purge declares, measured', async () => {
    const w = world();
    await seed(w);
    await requestAccountDeletion(w.deps, USER);
    w.clock.now = new Date(PURGE_AT);
    const record = (await w.store.find(USER))!;
    const before = w.statements();
    const allowance = new QueryAllowance(500);
    assert.deepEqual(await purgeAccount(w.deps, record, allowance), {
      state: 'purged',
    });
    const measured = w.statements() - before;
    // Two projects: the one the migration made of the account's old work
    // and one made since. The snapshots step takes a pass for each.
    assert.ok(measured <= purgeQueriesLeft(record, 2), `${measured}`);
    assert.ok(measured <= allowance.spent, `${measured} > ${allowance.spent}`);
  });

  it('purges an account with more projects than one night can pay for, over several nights', async () => {
    // The step repeats one project at a time, and each pass retires the
    // project it deleted, so a small share still makes progress every
    // night instead of relisting the same prefixes for ever.
    const w = world();
    await requestAccountDeletion(w.deps, USER);
    const at = '2026-08-01T00:00:00.000Z';
    for (let n = 0; n < 12; n += 1) {
      const id = `proj_many_${String(n).padStart(2, '0')}`;
      await exec(
        w.db,
        `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
         VALUES (?1, ?2, 'Many', ?3, ?3, ?3)`,
        id,
        USER,
        at,
      );
      await w.bucket.put(`projects/${id}/snapshots/r1.json`, '{}');
    }
    w.clock.now = new Date(PURGE_AT);
    let nights = 0;
    while (w.clerk.deleted.length === 0) {
      nights += 1;
      assert.ok(nights < 20, 'the purge never finished');
      const before = w.statements();
      await runDeletionNight(w.deps, await findDeletionWork(w.deps), 20);
      const spent = w.statements() - before - QUERIES_TO_FIND_DELETIONS;
      assert.ok(spent <= 20, `night ${nights}: ${spent}`);
      w.clock.now = new Date(w.clock.now.getTime() + 86_400_000);
    }
    assert.ok(nights > 2, 'twelve projects fit in one small share');
    assert.deepEqual(w.bucket.keys(), []);
    assert.deepEqual(await whereIs(w.db, USER), []);
  });

  it('deletes a large prefix a bounded number of pages a night', async () => {
    const w = world();
    await requestAccountDeletion(w.deps, USER);
    for (let n = 0; n < 2500; n += 1) {
      await w.bucket.put(`media/${USER}/${String(n).padStart(5, '0')}`, 'x');
    }
    w.clock.now = new Date(PURGE_AT);
    await runDeletionNight(w.deps, await findDeletionWork(w.deps), 500);
    assert.equal(w.bucket.keys().length, 500);
    assert.deepEqual(w.clerk.deleted, []);
    w.clock.now = new Date('2026-10-02T00:00:00.000Z');
    await runDeletionNight(w.deps, await findDeletionWork(w.deps), 500);
    assert.equal(w.bucket.keys().length, 0);
    assert.deepEqual(w.clerk.deleted, [USER]);
  });

  it('accounts for every user-keyed column in the schema', async () => {
    // A table added later that keys on the user and is neither deleted nor
    // kept here would keep the Clerk id after a purge. The whole-database
    // search above catches it only if a test seeds it; this catches it the
    // day the column appears.
    const w = world();
    const handled = new Set([
      ...KEPT_BILLING_TABLES.map((table) => `${table}.user_id`),
      'account_deletions.user_id',
      // Deleted by the purge: each project in the `snapshots` step, as its
      // stored content goes, and any left in `deleteProjectRows`.
      'projects.user_id',
      'project_media.user_id',
      'github_bindings.user_id',
      'github_pushes.user_id',
      'referral_codes.user_id',
      'referral_attributions.referred_user_id',
      'referral_attributions.referrer_user_id',
      'billing_admin_credits.user_id',
      'access_invites.redeemed_by_user_id',
      'published_projects.user_id',
    ]);
    const tables =
      (
        await w.db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
          .all<{ name: string }>()
      ).results ?? [];
    const unhandled: string[] = [];
    for (const { name } of tables) {
      const columns =
        (
          await w.db
            .prepare(`PRAGMA table_info(${name})`)
            .all<{ name: string }>()
        ).results ?? [];
      for (const column of columns) {
        const key = `${name}.${column.name}`;
        if (/user_id$/.test(column.name) && !handled.has(key)) {
          unhandled.push(key);
        }
      }
    }
    assert.deepEqual(unhandled, []);
  });
});

describe('deleting the Clerk user', () => {
  it('calls the Backend API with the secret the Worker already holds', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await deleteClerkUser(
      { CLERK_SECRET_KEY: 'sk_test_x' },
      USER,
      (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0]?.url, `https://api.clerk.com/v1/users/${USER}`);
    assert.equal(calls[0]?.init.method, 'DELETE');
    assert.deepEqual(calls[0]?.init.headers, {
      authorization: 'Bearer sk_test_x',
    });
  });

  it('counts a user already gone as deleted, and a refusal as not', async () => {
    const answer = (status: number) =>
      (async () => new Response('{}', { status })) as unknown as typeof fetch;
    assert.deepEqual(
      await deleteClerkUser({ CLERK_SECRET_KEY: 'k' }, USER, answer(404)),
      { ok: true },
    );
    assert.equal(
      (await deleteClerkUser({ CLERK_SECRET_KEY: 'k' }, USER, answer(500))).ok,
      false,
    );
    assert.equal((await deleteClerkUser({}, USER, answer(200))).ok, false);
  });
});

describe('the routes', () => {
  function signedInAs(userId: string): ResolveCaller {
    return async () => ({
      denied: null,
      principal: { userId, policyIdentity: 'unknown' },
    });
  }

  function post(body: unknown): Request {
    return new Request('https://app.vibld.com/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function setup() {
    const w = world();
    const env = { DB: w.db };
    let takedowns = 0;
    const options = {
      takeDown: async () => {
        takedowns += 1;
      },
      resolve: signedInAs(USER),
      depsFor: () => w.deps,
    };
    return { w, env, options, takedowns: () => takedowns };
  }

  it('refuses to make a request without the typed phrase, and records nothing', async () => {
    const { w, env, options } = setup();
    for (const body of [{}, { confirm: 'yes' }, { confirm: 'delete' }]) {
      const response = await handleAccountDelete(post(body), env, options);
      assert.equal(response.status, 400);
    }
    assert.equal(await w.store.find(USER), null);
  });

  it('records the request with the phrase, takes the site down, and says what happened', async () => {
    const { w, env, options, takedowns } = setup();
    const response = await handleAccountDelete(
      post({ confirm: 'Delete my account' }),
      env,
      options,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      scheduled: boolean;
      purgeAfter: string;
      steps: Record<string, boolean>;
      cancellable: boolean;
    };
    assert.equal(body.scheduled, true);
    assert.equal(body.purgeAfter, PURGE_AT);
    assert.equal(body.cancellable, true);
    assert.equal(body.steps.sites, true);
    assert.equal(takedowns(), 1);
    assert.notEqual(await w.store.pending(USER), null);
    assert.ok(
      !JSON.stringify(body).includes('deleted-'),
      'the tombstone leaked',
    );
  });

  it('retries a standing request without asking for the phrase again', async () => {
    const { w, env, options } = setup();
    w.stripe.down = true;
    await seed(w);
    await handleAccountDelete(
      post({ confirm: CONFIRMATION_PHRASE }),
      env,
      options,
    );
    assert.equal(w.stripe.cancelled.length, 0);

    w.stripe.down = false;
    const retry = await handleAccountDelete(post({}), env, options);
    assert.equal(retry.status, 200);
    const body = (await retry.json()) as { steps: Record<string, boolean> };
    assert.equal(body.steps.subscription, true);
    assert.equal(w.stripe.cancelled.length, 1);
  });

  it('reports where a request stands', async () => {
    const { env, options } = setup();
    const get = () =>
      handleAccountDelete(
        new Request('https://app.vibld.com/api/account/delete'),
        env,
        options,
      );
    assert.deepEqual(await (await get()).json(), { scheduled: false });
    await handleAccountDelete(
      post({ confirm: CONFIRMATION_PHRASE }),
      env,
      options,
    );
    const body = (await (await get()).json()) as { scheduled: boolean };
    assert.equal(body.scheduled, true);
  });

  it("passes an unidentified caller's refusal straight through", async () => {
    const { env, options } = setup();
    const response = await handleAccountDelete(
      post({ confirm: CONFIRMATION_PHRASE }),
      env,
      {
        ...options,
        resolve: async () => ({
          denied: new Response('{}', { status: 401 }),
        }),
      },
    );
    assert.equal(response.status, 401);
  });

  it('keeps the account when asked within the period, and refuses once the purge has begun', async () => {
    const { w, env, options } = setup();
    await handleAccountDelete(
      post({ confirm: CONFIRMATION_PHRASE }),
      env,
      options,
    );
    const cancel = () =>
      handleAccountDeleteCancel(
        new Request('https://app.vibld.com/api/account/delete/cancel', {
          method: 'POST',
        }),
        env,
        signedInAs(USER),
      );
    assert.deepEqual(await (await cancel()).json(), { cancelled: true });
    assert.equal(await w.store.pending(USER), null);

    await handleAccountDelete(
      post({ confirm: CONFIRMATION_PHRASE }),
      env,
      options,
    );
    await w.store.advancePurge(USER, 1);
    assert.equal((await cancel()).status, 409);
  });

  it('lists pending deletions and their dates for the operator', async () => {
    const { w, env, options } = setup();
    await seed(w, { siteLive: true });
    await handleAccountDelete(
      post({ confirm: CONFIRMATION_PHRASE }),
      env,
      options,
    );
    const response = await handleAdminDeletions(
      new Request('https://app.vibld.com/api/admin/deletions'),
      env,
    );
    const body = (await response.json()) as {
      pending: { userId: string; purgeAfter: string; liveSlug: string }[];
      purged: number;
    };
    assert.equal(body.pending.length, 1);
    assert.equal(body.pending[0]?.userId, USER);
    assert.equal(body.pending[0]?.purgeAfter, PURGE_AT);
    // The fake takedown above did nothing, so the site is still up, and the
    // panel says so.
    assert.equal(body.pending[0]?.liveSlug, 'leaver-site');
    assert.equal(body.purged, 0);
  });
});

describe('the purge budget', () => {
  it('counts one query per kept billing table', () => {
    // Re-keying is one UPDATE per table, and the nightly share is sized
    // from this count; a table added to the list without it would let one
    // step spend more than it was given.
    assert.equal(
      AccountDeletionStore.BILLING_ROW_QUERIES,
      KEPT_BILLING_TABLES.length,
    );
  });
});
