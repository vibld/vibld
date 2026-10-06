import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CONTAINER_MAX_INSTANCES } from '../worker/capacity.ts';
import {
  HARD_LIFETIME_MS,
  queuePosition,
  toActivate,
} from '../worker/fleet.ts';
import {
  DEFAULT_FREE_PREVIEW_DAILY_MINUTES,
  FREE_PREVIEW_LIMIT_ERROR,
  dailyLimitMs,
  heldAtMostMs,
  mayStart,
  usedMs,
} from '../worker/free-previews.ts';
import { PreviewFleet } from '../worker/preview-fleet.ts';
import { parseStartRequest, parseStatusPlan } from '../worker/start-request.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * D158's preview half (Chris, 2026-10-05): a Free account's previews hold
 * a container for at most two hours a day, and never take the last five of
 * the twenty-five, which are kept for paid plans.
 *
 * The figures are the decision's, written out rather than imported, so a
 * test of D158 cannot be satisfied by changing the constant it tests.
 */
const PAID_KEPT = 5;
const FREE_MINUTES = 120;

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);

describe('Free preview containers (D158)', () => {
  let realNow: () => number;
  beforeEach(() => {
    realNow = Date.now;
    Date.now = () => T0;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  function fleet() {
    const { ctx, sql } = fakeDurableObjectCtx();
    return { fleet: new PreviewFleet(ctx, {}), sql };
  }

  it('starts Free previews only while five containers stay free', () => {
    const { fleet: f } = fleet();
    const free = CONTAINER_MAX_INSTANCES - PAID_KEPT;
    for (let i = 0; i < free; i++) {
      assert.equal(f.enqueue(`free-${i}`, 'preview', true).active, true);
    }
    const queued = f.enqueue('free-late', 'preview', true);
    assert.equal(queued.active, false);
    assert.equal(queued.position, 0);
  });

  it('lets paid previews take the containers kept for them, and pass a waiting Free one', () => {
    const { fleet: f } = fleet();
    for (let i = 0; i < CONTAINER_MAX_INSTANCES - PAID_KEPT; i++) {
      f.enqueue(`free-${i}`, 'preview', true);
    }
    const waiting = f.enqueue('free-late', 'preview', true);
    for (let i = 0; i < PAID_KEPT; i++) {
      assert.equal(
        f.enqueue(`paid-${i}`, 'preview').active,
        true,
        `paid preview ${i} should start`,
      );
    }
    assert.equal(f.enqueue('paid-late', 'preview').active, false);
    assert.equal(f.status(waiting.id).active, false);
  });

  it('starts a waiting Free preview once a container frees below the reserve', () => {
    const { fleet: f } = fleet();
    const tickets = [];
    for (let i = 0; i < CONTAINER_MAX_INSTANCES - PAID_KEPT; i++) {
      tickets.push(f.enqueue(`free-${i}`, 'preview', true));
    }
    const waiting = f.enqueue('free-late', 'preview', true);
    f.release(tickets[0]!.id, 'preview');
    assert.equal(f.status(waiting.id).active, true);
  });

  it('leaves paid previews the whole budget, as before', () => {
    const { fleet: f } = fleet();
    for (let i = 0; i < CONTAINER_MAX_INSTANCES; i++) {
      assert.equal(f.enqueue(`paid-${i}`, 'preview').active, true);
    }
    assert.equal(f.enqueue('paid-late', 'preview').active, false);
  });

  it('ignores the flag on a build, which has its own bound', () => {
    const { fleet: f, sql } = fleet();
    const ticket = f.enqueue('build', 'build', true);
    assert.equal(ticket.active, true);
    const [row] = sql
      .exec<{ free: number }>(`SELECT free FROM queue WHERE id = ?`, ticket.id)
      .toArray();
    assert.equal(row!.free, 0);
  });

  it('adds the column to a queue made before it, reading old rows as paid', () => {
    const { ctx, sql } = fakeDurableObjectCtx();
    sql.exec(`
      CREATE TABLE queue (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        label     TEXT    NOT NULL,
        requested INTEGER NOT NULL,
        activated INTEGER,
        released  INTEGER,
        seen      INTEGER,
        kind      TEXT NOT NULL DEFAULT 'preview'
      )
    `);
    sql.exec(`INSERT INTO queue (label, requested) VALUES ('old', ?)`, T0);
    const f = new PreviewFleet(ctx, {});
    const [row] = sql
      .exec<{ free: number }>(`SELECT free FROM queue WHERE label = 'old'`)
      .toArray();
    assert.equal(row!.free, 0);
    assert.equal(f.enqueue('new', 'preview', true).active, true);
  });

  it("puts a paid preview's position ahead of the Free ones it will pass (#376 review)", () => {
    const waiting = [
      { id: 1, requested: 1, free: true },
      { id: 2, requested: 2, free: true },
      { id: 3, requested: 3 },
      { id: 4, requested: 4, free: true },
    ];
    assert.equal(queuePosition(waiting[2]!, waiting), 0);
    assert.equal(queuePosition(waiting[3]!, waiting), 3);
    // A Free preview counts the paid one behind it too, which will pass it.
    assert.equal(queuePosition(waiting[0]!, waiting), 1);
    assert.equal(queuePosition(waiting[1]!, waiting), 2);
  });

  it('passes a Free row over in the arithmetic without stopping the queue', () => {
    const waiting = [
      { id: 1, requested: 1, free: true },
      { id: 2, requested: 2 },
    ];
    const admitted = toActivate(
      waiting,
      CONTAINER_MAX_INSTANCES - PAID_KEPT,
      CONTAINER_MAX_INSTANCES,
      undefined,
      PAID_KEPT,
    );
    assert.deepEqual(
      admitted.map((row) => row.id),
      [2],
    );
  });
});

describe('Free preview time (D158)', () => {
  it('defaults to two hours a day', () => {
    assert.equal(DEFAULT_FREE_PREVIEW_DAILY_MINUTES, FREE_MINUTES);
    assert.equal(dailyLimitMs(undefined), FREE_MINUTES * MINUTE);
    assert.equal(dailyLimitMs('nonsense'), FREE_MINUTES * MINUTE);
    assert.equal(dailyLimitMs('-5'), FREE_MINUTES * MINUTE);
    assert.equal(dailyLimitMs('45'), 45 * MINUTE);
    assert.equal(dailyLimitMs('0'), 0);
  });

  it('counts an ended session from admission to release', () => {
    assert.equal(
      usedMs([{ began: T0, ended: T0 + 7 * MINUTE }], T0 + HARD_LIFETIME_MS),
      7 * MINUTE,
    );
  });

  it('counts a running session up to now', () => {
    assert.equal(usedMs([{ began: T0 }], T0 + 4 * MINUTE), 4 * MINUTE);
  });

  it('counts a session nobody ended as its whole hard lifetime, and never more', () => {
    assert.equal(
      usedMs([{ began: T0, ended: null }], T0 + 3 * HARD_LIFETIME_MS),
      HARD_LIFETIME_MS,
    );
    assert.equal(
      usedMs(
        [{ began: T0, ended: T0 + 3 * HARD_LIFETIME_MS }],
        T0 + 4 * HARD_LIFETIME_MS,
      ),
      HARD_LIFETIME_MS,
    );
  });

  it('charges the part of a session after midnight to the new day (#376 review)', () => {
    const midnight = Date.UTC(2026, 9, 7);
    const session = { began: midnight - 10 * MINUTE };
    assert.equal(usedMs([session], midnight + 5 * MINUTE), 5 * MINUTE);
    assert.equal(
      usedMs([session], midnight + HARD_LIFETIME_MS),
      HARD_LIFETIME_MS - 10 * MINUTE,
    );
    assert.equal(usedMs([{ began: T0, ended: T0 + MINUTE }], midnight + 1), 0);
  });

  it('reserves an open session only up to midnight (#376 review)', () => {
    const midnight = Date.UTC(2026, 9, 7);
    const sessions: { began: number; ended?: number }[] = [1, 2, 3].map(
      (i) => ({
        began: midnight - 2 * HARD_LIFETIME_MS * i,
        ended: midnight - 2 * HARD_LIFETIME_MS * i + HARD_LIFETIME_MS,
      }),
    );
    sessions.push({ began: midnight - 10 * MINUTE });
    // Ninety minutes held and ten more this side of midnight.
    assert.equal(heldAtMostMs(sessions, midnight - 5 * MINUTE), 100 * MINUTE);
    assert.equal(
      mayStart(sessions, midnight - 5 * MINUTE, dailyLimitMs(undefined)),
      true,
    );
  });

  it('refuses once two hours are used, and not before', () => {
    const limit = dailyLimitMs(undefined);
    const sessions = [0, 1, 2].map((i) => ({
      began: T0 + i * HARD_LIFETIME_MS,
      ended: T0 + (i + 1) * HARD_LIFETIME_MS,
    }));
    const at = T0 + 4 * HARD_LIFETIME_MS;
    assert.equal(mayStart(sessions, at, limit), true);
    sessions.push({
      began: T0 + 3 * HARD_LIFETIME_MS,
      ended: T0 + 4 * HARD_LIFETIME_MS,
    });
    assert.equal(mayStart(sessions, at, limit), false);
    assert.equal(mayStart([], at, limit), true);
    assert.equal(mayStart([], at, 0), false);
  });

  it('says when it resets and what lifts it', () => {
    assert.match(FREE_PREVIEW_LIMIT_ERROR, /midnight UTC/);
    assert.match(FREE_PREVIEW_LIMIT_ERROR, /paid plan/);
  });
});

describe("an account's Free day in the fleet (D158)", () => {
  let now = T0;
  let realNow: () => number;
  beforeEach(() => {
    realNow = Date.now;
    now = T0;
    Date.now = () => now;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  function fleet(env = {}) {
    const { ctx, sql } = fakeDurableObjectCtx();
    return { fleet: new PreviewFleet(ctx, env), sql };
  }

  /** Four half-hour previews, each stopped as its lifetime ends. */
  function spendTheDay(f: PreviewFleet, account: string): void {
    for (let i = 0; i < 4; i++) {
      const ticket = f.enqueue(`sandbox-${i}`, 'preview', true, account);
      assert.equal(ticket.active, true, `preview ${i} should start`);
      now += HARD_LIFETIME_MS;
      f.release(ticket.id, 'preview');
    }
  }

  it('refuses the account once two hours are held, writing no row', () => {
    const { fleet: f, sql } = fleet();
    spendTheDay(f, 'user_a');
    const refused = f.enqueue('sandbox-5', 'preview', true, 'user_a');
    assert.deepEqual(refused, { id: 0, active: false, limited: true });
    const [row] = sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM queue WHERE released IS NULL`,
      )
      .toArray();
    assert.equal(row!.n, 0);
  });

  it('counts every sandbox of one account against one day (#376 review)', () => {
    const { fleet: f } = fleet();
    // The builder's sandbox and two share links' sandboxes, one owner.
    for (const sandbox of ['user_a', 'share-1', 'share-2', 'share-3']) {
      const ticket = f.enqueue(sandbox, 'preview', true, 'user_a');
      assert.equal(ticket.active, true);
      now += HARD_LIFETIME_MS;
      f.release(ticket.id, 'preview');
    }
    assert.equal(f.enqueue('share-4', 'preview', true, 'user_a').limited, true);
    assert.equal(f.enqueue('user_b', 'preview', true, 'user_b').active, true);
  });

  it('counts only the time a slot was held', () => {
    const { fleet: f } = fleet();
    for (let i = 0; i < 10; i++) {
      const ticket = f.enqueue('user_a', 'preview', true, 'user_a');
      now += 5 * MINUTE;
      f.release(ticket.id, 'preview');
    }
    assert.equal(f.enqueue('user_a', 'preview', true, 'user_a').active, true);
  });

  it('counts a preview never stopped until the fleet reclaims it', () => {
    const { fleet: f } = fleet();
    for (let i = 0; i < 4; i++) {
      f.enqueue(`sandbox-${i}`, 'preview', true, 'user_a');
      now += HARD_LIFETIME_MS + MINUTE;
    }
    assert.equal(f.enqueue('again', 'preview', true, 'user_a').limited, true);
  });

  it('carries a session across midnight into the new day (#376 review)', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '20' });
    now = Date.UTC(2026, 9, 7) - 5 * MINUTE;
    f.enqueue('user_a', 'preview', true, 'user_a');
    now = Date.UTC(2026, 9, 7) + 20 * MINUTE;
    assert.equal(f.enqueue('again', 'preview', true, 'user_a').limited, true);
  });

  it('holds starts just before midnight to the next day too (#376 review)', () => {
    const { fleet: f } = fleet();
    now = Date.UTC(2026, 9, 7) - MINUTE;
    let admitted = 0;
    for (let i = 0; i < 20; i++) {
      if (f.enqueue(`share-${i}`, 'preview', true, 'user_a').active) admitted++;
    }
    // Each would hold 29 minutes of tomorrow: five reach two hours.
    assert.equal(admitted, 5);
  });

  it('starts every UTC day fresh', () => {
    const { fleet: f } = fleet();
    spendTheDay(f, 'user_a');
    now = Date.UTC(2026, 9, 7, 0, 1);
    assert.equal(f.enqueue('user_a', 'preview', true, 'user_a').active, true);
  });

  it('reads the limit from the deployment, where zero turns Free previews off', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '0' });
    assert.equal(f.enqueue('user_a', 'preview', true, 'user_a').limited, true);
    assert.equal(f.enqueue('user_a', 'preview').active, true);
  });

  it('holds parallel starts to the day as if each runs its full lifetime (#376 review)', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '60' });
    assert.equal(f.enqueue('user_a', 'preview', true, 'user_a').active, true);
    assert.equal(f.enqueue('share-1', 'preview', true, 'user_a').active, true);
    assert.equal(f.enqueue('share-2', 'preview', true, 'user_a').limited, true);
  });

  it('checks a queued Free preview again before admitting it (#376 review)', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '60' });
    f.enqueue('user_a', 'preview', true, 'user_a');
    const paid = [];
    for (let i = 0; i < CONTAINER_MAX_INSTANCES - PAID_KEPT - 1; i++) {
      paid.push(f.enqueue(`paid-${i}`, 'preview'));
    }
    const second = f.enqueue('share-1', 'preview', true, 'user_a');
    const third = f.enqueue('share-2', 'preview', true, 'user_a');
    assert.equal(second.active, false);
    assert.equal(third.active, false);
    f.release(paid[0]!.id, 'preview');
    f.release(paid[1]!.id, 'preview');
    assert.equal(f.status(second.id).active, true);
    assert.deepEqual(f.status(third.id), { active: false, limited: true });
  });

  it('keeps counting a preview a release of the wrong kind did not free (#376 review)', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '30' });
    const ticket = f.enqueue('user_a', 'preview', true, 'user_a');
    now += 5 * MINUTE;
    f.release(ticket.id, 'build');
    assert.equal(f.enqueue('share-1', 'preview', true, 'user_a').limited, true);
    f.release(ticket.id, 'preview');
    assert.equal(f.enqueue('share-1', 'preview', true, 'user_a').active, true);
  });

  it('takes the plan a waiting preview has now, keeping its place (#376 review)', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '30' });
    // user_b spends today's 30 minutes.
    const spent = f.enqueue('user_b', 'preview', true, 'user_b');
    now += 30 * MINUTE;
    f.release(spent.id, 'preview');
    for (let i = 0; i < CONTAINER_MAX_INSTANCES - PAID_KEPT; i++) {
      f.enqueue(`paid-${i}`, 'preview');
    }
    // Upgraded while held behind the reserve: admitted as paid.
    const upgraded = f.enqueue('user_a', 'preview', true, 'user_a');
    assert.equal(upgraded.active, false);
    assert.equal(
      f.status(upgraded.id, { free: false, account: 'user_a' }).active,
      true,
    );
    for (let i = 1; i < PAID_KEPT; i++) f.enqueue(`paid-x${i}`, 'preview');
    // Queued as paid, Free by now with the day spent: refused, not admitted.
    const downgraded = f.enqueue('user_b', 'preview', false, 'user_b');
    assert.equal(downgraded.active, false);
    assert.deepEqual(
      f.status(downgraded.id, { free: true, account: 'user_b' }),
      { active: false, limited: true },
    );
  });

  it('never holds a paid preview to the day', () => {
    const { fleet: f } = fleet({ VIBLD_FREE_PREVIEW_DAILY_MINUTES: '0' });
    assert.equal(f.enqueue('user_a', 'preview', false, 'user_a').active, true);
  });
});

describe('the start request (D158)', () => {
  const FILES = [{ path: 'index.html', content: '<p>hi</p>' }];

  it('is paid unless apps/web says Free', () => {
    const parsed = parseStartRequest({ userId: 'user_1', files: FILES });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.free, false);
    const free = parseStartRequest({
      userId: 'user_1',
      files: FILES,
      free: true,
    });
    assert.ok(free.ok);
    assert.equal(free.value.free, true);
  });

  it('refuses a flag that is not a boolean', () => {
    const parsed = parseStartRequest({
      userId: 'user_1',
      files: FILES,
      free: 'yes',
    });
    assert.equal(parsed.ok, false);
  });
});

describe('the status poll (D158)', () => {
  const read = (query: string) =>
    parseStatusPlan(new URLSearchParams(query), 'share_key');

  it('carries no plan unless it is given one, as before', () => {
    assert.deepEqual(read('userId=share_key'), { ok: true });
  });

  it("carries the plan and the owner's account (#376 review)", () => {
    assert.deepEqual(read('free=true&account=user_a'), {
      ok: true,
      plan: { free: true, account: 'user_a' },
    });
    assert.deepEqual(read('free=false'), {
      ok: true,
      plan: { free: false, account: 'share_key' },
    });
    assert.equal(read('free=yes').ok, false);
    assert.equal(read('free=true&account=').ok, false);
  });
});

describe('the sandbox (D158)', () => {
  const source = readFileSync(
    join(import.meta.dirname, '../worker/preview-sandbox.ts'),
    'utf8',
  );

  it("asks for the owner's day and stores nothing for a refused start", () => {
    assert.match(source, /'preview',\s*free,\s*owner \?\? label/);
    assert.match(source, /status\(\s*state\.fleetTicketId,\s*plan,?\s*\)/);
    assert.match(
      source,
      /fleet\.status\(existing\.fleetTicketId,\s*\{\s*free,\s*account: owner \?\? label,?\s*\}\)/,
    );
    assert.match(
      source,
      /if \(ticket\.limited\) \{\s*return \{ status: 'failed', error: FREE_PREVIEW_LIMIT_ERROR \};/,
    );
  });
});
