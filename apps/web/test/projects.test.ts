import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TranscriptTurn } from '@vibld/core';

import { handleProjects } from '../worker/project-handlers.ts';
import type { ProjectsDeps } from '../worker/project-handlers.ts';
import { ProjectStore, resolveRunProject } from '../worker/project-store.ts';
import { D1GenerationStore } from '../worker/generation-store.ts';
import { ACTIVE_PROJECT_LIMIT } from '../worker/entitlement.ts';
import type { Tier } from '../worker/entitlement.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql, schemaSqlBetween } from './fakes/schema.ts';

/**
 * `/api/projects` and the rules behind it (docs/decisions.md, "Resolved
 * 2026-09-28", projects), against the real schema over SQLite and an
 * in-memory R2.
 *
 * In the order somebody would notice them broken: the work built before
 * projects existed comes back as a project; a project is only ever its
 * owner's; a free account holds three active projects and no more, however
 * it tries; deleting a project leaves nothing of it behind, anywhere; a
 * copy is a whole copy; and a builder older than projects still builds in
 * the project it was showing.
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const BOB = 'user_bob0000000000000000000002';

interface World {
  db: SqliteD1Database;
  bucket: InMemoryR2Bucket;
  tiers: Map<string, Tier>;
  clock: { now: Date };
  call(
    user: string,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: Record<string, any> }>;
}

function world(db = new SqliteD1Database(schemaSql())): World {
  const bucket = new InMemoryR2Bucket();
  const tiers = new Map<string, Tier>();
  const clock = { now: new Date('2026-09-28T12:00:00.000Z') };
  let ids = 0;
  const deps = (user: string): ProjectsDeps => ({
    resolvePrincipal: async () =>
      ({ denied: null, principal: { userId: user } }) as PrincipalGranted,
    now: () => clock.now,
    newId: () => `project-${String((ids += 1)).padStart(3, '0')}`,
    tierOf: async (who) => tiers.get(who) ?? 'free',
  });
  return {
    db,
    bucket,
    tiers,
    clock,
    async call(user, method, path, body, headers = {}) {
      const response = await handleProjects(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: {
            ...(body !== undefined
              ? { 'content-type': 'application/json', origin: ORIGIN }
              : {}),
            ...headers,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps(user),
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
  };
}

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

const turn = (over: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id: 1,
  runId: 'run-1',
  prompt: 'A landing page for a bakery',
  at: 1_790_000_000_000,
  status: 'accepted',
  agentMessage: null,
  summary: 'Built a one-page site.',
  fileCount: 1,
  revision: 'r1',
  problem: null,
  providerId: 'remote',
  ...over,
});

/** A project with an accepted build, the way the generation store makes one. */
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
  const snapshot = {
    revision,
    files: [{ path: 'index.html', content: `<h1>${projectId}</h1>` }],
  };
  const promoted = await store.promote(projectId, runId, base, snapshot);
  assert.ok(promoted.promoted);
  return snapshot;
}

