import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TranscriptTurn } from '@vibld/core';

import { handleProjects } from '../worker/project-handlers.ts';
import type { ProjectsDeps } from '../worker/project-handlers.ts';
import { ProjectStore } from '../worker/project-store.ts';
import { D1GenerationStore } from '../worker/generation-store.ts';
import { handleShare, handleShareHold } from '../worker/share-handlers.ts';
import type { ShareDeps, ShareEnv } from '../worker/share-handlers.ts';
import type { PreviewStatus } from '../worker/preview-client.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import {
  isShareToken,
  newShareToken,
  sharePreviewKey,
} from '../worker/share-link.ts';
import type { Tier } from '../worker/entitlement.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * A project's share link (docs/decisions.md, "Resolved 2026-09-28",
 * sharing), against the real schema over SQLite and an in-memory R2.
 *
 * In the order somebody would notice them broken: a link can be turned on,
 * copied and turned off, and off is for good; it shows a stranger the code
 * and nothing about the owner; every way a link is meant to stop working
 * stops it (off, archive, delete, suspension, the account being deleted,
 * an operator's hold); an operator's hold is one the owner cannot undo; a
 * stranger can make a link cost at most one sandbox; and the address is
 * counted before anything is read.
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const BOB = 'user_bob0000000000000000000002';

interface Started {
  key: string;
  files: number;
  mediaOwner: string;
}

interface World {
  db: SqliteD1Database;
  bucket: InMemoryR2Bucket;
  tiers: Map<string, Tier>;
  clock: { now: Date };
  started: Started[];
  stopped: string[];
  owner(
    user: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, any> }>;
  share(
    path: string,
    options?: {
      method?: string;
      user?: string | null;
      env?: Partial<ShareEnv>;
      deps?: Partial<ShareDeps>;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; body: Record<string, any>; headers: Headers }>;
}

function world(): World {
  const db = new SqliteD1Database(schemaSql());
  const bucket = new InMemoryR2Bucket();
  const tiers = new Map<string, Tier>();
  const clock = { now: new Date('2026-09-28T12:00:00.000Z') };
  const started: Started[] = [];
  const stopped: string[] = [];
  let ids = 0;
  const newId = () => `project-${String((ids += 1)).padStart(3, '0')}`;
  const principal = (user: string) => async () =>
    ({ denied: null, principal: { userId: user } }) as PrincipalGranted;
  const links = { origin: ORIGIN, publishHostname: 'vibld-preview.dev' };

  return {
    db,
    bucket,
    tiers,
    clock,
    started,
    stopped,
    async owner(user, method, path, body) {
      const deps: ProjectsDeps = {
        resolvePrincipal: principal(user),
        now: () => clock.now,
        newId,
        tierOf: async (who) => tiers.get(who) ?? 'free',
        links,
        stopSharePreview: async (token) => {
          stopped.push(await sharePreviewKey(token));
        },
      };
      const response = await handleProjects(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers:
            body !== undefined
              ? { 'content-type': 'application/json', origin: ORIGIN }
              : {},
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps,
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
    async share(path, options = {}) {
      const method = options.method ?? 'GET';
      const user = options.user ?? null;
      const deps: ShareDeps = {
        resolvePrincipal: user
          ? principal(user)
          : async () => ({
              denied: new Response('{"error":"Sign in."}', { status: 401 }),
            }),
        preview: {
          async start(key, files, mediaOwner) {
            started.push({ key, files: files.length, mediaOwner });
            return { status: 'installing' } satisfies PreviewStatus;
          },
          async status() {
            return { status: 'starting' } satisfies PreviewStatus;
          },
        },
        links,
        now: () => clock.now,
        newId,
        tierOf: async (who) => tiers.get(who) ?? 'free',
        ...options.deps,
      };
      const response = await handleShare(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: {
            ...(method === 'POST'
              ? { 'content-type': 'application/json', origin: ORIGIN }
              : {}),
            'CF-Connecting-IP': '203.0.113.9',
            ...options.headers,
          },
          ...(method === 'POST' ? { body: '{}' } : {}),
        }),
        { DB: db, PROJECT_CONTENT: bucket, ...options.env },
        deps,
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
        headers: response.headers,
      };
    },
  };
}

/** An accepted build, the way the generation store makes one. */
async function build(w: World, projectId: string, revision = 'r1') {
  const store = new D1GenerationStore(w.db, w.bucket);
  const runId = `run-${projectId}-${revision}`;
  const base = (await store.loadAccepted(projectId))?.revision ?? null;
  await store.saveStage({
    runId,
    projectId,
    baseRevision: base,
    state: 'validating',
  });
  const promoted = await store.promote(projectId, runId, base, {
    revision,
    files: [
      { path: 'src/App.tsx', content: `export default () => <h1>Bakery</h1>;` },
      { path: 'index.html', content: '<div id="root"></div>' },
    ],
  });
  assert.ok(promoted.promoted);
}

async function project(w: World, user: string, name = 'Bakery') {
  const made = await w.owner(user, 'POST', '/api/projects', { name });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return made.body.project.id as string;
}

/** Turn the link on and return its token. */
async function shareOn(w: World, user: string, id: string): Promise<string> {
  const on = await w.owner(user, 'POST', `/api/projects/${id}/share`, {});
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.project.share.on, true);
  const url = on.body.project.share.url as string;
  assert.ok(url.startsWith(`${ORIGIN}/s/`), url);
  const token = url.slice(`${ORIGIN}/s/`.length);
  assert.ok(isShareToken(token), token);
  return token;
}

async function view(w: World, token: string) {
  return w.share(`/api/share/${token}`);
}

async function exec(db: SqliteD1Database, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

describe('the share link', () => {
  it('is off until the owner turns it on, and then shows the project', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);

    const before = await w.owner(ALICE, 'GET', `/api/projects/${id}`);
    assert.deepEqual(before.body.project.share, {
      on: false,
      url: null,
      held: false,
    });

    const token = await shareOn(w, ALICE, id);
    const shown = await view(w, token);
    assert.equal(shown.status, 200);
    assert.equal(shown.body.project.name, 'Bakery');
    assert.equal(shown.body.snapshot.revision, 'r1');
    assert.equal(shown.body.snapshot.files.length, 2);
    assert.equal(shown.body.livePreview, true);
    // A link that was turned off must stop answering at once.
    assert.equal(shown.headers.get('cache-control'), 'no-store');
  });

  it('keeps the same link when it is turned on twice', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const first = await shareOn(w, ALICE, id);
    const second = await shareOn(w, ALICE, id);
    assert.equal(second, first);
  });

  it('is dead for good once turned off, and a new one is a different link', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    const token = await shareOn(w, ALICE, id);

    const off = await w.owner(ALICE, 'DELETE', `/api/projects/${id}/share`);
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.project.share, {
      on: false,
      url: null,
      held: false,
    });
    assert.equal((await view(w, token)).status, 404);

    const again = await shareOn(w, ALICE, id);
    assert.notEqual(again, token);
    assert.equal((await view(w, again)).status, 200);
    assert.equal((await view(w, token)).status, 404);
  });

  it("stops the link's live preview when it is turned off", async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await w.owner(ALICE, 'DELETE', `/api/projects/${id}/share`);
    assert.deepEqual(w.stopped, [await sharePreviewKey(token)]);
  });

  it("is only the owner's to turn on or off", async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    const on = await w.owner(BOB, 'POST', `/api/projects/${id}/share`, {});
    assert.equal(on.status, 404);
    const off = await w.owner(BOB, 'DELETE', `/api/projects/${id}/share`);
    assert.equal(off.status, 404);
    assert.equal((await view(w, token)).status, 200);
  });

  it('carries a random token, never the project or the owner', async () => {
    const w = world();
    // A backfilled project's id is its owner's Clerk user id.
    await exec(
      w.db,
      `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
       VALUES (?1, ?1, 'Untitled project', ?2, ?2, ?2)`,
      ALICE,
      w.clock.now.toISOString(),
    );
    await build(w, ALICE);
    const token = await shareOn(w, ALICE, ALICE);
    assert.ok(!token.includes('alice'));

    const shown = await view(w, token);
    const text = JSON.stringify(shown.body);
    assert.ok(!text.includes(ALICE), 'the owner is in what a stranger sees');
    assert.deepEqual(Object.keys(shown.body).sort(), [
      'livePreview',
      'project',
      'snapshot',
    ]);
    assert.deepEqual(Object.keys(shown.body.project), ['name']);

    // Nor in the preview's sandbox, whose name is in its address.
    const started = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
    });
    assert.equal(started.status, 200);
    assert.ok(!w.started[0]!.key.includes('alice'), w.started[0]!.key);
    assert.match(w.started[0]!.key, /^shared-[0-9a-f]{32}$/);
  });

  it('makes tokens that are 256 random bits, and never the same twice', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 200; n += 1) {
      const token = newShareToken();
      assert.ok(isShareToken(token), token);
      seen.add(token);
    }
    assert.equal(seen.size, 200);
  });

  it('answers a token of the wrong shape as it answers a dead one', async () => {
    const w = world();
    for (const token of ['nope', 'a'.repeat(44), '%2e%2e']) {
      const shown = await view(w, token);
      assert.equal(shown.status, 404, token);
    }
    const unknown = await view(w, newShareToken());
    assert.equal(unknown.status, 404);
  });
});

