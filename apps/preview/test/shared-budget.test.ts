import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CONTAINER_MAX_INSTANCES } from '../worker/capacity.ts';
import { HARD_LIFETIME_MS } from '../worker/fleet.ts';
import { PreviewFleet } from '../worker/preview-fleet.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * That previews and builds share one container budget (internal issue 197).
 *
 * `max_instances` gives the `PreviewSandbox` class twenty-five containers,
 * and since internal PR 196 a build runs in one of them. The budget used to be split
 * statically: twenty for previews and five kept back for builds, counted by
 * two separate fleet instances. So the twenty-first preview queued even
 * when nothing at all was building, which is not what L9 says ("25
 * concurrent previews across all users. The 26th request is queued with a
 * visible position, not rejected.").
 *
 * Chris chose the shared budget on 2026-09-27: one counter of twenty-five
 * for both, with builds bounded at five of it. Previews may use all
 * twenty-five whenever nothing is building, and a preview queues behind a
 * build only when the platform is genuinely full.
 *
 * The numbers below are the decision's, written out rather than imported,
 * so that a test of L9 cannot be satisfied by changing the constant it is
 * testing. The platform limit is imported, because `capacity.test.ts`
 * already pins it to `wrangler.jsonc`.
 */
const L9_PREVIEWS = 25;
const MAX_BUILDS = 5;

/** A fixed clock, moved only where a test says so. */
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const MINUTE = 60_000;

interface Ticket {
  id: number;
  active: boolean;
  position?: number;
}

interface Occupancy {
  previews: number;
  builds: number;
  waitingPreviews: number;
  waitingBuilds: number;
}

/**
 * The deployment as its callers use it, in one place.
 *
 * Every scenario below goes through this and nothing else, so what the
 * scenarios assert is behaviour rather than the shape of one API. It
 * mirrors `preview-sandbox.ts`: a preview enqueues, polls and releases; a
 * build enqueues, and a build that is not admitted on the spot is refused
 * as `busy` and gives its ticket straight back.
 */
interface Deployment {
  preview(label: string): Ticket;
  build(label: string): Ticket;
  poll(id: number): { active: boolean; position?: number };
  stopPreview(id: number): void;
  finishBuild(id: number): void;
  /** Counted from storage, never from what the fleet says about itself. */
  occupancy(): Occupancy;
}

function deployment(): Deployment {
  const { ctx, sql } = fakeDurableObjectCtx();
  const fleet = new PreviewFleet(ctx, {});
  return {
    preview: (label) => fleet.enqueue(label, 'preview'),
    build: (label) => {
      const ticket = fleet.enqueue(label, 'build');
      if (!ticket.active) fleet.release(ticket.id, 'build');
      return ticket;
    },
    poll: (id) => fleet.status(id),
    stopPreview: (id) => fleet.release(id, 'preview'),
    finishBuild: (id) => fleet.release(id, 'build'),
    occupancy: () => {
      const rows = sql
        .exec<{ kind: string; active: number; n: number }>(
          `SELECT kind, activated IS NOT NULL AS active, COUNT(*) AS n
             FROM queue WHERE released IS NULL GROUP BY kind, active`,
        )
        .toArray();
      const count = (kind: string, active: number) =>
        rows.find((row) => row.kind === kind && row.active === active)?.n ?? 0;
      return {
        previews: count('preview', 1),
        builds: count('build', 1),
        waitingPreviews: count('preview', 0),
        waitingBuilds: count('build', 0),
      };
    },
  };
}

/**
 * The invariants that must hold after every single call, whatever came
 * before it.
 *
 * The last one is L9 itself: a preview may be waiting only while every
 * container is taken. That is what the static split broke, and what an
 * over-cautious fix would break again.
 */
function assertWithinBudget(at: Deployment, context: string): void {
  const now = at.occupancy();
  const total = now.previews + now.builds;
  assert.ok(
    total <= CONTAINER_MAX_INSTANCES,
    `${context}: ${total} containers authorised against a platform limit of ${CONTAINER_MAX_INSTANCES}`,
  );
  assert.ok(
    now.builds <= MAX_BUILDS,
    `${context}: ${now.builds} builds running against a bound of ${MAX_BUILDS}`,
  );
  assert.equal(
    now.waitingBuilds,
    0,
    `${context}: a build is waiting in the queue, where it can be promoted for a caller that was already told busy`,
  );
  if (now.waitingPreviews > 0) {
    assert.equal(
      total,
      CONTAINER_MAX_INSTANCES,
      `${context}: ${now.waitingPreviews} previews wait while ${CONTAINER_MAX_INSTANCES - total} containers are free`,
    );
  }
}

function fill(
  at: Deployment,
  kind: 'preview' | 'build',
  count: number,
  prefix = kind,
): Ticket[] {
  const tickets: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    const ticket =
      kind === 'preview'
        ? at.preview(`${prefix}:${i}`)
        : at.build(`${prefix}:${i}`);
    assert.equal(ticket.active, true, `${prefix} ${i} was not admitted`);
    tickets.push(ticket);
  }
  return tickets;
}