async function create(w: World, user: string, body: unknown = {}) {
  const made = await w.call(user, 'POST', '/api/projects', body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return made.body.project as { id: string; name: string };
}

describe('the backfill', () => {
  it("turns each account's one project into its first project, named and owned", async () => {
    // The schema as it stood before projects, with the rows `handlePlan`
    // made under it: one project per account, its id the Clerk user id.
    const db = new SqliteD1Database(schemaSqlBetween('', '0033'));
    await db
      .prepare(
        `INSERT INTO generation_projects VALUES
           (?1, 'r1', '2026-09-01T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
           (?2, NULL, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')`,
      )
      .bind(ALICE, BOB)
      .run();

    db.exec(schemaSqlBetween('0033', '0034'));

    const rows =
      (
        await db
          .prepare(
            `SELECT id, user_id, name, archived_at, created_at, updated_at,
                    last_opened_at, transcript_key
               FROM projects ORDER BY id`,
          )
          .all<Record<string, string | null>>()
      ).results ?? [];
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        {
          id: ALICE,
          user_id: ALICE,
          name: 'Untitled project',
          archived_at: null,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-20T00:00:00.000Z',
          // When it was last really worked on, so it sorts as such.
          last_opened_at: '2026-09-20T00:00:00.000Z',
          transcript_key: null,
        },
        {
          id: BOB,
          user_id: BOB,
          name: 'Untitled project',
          archived_at: null,
          created_at: '2026-09-05T00:00:00.000Z',
          updated_at: '2026-09-05T00:00:00.000Z',
          last_opened_at: '2026-09-05T00:00:00.000Z',
          transcript_key: null,
        },
      ],
    );
  });

  it('gives back what was built: the old project opens with its code', async () => {
    // What this migration is for. The code was in R2 all along, under the
    // user id; nothing could name it as a project until now.
    const db = new SqliteD1Database(schemaSqlBetween('', '0033'));
    const w = world(db);
    await build(w, ALICE, 'r7');
    // 0033 and everything after it, since the routes read today's schema.
    db.exec(schemaSqlBetween('0033', '￿'));

    const listed = await w.call(ALICE, 'GET', '/api/projects');
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listed.body.projects.map((p: any) => [p.id, p.name, p.hasCode]),
      [[ALICE, 'Untitled project', true]],
    );

    const opened = await w.call(ALICE, 'GET', `/api/projects/${ALICE}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.snapshot.revision, 'r7');
    assert.deepEqual(opened.body.snapshot.files, [
      { path: 'index.html', content: `<h1>${ALICE}</h1>` },
    ]);
    assert.deepEqual(opened.body.transcript, []);
  });

  it('applies to an empty database without complaint', () => {
    const db = new SqliteD1Database(schemaSql());
    assert.ok(db);
  });
});

describe('whose a project is', () => {
  it("answers 404, not 403, for every route on somebody else's project", async () => {
    const w = world();
    const mine = await create(w, ALICE);
    for (const [method, path, body] of [
      ['GET', `/api/projects/${mine.id}`, undefined],
      ['PATCH', `/api/projects/${mine.id}`, { name: 'Taken' }],
      ['DELETE', `/api/projects/${mine.id}`, undefined],
      ['POST', `/api/projects/${mine.id}/duplicate`, {}],
    ] as const) {
      const answer = await w.call(BOB, method, path, body);
      assert.equal(answer.status, 404, `${method} ${path}`);
      assert.equal(answer.body.error, 'That project does not exist.');
    }
    // And nothing of Alice's moved.
    const still = await w.call(ALICE, 'GET', `/api/projects/${mine.id}`);
    assert.equal(still.body.project.name, 'Untitled project');
  });

  it("lists only the caller's own projects", async () => {
    const w = world();
    await create(w, ALICE, { name: 'Bakery' });
    await create(w, BOB, { name: 'Garage' });
    const listed = await w.call(BOB, 'GET', '/api/projects');
    assert.deepEqual(
      listed.body.projects.map((p: any) => p.name),
      ['Garage'],
    );
  });

  it('answers 404 for an id that could not be a project', async () => {
    const w = world();
    for (const id of ['..', 'a%2Fb', 'x'.repeat(200)]) {
      const answer = await w.call(ALICE, 'GET', `/api/projects/${id}`);
      assert.equal(answer.status, 404, id);
    }
  });

  it('refuses a cross-site write before looking anyone up', async () => {
    const w = world();
    const answer = await w.call(
      ALICE,
      'POST',
      '/api/projects',
      {},
      { origin: 'https://evil.example' },
    );
    assert.equal(answer.status, 403);
    assert.equal(await count(w.db, `SELECT COUNT(*) AS n FROM projects`), 0);
  });
});

describe('the limit on active projects', () => {
  it('holds a free account to three, with a reason and a code the builder can act on', async () => {
    const w = world();
    for (let n = 0; n < ACTIVE_PROJECT_LIMIT.free!; n += 1)
      await create(w, ALICE);
    const refused = await w.call(ALICE, 'POST', '/api/projects', {});
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'project-limit');
    assert.equal(refused.body.limit, 3);
    assert.match(refused.body.error, /Archive one .* or upgrade/);
    assert.equal(
      await count(
        w.db,
        `SELECT COUNT(*) AS n FROM projects WHERE user_id = ?1`,
        ALICE,
      ),
      3,
    );
  });

  it('does not limit a paid account', async () => {
    for (const tier of ['build', 'ship'] as const) {
      const w = world();
      w.tiers.set(ALICE, tier);
      for (let n = 0; n < 6; n += 1) await create(w, ALICE);
      const listed = await w.call(ALICE, 'GET', '/api/projects');
      assert.equal(listed.body.projects.length, 6, tier);
      assert.equal(listed.body.limits.maxActive, null);
    }
  });

  it('reads the tier from the mirrored subscription by default', async () => {
    // The same reading the allowance makes (`tierFor` over
    // `findActiveSubscription`), so the two cannot disagree.
    const db = new SqliteD1Database(schemaSql());
    const bucket = new InMemoryR2Bucket();
    await db
      .prepare(
        `INSERT INTO billing_subscriptions
           (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
            price_id, current_period_end, cancel_at_period_end, created_at,
            updated_at)
         VALUES ('sub_1', ?1, 'cus_1', 'build', 'active', 'price_build', NULL,
                 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
      )
      .bind(ALICE)
      .run();
    let ids = 0;
    const deps = (user: string): ProjectsDeps => ({
      resolvePrincipal: async () =>
        ({ denied: null, principal: { userId: user } }) as PrincipalGranted,
      newId: () => `p${(ids += 1)}`,
    });
    const post = (user: string) =>
      handleProjects(
        new Request(`${ORIGIN}/api/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: '{}',
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps(user),
      );
    for (let n = 0; n < 5; n += 1) {
      assert.equal((await post(ALICE)).status, 201, `paid project ${n + 1}`);
    }
    for (let n = 0; n < 3; n += 1) assert.equal((await post(BOB)).status, 201);
    assert.equal((await post(BOB)).status, 403, 'a free account made a fourth');
  });

  it('frees a slot when a project is archived, and archiving is never limited', async () => {
    const w = world();
    const made = [];
    for (let n = 0; n < 3; n += 1) made.push(await create(w, ALICE));
    const archived = await w.call(
      ALICE,
      'PATCH',
      `/api/projects/${made[0]!.id}`,
      {
        archived: true,
      },
    );
    assert.equal(archived.status, 200);
    assert.equal(archived.body.project.archived, true);
    await create(w, ALICE);

    const listed = await w.call(ALICE, 'GET', '/api/projects');
    assert.equal(listed.body.projects.length, 4);
    assert.deepEqual(listed.body.limits, {
      tier: 'free',
      active: 3,
      maxActive: 3,
    });
  });

  it('refuses to unarchive past the limit, and changes nothing else in that request', async () => {
    const w = world();
    const first = await create(w, ALICE, { name: 'First' });
    await w.call(ALICE, 'PATCH', `/api/projects/${first.id}`, {
      archived: true,
    });
    for (let n = 0; n < 3; n += 1) await create(w, ALICE);

    const refused = await w.call(ALICE, 'PATCH', `/api/projects/${first.id}`, {
      archived: false,
      name: 'Renamed anyway',
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'project-limit');
    const still = await w.call(ALICE, 'GET', `/api/projects/${first.id}`);
    assert.equal(still.body.project.archived, true);
    assert.equal(still.body.project.name, 'First');
  });

  it('unarchives inside the limit', async () => {
    const w = world();
    const first = await create(w, ALICE);
    await w.call(ALICE, 'PATCH', `/api/projects/${first.id}`, {
      archived: true,
    });
    const back = await w.call(ALICE, 'PATCH', `/api/projects/${first.id}`, {
      archived: false,
    });
    assert.equal(back.status, 200);
    assert.equal(back.body.project.archived, false);
  });

  it('holds a duplicate to the limit as well', async () => {
    const w = world();
    const made = [];
    for (let n = 0; n < 3; n += 1) made.push(await create(w, ALICE));
    const refused = await w.call(
      ALICE,
      'POST',
      `/api/projects/${made[0]!.id}/duplicate`,
      {},
    );
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'project-limit');
    assert.equal(
      await count(w.db, `SELECT COUNT(*) AS n FROM projects`),
      3,
      'a refused copy left a project behind',
    );
  });
});

describe('what a project remembers', () => {
  it('keeps its settings and its conversation, and gives them back on opening', async () => {
    const w = world();
    const made = await create(w, ALICE, {
      settings: { model: 'no-such-model', knowledge: 'Keep it dark.' },
    });
    const transcript = [
      turn(),
      turn({
        id: 2,
        runId: 'chat-1',
        status: 'replied',
        agentMessage: 'Would you like a menu page?',
        summary: null,
        fileCount: 0,
        revision: null,
      }),
    ];
    const saved = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      settings: {
        style: 'brutalism',
        referenceUrl: 'https://example.com/',
        styleDna: { corners: 'sharp', nonsense: 'x' },
      },
      transcript,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.project.turns, 2);

    // In R2, beside the code, not in the row.
    assert.ok(
      w.bucket
        .keys()
        .some((key) => key.startsWith(`projects/${made.id}/transcript-`)),
    );

    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.deepEqual(opened.body.transcript, transcript);
    const settings = opened.body.project.settings;
    // An unknown model is dropped rather than refusing the whole save; a
    // field left out of a PATCH is left as it was.
    assert.equal(settings.model, null);
    assert.equal(settings.knowledge, 'Keep it dark.');
    assert.equal(settings.referenceUrl, 'https://example.com/');
    assert.equal(settings.style, 'brutalism');
    assert.deepEqual(settings.styleDna, { corners: 'sharp' });

    // A preset renamed since the builder saved costs that one choice.
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      settings: { style: 'no-longer-a-preset' },
    });
    const later = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(later.body.project.settings.style, null);
    assert.equal(later.body.project.settings.knowledge, 'Keep it dark.');
  });

  it('refuses a malformed conversation rather than saving part of it', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const refused = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      transcript: [turn(), { id: 2, prompt: 'no status' }],
    });
    assert.equal(refused.status, 400);
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.deepEqual(opened.body.transcript, []);
  });

  it('holds standing instructions to the bound a build holds them to', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const refused = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      settings: { knowledge: 'x'.repeat(10_000) },
    });
    assert.equal(refused.status, 413);
  });

  it('renames, keeping a name on one line, and refuses a blank one', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const renamed = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      name: '  Corner\nbakery ',
    });
    assert.equal(renamed.body.project.name, 'Corner bakery');
    const blank = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      name: '   ',
    });
    assert.equal(blank.status, 400);
  });

  it('orders the list by when each project was last opened', async () => {
    const w = world();
    const a = await create(w, ALICE, { name: 'A' });
    w.clock.now = new Date('2026-09-28T13:00:00.000Z');
    await create(w, ALICE, { name: 'B' });
    w.clock.now = new Date('2026-09-28T14:00:00.000Z');
    await w.call(ALICE, 'GET', `/api/projects/${a.id}`);
    const listed = await w.call(ALICE, 'GET', '/api/projects');
    assert.deepEqual(
      listed.body.projects.map((p: any) => p.name),
      ['A', 'B'],
    );
  });

  it('shows the later of a save and a build as when it was last edited', async () => {
    const w = world();
    const made = await create(w, ALICE);
    await build(w, made.id);
    const listed = await w.call(ALICE, 'GET', '/api/projects');
    const project = listed.body.projects[0];
    assert.equal(project.hasCode, true);
    assert.ok(project.editedAt >= project.createdAt);
  });
});

describe('two tabs on one project (D63)', () => {
  const WRITER_A = '0b6f3c1e-0000-4000-8000-00000000000a';
  const WRITER_B = '0b6f3c1e-0000-4000-8000-00000000000b';

  function transcriptObjects(w: World, id: string): string[] {
    return w.bucket
      .keys()
      .filter((key) => key.startsWith(`projects/${id}/transcript`));
  }

  it('gives the version on opening and on every save', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(opened.body.project.version, 0);
    const saved = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      transcript: [turn()],
      version: 0,
      writer: WRITER_A,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.project.version, 1);
  });

  it('refuses a save made from an older version, and writes nothing of it', async () => {
    const w = world();
    const made = await create(w, ALICE);
    // Both tabs open the project at version 0; tab B saves first.
    const first = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      settings: { style: 'brutalism' },
      transcript: [turn()],
      version: 0,
      writer: WRITER_B,
    });
    assert.equal(first.body.project.version, 1);

    const stale = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      name: 'From tab A',
      settings: { style: 'editorial' },
      transcript: [turn({ prompt: 'Tab A wrote this' })],
      version: 0,
      writer: WRITER_A,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'project-changed');
    assert.equal(stale.body.error, 'This project changed in another tab.');
    assert.equal(stale.body.version, 1);

    // Tab B's conversation, settings and version are as tab B left them,
    // and the refused save left no object behind.
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.deepEqual(opened.body.transcript, [turn()]);
    assert.equal(opened.body.project.settings.style, 'brutalism');
    assert.equal(opened.body.project.version, 1);
    assert.equal(opened.body.project.name, made.name);
    assert.equal(transcriptObjects(w, made.id).length, 1);
  });

  it("lets one tab's saves follow each other, each from the version the last one gave", async () => {
    const w = world();
    const made = await create(w, ALICE);
    let version = 0;
    for (let n = 1; n <= 3; n += 1) {
      const saved = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
        transcript: Array.from({ length: n }, (_, i) => turn({ id: i + 1 })),
        version,
        writer: WRITER_A,
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      version = saved.body.project.version;
    }
    assert.equal(version, 3);
    // Each save replaced the object the one before it wrote.
    assert.equal(transcriptObjects(w, made.id).length, 1);
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(opened.body.transcript.length, 3);
  });

  it('accepts a retry of a save that landed but whose answer was lost, until another tab saves', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const body = { transcript: [turn()], version: 0, writer: WRITER_A };
    const landed = await w.call(
      ALICE,
      'PATCH',
      `/api/projects/${made.id}`,
      body,
    );
    assert.equal(landed.status, 200);
    // The page never heard back, so it still holds version 0.
    const retried = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      ...body,
      transcript: [turn(), turn({ id: 2 })],
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.project.version, 2);

    // Another tab saves; the first page's stale version is now refused.
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      settings: { model: null },
      version: 2,
      writer: WRITER_B,
    });
    const refused = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      ...body,
      transcript: [turn({ prompt: 'too late' })],
    });
    assert.equal(refused.status, 409);
  });

  it('does not count a rename, an archive or a build as a change to the content', async () => {
    const w = world();
    const made = await create(w, ALICE);
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      name: 'Renamed in tab B',
    });
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      archived: true,
    });
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      archived: false,
    });
    // A build promotes into `generation_projects`, never this row.
    await build(w, made.id, 'r1');
    await build(w, made.id, 'r2');
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(opened.body.project.version, 0);
    assert.equal(opened.body.snapshot.revision, 'r2');

    const saved = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      transcript: [turn()],
      version: 0,
      writer: WRITER_A,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    // A rename carrying a stale version is not refused either: it
    // overwrites nothing another tab saved.
    const renamed = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      name: 'Renamed in tab C',
      version: 0,
      writer: WRITER_B,
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.project.name, 'Renamed in tab C');
  });

  it('lets a builder older than versions save as it always did, and moves the version for everyone else', async () => {
    const w = world();
    const made = await create(w, ALICE);
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      transcript: [turn()],
      version: 0,
      writer: WRITER_A,
    });
    // No version: the last write wins, whatever came before it.
    const old = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      transcript: [turn({ prompt: 'From an old tab' })],
    });
    assert.equal(old.status, 200);
    assert.equal(old.body.project.version, 2);
    // And the newer tab, still at 1, is told rather than overwriting it.
    const refused = await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      transcript: [turn({ prompt: 'From tab A' })],
      version: 1,
      writer: WRITER_A,
    });
    assert.equal(refused.status, 409);
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(opened.body.transcript[0].prompt, 'From an old tab');
  });

  it('lets exactly one of two saves racing from the same version win', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const store = new ProjectStore(w.db, w.bucket);
    const now = w.clock.now.toISOString();
    const outcomes = await Promise.all([
      store.saveContent(
        ALICE,
        made.id,
        { transcript: [turn({ prompt: 'A' })] },
        now,
        { version: 0, writer: WRITER_A },
      ),
      store.saveContent(
        ALICE,
        made.id,
        { transcript: [turn({ prompt: 'B' })] },
        now,
        { version: 0, writer: WRITER_B },
      ),
    ]);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), [
      'changed',
      'saved',
    ]);
    const winner = outcomes[0]!.outcome === 'saved' ? 'A' : 'B';
    const opened = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(opened.body.transcript[0].prompt, winner);
    assert.equal(opened.body.project.version, 1);
    assert.equal(transcriptObjects(w, made.id).length, 1);
  });

  it('refuses a version or a writer that is not one', async () => {
    const w = world();
    const made = await create(w, ALICE);
    for (const body of [
      { transcript: [], version: -1 },
      { transcript: [], version: 1.5 },
      { transcript: [], version: '0' },
      { transcript: [], version: 0, writer: 'not a/page id' },
    ]) {
      const refused = await w.call(
        ALICE,
        'PATCH',
        `/api/projects/${made.id}`,
        body,
      );
      assert.equal(refused.status, 400, JSON.stringify(body));
    }
  });
});

describe('deleting a project', () => {
  it('removes its code, its conversation and its rows, and nothing of anyone else', async () => {
    const w = world();
    const doomed = await create(w, ALICE);
    const kept = await create(w, ALICE);
    await build(w, doomed.id, 'r1');
    await build(w, kept.id, 'r1');
    await w.call(ALICE, 'PATCH', `/api/projects/${doomed.id}`, {
      transcript: [turn()],
    });
    await w.db
      .prepare(
        `INSERT INTO generation_run_traces
           VALUES ('trace-1', ?1, 'applied', 'm', 1, 0, 1, 100, 5, 10, ?2)`,
      )
      .bind(doomed.id, '2026-09-28T12:00:00.000Z')
      .run();

    const deleted = await w.call(ALICE, 'DELETE', `/api/projects/${doomed.id}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { deleted: true });

    assert.deepEqual(
      w.bucket.keys().filter((key) => key.includes(doomed.id)),
      [],
    );
    assert.ok(
      w.bucket.keys().some((key) => key.startsWith(`projects/${kept.id}/`)),
    );
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
          doomed.id,
        ),
        0,
        table,
      );
    }
    assert.equal(
      (await w.call(ALICE, 'GET', `/api/projects/${doomed.id}`)).status,
      404,
    );
  });

  it('waits for a build that is still running in it', async () => {
    // Deleting under a run would let the run recreate the project's rows
    // with no owner, and its code would then outlive the account itself.
    const w = world();
    const busy = await create(w, ALICE);
    await new D1GenerationStore(w.db, w.bucket).saveStage({
      runId: 'run-live',
      projectId: busy.id,
      baseRevision: null,
      state: 'planning',
    });
    w.clock.now = new Date(Date.now());
    const refused = await w.call(ALICE, 'DELETE', `/api/projects/${busy.id}`);
    assert.equal(refused.status, 409);

    // A run that stopped between steps and never came back does not hold
    // the project for ever.
    w.clock.now = new Date(Date.now() + 31 * 60_000);
    const deleted = await w.call(ALICE, 'DELETE', `/api/projects/${busy.id}`);
    assert.equal(deleted.status, 200);
  });
});