describe('everything that stops a link', () => {
  it('stops it while the project is archived, and not after', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);

    await w.owner(ALICE, 'PATCH', `/api/projects/${id}`, { archived: true });
    assert.equal((await view(w, token)).status, 404);
    assert.deepEqual(w.stopped, [await sharePreviewKey(token)]);

    // An archived project cannot be shared anew either.
    const refused = await w.owner(
      ALICE,
      'POST',
      `/api/projects/${id}/share`,
      {},
    );
    assert.equal(refused.status, 409);

    await w.owner(ALICE, 'PATCH', `/api/projects/${id}`, { archived: false });
    assert.equal((await view(w, token)).status, 200);
  });

  it('stops it for good when the project is deleted', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    const deleted = await w.owner(ALICE, 'DELETE', `/api/projects/${id}`);
    assert.equal(deleted.status, 200);
    assert.equal((await view(w, token)).status, 404);
    assert.deepEqual(w.stopped, [await sharePreviewKey(token)]);
  });

  it('stops it while the owner is suspended', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    const at = w.clock.now.toISOString();
    await exec(
      w.db,
      `INSERT INTO billing_clawbacks
         (id, user_id, cause, stripe_event_id, stripe_charge_id,
          stripe_object_id, kind, charge_usd_cents, reversed_usd_cents,
          credit_removed_usd_cents, credit_shortfall_usd_cents,
          credit_granted_at, stripe_subscription_id, suspends, created_at)
       VALUES ('dispute:dp_1', ?1, 'dispute', 'evt_dp', 'ch_1',
               'cs_1', 'topup', 2000, 2000, 0, 0, ?2, NULL, 1, ?2)`,
      ALICE,
      at,
    );
    assert.equal((await view(w, token)).status, 404);
    // Nor can a stranger start its preview.
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
    });
    assert.equal(start.status, 404);
    assert.equal(w.started.length, 0);

    // An operator lifting the suspension brings it back.
    await exec(
      w.db,
      `UPDATE billing_clawbacks SET lifted_at = ?2 WHERE user_id = ?1`,
      ALICE,
      at,
    );
    assert.equal((await view(w, token)).status, 200);
  });

  it('stops it from the moment the owner asks for the account to be deleted', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await exec(
      w.db,
      `INSERT INTO account_deletions (user_id, tombstone, requested_at, purge_after)
       VALUES (?1, 'deleted-x', ?2, ?3)`,
      ALICE,
      '2026-09-28T12:00:00.000Z',
      '2026-10-28T12:00:00.000Z',
    );
    assert.equal((await view(w, token)).status, 404);

    // Keeping the account after all brings it back.
    await exec(
      w.db,
      `UPDATE account_deletions SET cancelled_at = ?2 WHERE user_id = ?1`,
      ALICE,
      '2026-09-29T12:00:00.000Z',
    );
    assert.equal((await view(w, token)).status, 200);
  });

  it('does not stop because somebody else is leaving', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await exec(
      w.db,
      `INSERT INTO account_deletions (user_id, tombstone, requested_at, purge_after)
       VALUES (?1, 'deleted-y', ?2, ?3)`,
      BOB,
      '2026-09-28T12:00:00.000Z',
      '2026-10-28T12:00:00.000Z',
    );
    assert.equal((await view(w, token)).status, 200);
  });
});