const realNow = Date.now;
let clock = T0;
beforeEach(() => {
  clock = T0;
  Date.now = () => clock;
});
afterEach(() => {
  Date.now = realNow;
});

describe('one container budget for previews and builds (#197)', () => {
  it('admits all twenty-five previews L9 promises when nothing is building', () => {
    const at = deployment();
    fill(at, 'preview', L9_PREVIEWS);
    assert.deepEqual(at.occupancy(), {
      previews: L9_PREVIEWS,
      builds: 0,
      waitingPreviews: 0,
      waitingBuilds: 0,
    });

    // And the twenty-sixth is queued with a visible position, not refused.
    const next = at.preview('preview:26');
    assert.equal(next.active, false);
    assert.equal(next.position, 0);
    assert.equal(at.preview('preview:27').position, 1);
    assertWithinBudget(at, 'after the twenty-seventh preview');
  });

  it('refuses a sixth concurrent build even with free containers', () => {
    const at = deployment();
    fill(at, 'build', MAX_BUILDS);

    const sixth = at.build('build:6');
    assert.equal(sixth.active, false, 'a sixth build was admitted');
    assert.deepEqual(
      at.occupancy(),
      { previews: 0, builds: MAX_BUILDS, waitingPreviews: 0, waitingBuilds: 0 },
      'the refused build left something behind in the queue',
    );

    // The twenty containers it could not have are still there for previews.
    fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);
    assertWithinBudget(at, 'after the previews filled the rest');
  });

  it('gives previews the twenty that five builds leave, and the next one the moment a build finishes', () => {
    const at = deployment();
    const builds = fill(at, 'build', MAX_BUILDS);
    fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);

    const waiting = at.preview('preview:21');
    assert.equal(waiting.active, false, 'the platform has no room left');
    assert.equal(waiting.position, 0);
    assertWithinBudget(at, 'with five builds and twenty previews');

    at.finishBuild(builds[0]!.id);

    // Admitted by the release itself, so the storage says so before the
    // preview has even asked again.
    assert.deepEqual(at.occupancy(), {
      previews: CONTAINER_MAX_INSTANCES - MAX_BUILDS + 1,
      builds: MAX_BUILDS - 1,
      waitingPreviews: 0,
      waitingBuilds: 0,
    });
    assert.equal(at.poll(waiting.id).active, true);

    // The build's container went to the preview that was waiting for it,
    // not to whichever build asked next: the platform is full again.
    assert.equal(at.build('build:late').active, false);
    assertWithinBudget(at, 'after the preview took the build slot');
  });

  it('gives a preview the container a build did not need', () => {
    // The other direction, and the one the static split got wrong: with
    // two builds running, twenty-three previews fit, not twenty.
    const at = deployment();
    fill(at, 'build', 2);
    fill(at, 'preview', CONTAINER_MAX_INSTANCES - 2);
    assert.equal(at.preview('one-too-many').active, false);
    assertWithinBudget(at, 'with two builds running');
  });
});