describe('duplicating a project', () => {
  it('copies the accepted code, the settings and the conversation into a new project', async () => {
    const w = world();
    const source = await create(w, ALICE, {
      name: 'Bakery',
      settings: { knowledge: 'Warm colours.' },
    });
    const snapshot = await build(w, source.id, 'r3');
    await w.call(ALICE, 'PATCH', `/api/projects/${source.id}`, {
      transcript: [turn({ revision: 'r3' })],
    });

    const copied = await w.call(
      ALICE,
      'POST',
      `/api/projects/${source.id}/duplicate`,
      {},
    );
    assert.equal(copied.status, 201);
    const copy = copied.body.project;
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.name, 'Bakery (copy)');
    assert.equal(copy.hasCode, true);

    const opened = await w.call(ALICE, 'GET', `/api/projects/${copy.id}`);
    assert.deepEqual(opened.body.snapshot, snapshot);
    assert.deepEqual(opened.body.transcript, [turn({ revision: 'r3' })]);
    assert.equal(opened.body.project.settings.knowledge, 'Warm colours.');

    // A copy is its own project: building in it later cannot move the
    // original, because it has its own accepted pointer.
    await build(w, copy.id, 'r4');
    const original = await w.call(ALICE, 'GET', `/api/projects/${source.id}`);
    assert.equal(original.body.snapshot.revision, 'r3');
  });

  it('copies a project nobody has built in yet as an empty one', async () => {
    const w = world();
    const source = await create(w, ALICE, { name: 'Empty' });
    const copied = await w.call(
      ALICE,
      'POST',
      `/api/projects/${source.id}/duplicate`,
      {},
    );
    assert.equal(copied.status, 201);
    assert.equal(copied.body.project.hasCode, false);
  });
});