describe("an operator's hold on a link", () => {
  const hold = (
    w: World,
    link: string,
    options: { release?: boolean; reason?: unknown } = {},
  ) =>
    handleShareHold(
      { DB: w.db, PROJECT_CONTENT: w.bucket },
      {
        link,
        reason: options.reason ?? 'phishing report 41',
        by: 'ops@vibld.com',
        release: options.release ?? false,
        now: w.clock.now.toISOString(),
        stopPreview: async (token) => {
          w.stopped.push(await sharePreviewKey(token));
        },
      },
    );

  it('stops the link and its preview, named by the link a report carried', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);

    const held = await hold(w, `https://app.vibld.com/s/${token}`);
    assert.equal(held.status, 200);
    assert.deepEqual(await held.json(), { share: token, state: 'held' });
    assert.equal((await view(w, token)).status, 404);
    assert.deepEqual(w.stopped, [await sharePreviewKey(token)]);

    // The owner is told, in their own view of the project.
    const mine = await w.owner(ALICE, 'GET', `/api/projects/${id}`);
    assert.equal(mine.body.project.share.held, true);
  });

  it('is one the owner cannot undo by turning the link off and on', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await hold(w, token);

    // Off is always allowed: taking something down is never refused.
    const off = await w.owner(ALICE, 'DELETE', `/api/projects/${id}/share`);
    assert.equal(off.status, 200);
    const on = await w.owner(ALICE, 'POST', `/api/projects/${id}/share`, {});
    assert.equal(on.status, 409);
    assert.match(on.body.error, /operator/);
  });

  it('can be lifted with the reported link even after the owner turned it off', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await hold(w, token);
    await w.owner(ALICE, 'DELETE', `/api/projects/${id}/share`);

    const lifted = await hold(w, token, { release: true });
    assert.equal(lifted.status, 200);
    // Released, and still off: releasing hands the decision back.
    assert.deepEqual(await lifted.json(), { share: token, state: 'down' });
    assert.equal((await view(w, token)).status, 404);

    // The owner can share it again, as a new link.
    const again = await shareOn(w, ALICE, id);
    assert.notEqual(again, token);
  });

  it('puts the link back when released, if the owner left it on', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await hold(w, token);
    const lifted = await hold(w, token, { release: true });
    assert.deepEqual(await lifted.json(), { share: token, state: 'live' });
    assert.equal((await view(w, token)).status, 200);
  });

  it('keeps a record of who did what, and why, after the hold is gone', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    await hold(w, token);
    await hold(w, token, { release: true });
    // A second release finds nothing to lift, and records nothing.
    const again = await hold(w, token, { release: true });
    assert.equal(again.status, 409);

    const store = new ProjectStore(w.db, w.bucket);
    assert.deepEqual(await store.shareHoldHistory(id), [
      { action: 'held', actor: 'ops@vibld.com', reason: 'phishing report 41' },
      { action: 'released', actor: 'ops@vibld.com', reason: null },
    ]);
  });

  it('asks for a reason and a real link', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    assert.equal((await hold(w, token, { reason: '  ' })).status, 400);
    assert.equal((await hold(w, 'not-a-link')).status, 400);
    assert.equal((await hold(w, newShareToken())).status, 404);
  });
});