describe('the total never exceeds the platform limit (#197)', () => {
  it('admits exactly one of a build and a preview racing for the last container, in either order', () => {
    for (const first of ['build', 'preview'] as const) {
      const at = deployment();
      fill(at, 'build', MAX_BUILDS - 1);
      fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);

      const a = first === 'build' ? at.build('b') : at.preview('p');
      const b = first === 'build' ? at.preview('p') : at.build('b');
      assert.equal(a.active, true, `${first} asked first and was refused`);
      assert.equal(b.active, false, `both got the last container`);
      assertWithinBudget(at, `${first} first`);
    }
  });

  it('frees one container for one release, however many times it arrives', () => {
    // A retried release is the ordinary case, not an edge: `releaseWithin`
    // retries by design, and an attempt that timed out may still land.
    const at = deployment();
    const builds = fill(at, 'build', MAX_BUILDS);
    fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);
    const first = at.preview('first');
    const second = at.preview('second');

    at.finishBuild(builds[0]!.id);
    at.finishBuild(builds[0]!.id);
    at.finishBuild(builds[0]!.id);

    assert.equal(at.poll(first.id).active, true);
    assert.deepEqual(at.poll(second.id), { active: false, position: 0 });
    assertWithinBudget(at, 'after a release that arrived three times');
  });

  it('frees nothing when a release names the wrong kind of ticket', () => {
    // Previews and builds were separate instances, so a build's ticket id
    // could never name a preview's row. They share one table now, and a
    // release that names the wrong kind must not free somebody else's
    // container.
    //
    // Counted from storage: `status` answers from `activated` alone, so it
    // reports a released row that was once admitted as still active, and
    // would pass this whether or not anything had been freed.
    const { ctx, sql } = fakeDurableObjectCtx();
    const fleet = new PreviewFleet(ctx, {});
    const preview = fleet.enqueue('preview', 'preview');
    const build = fleet.enqueue('build', 'build');
    fleet.release(preview.id, 'build');
    fleet.release(build.id, 'preview');
    const [held] = sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM queue WHERE activated IS NOT NULL AND released IS NULL`,
      )
      .toArray();
    assert.equal(held!.n, 2, 'a release freed a ticket of the other kind');
  });

  it('refuses a ticket kind it does not know rather than counting it as a preview', () => {
    // A kind arrives over RPC. Read as a preview, an unknown one would
    // escape the build bound.
    const { ctx } = fakeDurableObjectCtx();
    const fleet = new PreviewFleet(ctx, {});
    const unknown = 'bogus' as unknown as 'build';
    assert.throws(
      () => fleet.enqueue('x', unknown),
      /Unknown fleet ticket kind/,
    );
    const { id } = fleet.enqueue('p', 'preview');
    assert.throws(
      () => fleet.release(id, unknown),
      /Unknown fleet ticket kind/,
    );
  });

  it('counts the rows it held before builds shared it as previews', () => {
    // The instance already exists in production with the old table shape
    // and live preview rows in it. Read as anything else, those previews
    // would count against the build bound and refuse every build.
    const { ctx, sql } = fakeDurableObjectCtx();
    sql.exec(`
      CREATE TABLE queue (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        label     TEXT    NOT NULL,
        requested INTEGER NOT NULL,
        activated INTEGER,
        released  INTEGER,
        seen      INTEGER
      )
    `);
    const existing = CONTAINER_MAX_INSTANCES - MAX_BUILDS + 2;
    for (let i = 0; i < existing; i++) {
      sql.exec(
        `INSERT INTO queue (label, requested, activated, seen) VALUES (?, ?, ?, ?)`,
        `preview:${i}`,
        clock,
        clock,
        clock,
      );
    }
    const fleet = new PreviewFleet(ctx, {});
    const room = CONTAINER_MAX_INSTANCES - existing;
    for (let i = 0; i < room; i++) {
      assert.equal(fleet.enqueue(`build:${i}`, 'build').active, true);
    }
    assert.equal(fleet.enqueue('build:over', 'build').active, false);
    assert.equal(fleet.enqueue('preview:over', 'preview').active, false);
  });

  it('closes a refused build itself, so a release that never arrives cannot leave it in line', () => {
    // The caller releases a refused ticket too, but that is a call to
    // another object and can fail. A build row left waiting would stand in
    // front of the next preview and be promoted into its container for a
    // build that had already answered `busy`.
    const { ctx, sql } = fakeDurableObjectCtx();
    const fleet = new PreviewFleet(ctx, {});
    const builds = Array.from({ length: MAX_BUILDS }, (_, i) =>
      fleet.enqueue(`build:${i}`, 'build'),
    );
    const refused = fleet.enqueue('build:refused', 'build');
    assert.deepEqual(refused, { id: refused.id, active: false });

    const [open] = sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM queue WHERE id = ? AND released IS NULL`,
        refused.id,
      )
      .toArray();
    assert.equal(open!.n, 0, 'the refused build is still in the queue');

    fleet.release(builds[0]!.id, 'build');
    assert.equal(fleet.status(refused.id).active, false);
  });

  it('hands a stale build ticket to the waiting preview once, and ignores its late release', () => {
    const at = deployment();
    const stale = at.build('build:crashed');

    clock += 20 * MINUTE;
    fill(at, 'build', MAX_BUILDS - 1);
    fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);
    const next = at.preview('next');
    const after = at.preview('after');
    assert.equal(next.position, 0);
    assert.equal(after.position, 1);

    // The first build has outlived the hard lifetime without releasing;
    // everything else is eleven minutes old.
    clock += HARD_LIFETIME_MS - 20 * MINUTE + MINUTE;
    assert.equal(
      at.poll(next.id).active,
      true,
      'a container reclaimed from a build is not given to the preview waiting for it',
    );
    assert.deepEqual(at.poll(after.id), { active: false, position: 0 });
    assertWithinBudget(at, 'after the reclaim');

    // The crashed build's release arrives after all. It must not free the
    // container a second time: the preview holding it now is real.
    at.finishBuild(stale.id);
    assert.deepEqual(at.poll(after.id), { active: false, position: 0 });
    assert.equal(at.build('build:new').active, false);
    assertWithinBudget(at, 'after the late release');
  });

  it('holds under a long run of interleaved admissions, releases, polls and expiries', () => {
    // Seeded, so a failure names a sequence that can be replayed.
    for (const seed of [1, 7, 197, 2026, 90210]) {
      const random = mulberry32(seed);
      const at = deployment();
      const previews: number[] = [];
      const builds: number[] = [];
      const released: { id: number; kind: 'preview' | 'build' }[] = [];
      const pick = (list: number[]) =>
        list.splice(Math.floor(random() * list.length), 1)[0];

      for (let step = 0; step < 1_500; step++) {
        const roll = random();
        let op: string;
        if (roll < 0.3) {
          op = 'preview';
          previews.push(at.preview(`p${step}`).id);
        } else if (roll < 0.5) {
          op = 'build';
          const ticket = at.build(`b${step}`);
          if (ticket.active) builds.push(ticket.id);
        } else if (roll < 0.65 && previews.length > 0) {
          op = 'stop preview';
          const id = pick(previews)!;
          at.stopPreview(id);
          released.push({ id, kind: 'preview' });
        } else if (roll < 0.8 && builds.length > 0) {
          op = 'finish build';
          const id = pick(builds)!;
          at.finishBuild(id);
          released.push({ id, kind: 'build' });
        } else if (roll < 0.9 && previews.length > 0) {
          op = 'poll';
          at.poll(previews[Math.floor(random() * previews.length)]!);
        } else if (roll < 0.94 && released.length > 0) {
          op = 'repeat a release';
          const again = released[Math.floor(random() * released.length)]!;
          if (again.kind === 'preview') at.stopPreview(again.id);
          else at.finishBuild(again.id);
        } else if (roll < 0.97) {
          op = 'long wait';
          clock += Math.floor(random() * 40 * MINUTE);
        } else {
          op = 'short wait';
          clock += Math.floor(random() * MINUTE);
        }
        clock += 1;
        assertWithinBudget(at, `seed ${seed}, step ${step} (${op})`);
      }
    }
  });
});