describe('the project a run builds in', () => {
  const options = (create: boolean, allowArchived = false) => {
    let ids = 0;
    return {
      create,
      allowArchived,
      newId: () => `fallback-${(ids += 1)}`,
      now: () => '2026-09-28T12:00:00.000Z',
      name: 'Untitled project',
    };
  };

  it('is the one the builder names, when it is the caller’s', async () => {
    const w = world();
    const store = new ProjectStore(w.db, w.bucket);
    const mine = await create(w, ALICE);
    assert.deepEqual(
      await resolveRunProject(store, ALICE, mine.id, options(true)),
      { ok: true, projectId: mine.id },
    );
    const theirs = await resolveRunProject(store, BOB, mine.id, options(true));
    assert.equal(theirs.ok, false);
    assert.equal(!theirs.ok && theirs.status, 404);
  });

  it('refuses an archived project for a run, and allows reading its history', async () => {
    const w = world();
    const store = new ProjectStore(w.db, w.bucket);
    const made = await create(w, ALICE);
    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      archived: true,
    });
    const run = await resolveRunProject(store, ALICE, made.id, options(true));
    assert.equal(!run.ok && run.status, 409);
    assert.deepEqual(
      await resolveRunProject(store, ALICE, made.id, options(false, true)),
      { ok: true, projectId: made.id },
    );
  });

  it('falls back, for a builder that names none, to the most recently opened', async () => {
    // An old tab, open across the deploy: it keeps building in what it
    // was showing, which for somebody who built before projects is the
    // backfilled one.
    const w = world();
    const store = new ProjectStore(w.db, w.bucket);
    const older = await create(w, ALICE);
    w.clock.now = new Date('2026-09-28T13:00:00.000Z');
    await create(w, ALICE);
    w.clock.now = new Date('2026-09-28T14:00:00.000Z');
    await w.call(ALICE, 'GET', `/api/projects/${older.id}`);
    assert.deepEqual(
      await resolveRunProject(store, ALICE, null, options(true)),
      {
        ok: true,
        projectId: older.id,
      },
    );
  });

  it('makes one for an account that has none, and only when a run needs it', async () => {
    const w = world();
    const store = new ProjectStore(w.db, w.bucket);
    assert.deepEqual(
      await resolveRunProject(store, ALICE, null, options(false)),
      { ok: true, projectId: null },
    );
    assert.equal(await count(w.db, `SELECT COUNT(*) AS n FROM projects`), 0);

    const made = await resolveRunProject(store, ALICE, null, options(true));
    assert.deepEqual(made, { ok: true, projectId: 'fallback-1' });
    const listed = await w.call(ALICE, 'GET', '/api/projects');
    assert.deepEqual(
      listed.body.projects.map((p: any) => [p.id, p.name]),
      [['fallback-1', 'Untitled project']],
    );
  });
});