describe("a link's live preview", () => {
  it('starts one sandbox per link, with the code and the owner as media owner', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    const token = await shareOn(w, ALICE, id);

    const first = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'installing');
    const second = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
      headers: { 'CF-Connecting-IP': '198.51.100.7' },
    });
    assert.equal(second.status, 200);

    // Two viewers, one sandbox: the same name both times.
    const key = await sharePreviewKey(token);
    assert.deepEqual(w.started, [
      { key, files: 2, mediaOwner: ALICE },
      { key, files: 2, mediaOwner: ALICE },
    ]);

    const status = await w.share(`/api/share/${token}/preview`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'starting');
  });

  it('has nothing to start before anything is built', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    const shown = await view(w, token);
    assert.equal(shown.body.snapshot, null);
    assert.equal(shown.body.livePreview, false);
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
    });
    assert.equal(start.status, 409);
    assert.equal(w.started.length, 0);
  });

  it('says so where there is no preview service', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    const token = await shareOn(w, ALICE, id);
    const shown = await w.share(`/api/share/${token}`, {
      deps: { preview: null },
    });
    assert.equal(shown.body.livePreview, false);
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
      deps: { preview: null },
    });
    assert.equal(start.status, 503);
  });

  it('refuses a start from another site', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    const token = await shareOn(w, ALICE, id);
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(start.status, 403);
    assert.equal(w.started.length, 0);
  });
});