describe('what a queued preview is told (#197)', () => {
  it('reports a position that counts previews ahead of it, not builds', () => {
    const at = deployment();
    const builds = fill(at, 'build', MAX_BUILDS);
    const previews = fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);
    const queued = ['q0', 'q1', 'q2'].map((label) => at.preview(label));
    assert.deepEqual(
      queued.map((ticket) => ticket.position),
      [0, 1, 2],
    );

    // A build that arrives now is refused rather than queued, so it never
    // stands in front of anybody and nobody's position moves.
    assert.equal(at.build('build:refused').active, false);
    assert.deepEqual(
      queued.map((ticket) => at.poll(ticket.id).position),
      [0, 1, 2],
    );

    // Position N means N containers must free up first, whichever kind of
    // work frees them. Alternate the two and count.
    at.finishBuild(builds[0]!.id);
    assert.equal(at.poll(queued[0]!.id).active, true);
    assert.deepEqual(at.poll(queued[1]!.id), { active: false, position: 0 });
    assert.deepEqual(at.poll(queued[2]!.id), { active: false, position: 1 });

    at.stopPreview(previews[0]!.id);
    assert.equal(at.poll(queued[1]!.id).active, true);
    assert.deepEqual(at.poll(queued[2]!.id), { active: false, position: 0 });

    at.finishBuild(builds[1]!.id);
    assert.equal(at.poll(queued[2]!.id).active, true);
    assertWithinBudget(at, 'after the queue drained');
  });

  it('moves everybody behind a preview up when it gives up waiting', () => {
    const at = deployment();
    fill(at, 'build', MAX_BUILDS);
    fill(at, 'preview', CONTAINER_MAX_INSTANCES - MAX_BUILDS);
    const [a, b, c] = ['a', 'b', 'c'].map((label) => at.preview(label));
    at.stopPreview(b!.id);
    assert.deepEqual(at.poll(a!.id), { active: false, position: 0 });
    assert.deepEqual(at.poll(c!.id), { active: false, position: 1 });
    assertWithinBudget(at, 'after a queued preview left');
  });
});

/** A small seeded generator, so the interleaving test is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