describe('the routes themselves', () => {
  it('answers a method a route does not have with 405', async () => {
    const w = world();
    const made = await create(w, ALICE);
    assert.equal((await w.call(ALICE, 'PUT', '/api/projects')).status, 405);
    assert.equal(
      (await w.call(ALICE, 'GET', `/api/projects/${made.id}/duplicate`)).status,
      405,
    );
  });

  it('is unavailable, not open, without storage', async () => {
    const response = await handleProjects(
      new Request(`${ORIGIN}/api/projects`),
      {},
      {
        resolvePrincipal: async () =>
          ({ denied: null, principal: { userId: ALICE } }) as PrincipalGranted,
      },
    );
    assert.equal(response.status, 503);
  });
});

describe('the difference between unset and cleared', () => {
  it('keeps an emptied preference as empty, so the browser default does not come back', async () => {
    const w = world();
    const made = await create(w, ALICE);
    const fresh = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(fresh.body.project.settings.knowledge, null);
    assert.equal(fresh.body.project.settings.styleDna, null);

    await w.call(ALICE, 'PATCH', `/api/projects/${made.id}`, {
      settings: { knowledge: '   ', styleDna: {} },
    });
    const cleared = await w.call(ALICE, 'GET', `/api/projects/${made.id}`);
    assert.equal(cleared.body.project.settings.knowledge, '');
    assert.deepEqual(cleared.body.project.settings.styleDna, {});
  });
});