/**
 * Starting a link's live preview needs somebody signed in (docs/decisions.md,
 * 2026-09-28). Reading the link, and the preview's state, does not.
 */
describe('who can start a live preview', () => {
  async function shared() {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    return { w, token: await shareOn(w, ALICE, id) };
  }

  it('is refused to somebody not signed in, and nothing starts', async () => {
    const { w, token } = await shared();
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
    });
    assert.equal(start.status, 401);
    assert.equal(w.started.length, 0);
  });

  it('starts for somebody signed in, in the link sandbox with the owner media', async () => {
    const { w, token } = await shared();
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
    });
    assert.equal(start.status, 200);
    assert.deepEqual(w.started, [
      { key: await sharePreviewKey(token), files: 2, mediaOwner: ALICE },
    ]);
  });

  it("leaves the link and the preview's state open to anybody", async () => {
    const { w, token } = await shared();
    assert.equal((await view(w, token)).status, 200);
    const state = await w.share(`/api/share/${token}/preview`);
    assert.equal(state.status, 200);
    assert.equal(state.body.status, 'starting');
  });

  it('counts starts against the account as well as the address', async () => {
    const { w, token } = await shared();
    const asked: string[] = [];
    const refusing = {
      async limit({ key }: { key: string }) {
        asked.push(key);
        return { success: false };
      },
    };
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
      env: { SHARE_PREVIEW_BURST: refusing },
    });
    assert.equal(start.status, 429);
    assert.deepEqual(asked, [`share-preview:${BOB}`]);
    assert.equal(w.started.length, 0);

    // The same account from another address is still the same account.
    const again = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
      env: { SHARE_PREVIEW_BURST: refusing },
      headers: { 'CF-Connecting-IP': '198.51.100.7' },
    });
    assert.equal(again.status, 429);
  });

  it('is refused to a suspended account', async () => {
    const { w, token } = await shared();
    const at = w.clock.now.toISOString();
    await exec(
      w.db,
      `INSERT INTO billing_clawbacks
         (id, user_id, cause, stripe_event_id, stripe_charge_id,
          stripe_object_id, kind, charge_usd_cents, reversed_usd_cents,
          credit_removed_usd_cents, credit_shortfall_usd_cents,
          credit_granted_at, stripe_subscription_id, suspends, created_at)
       VALUES ('dispute:dp_bob', ?1, 'dispute', 'evt_dp', 'ch_bob',
               'cs_bob', 'topup', 2000, 2000, 0, 0, ?2, NULL, 1, ?2)`,
      BOB,
      at,
    );
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
    });
    assert.equal(start.status, 403);
    assert.equal(start.body.reason, 'account-suspended');
    assert.equal(w.started.length, 0);
  });

  it("passes on identity's own refusal, such as an account that is leaving", async () => {
    const { w, token } = await shared();
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      deps: {
        resolvePrincipal: async () => ({
          denied: new Response(
            JSON.stringify({ reason: 'deletion-scheduled' }),
            { status: 403 },
          ),
        }),
      },
    });
    assert.equal(start.status, 403);
    assert.equal(start.body.reason, 'deletion-scheduled');
    assert.equal(w.started.length, 0);
  });
});

describe('the per-address limit', () => {
  it('refuses before the database is read', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    const asked: string[] = [];
    const refusing = {
      async limit({ key }: { key: string }) {
        asked.push(key);
        return { success: false };
      },
    };
    // A database that throws on any use: the limit must answer first.
    const exploding = new Proxy(w.db, {
      get() {
        throw new Error('the database was read');
      },
    });
    const response = await handleShare(
      new Request(`${ORIGIN}/api/share/${token}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.9' },
      }),
      {
        DB: exploding as unknown as D1Database,
        PROJECT_CONTENT: w.bucket,
        SHARE_BURST: refusing,
      },
      {
        resolvePrincipal: async () => {
          throw new Error('nobody is identified to view a link');
        },
        preview: null,
        links: { origin: ORIGIN, publishHostname: 'vibld-preview.dev' },
      },
    );
    assert.equal(response.status, 429);
    assert.deepEqual(asked, ['share:203.0.113.9']);
  });

  it('counts the preview against the address too', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    const token = await shareOn(w, ALICE, id);
    const refusing = { limit: async () => ({ success: false }) };
    const start = await w.share(`/api/share/${token}/preview`, {
      method: 'POST',
      user: BOB,
      env: { SHARE_BURST: refusing },
    });
    assert.equal(start.status, 429);
    assert.equal(w.started.length, 0);
  });

  it('lets requests through when the limiter itself is down', async () => {
    const w = world();
    const id = await project(w, ALICE);
    const token = await shareOn(w, ALICE, id);
    const broken = {
      limit: async (): Promise<{ success: boolean }> => {
        throw new Error('limiter unavailable');
      },
    };
    const shown = await w.share(`/api/share/${token}`, {
      env: { SHARE_BURST: broken },
    });
    assert.equal(shown.status, 200);
  });
});

describe('what the conversation is to a link', () => {
  it('is never shown to a stranger', async () => {
    const w = world();
    const id = await project(w, ALICE);
    await build(w, id);
    const turn: TranscriptTurn = {
      id: 1,
      runId: 'run-1',
      prompt: 'Put my phone number, 555-0100, in the footer',
      at: 1_790_000_000_000,
      status: 'accepted',
      agentMessage: null,
      summary: 'Done.',
      fileCount: 2,
      revision: 'r1',
      problem: null,
      providerId: 'remote',
    };
    await w.owner(ALICE, 'PATCH', `/api/projects/${id}`, {
      transcript: [turn],
    });
    const token = await shareOn(w, ALICE, id);
    const shown = await view(w, token);
    assert.ok(!JSON.stringify(shown.body).includes('555-0100'));
  });
});
