import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleProjects } from '../worker/project-handlers.ts';
import type { ProjectsDeps } from '../worker/project-handlers.ts';
import { ProjectStore, resolveSiteProject } from '../worker/project-store.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql, schemaSqlBetween } from './fakes/schema.ts';

/**
 * One published site per project (docs/decisions.md, "Resolved
 * 2026-09-28"), from apps/web's side: which project a publish or a takedown
 * is about, what a project says about its site, that the sites published
 * before this keep their addresses, and that deleting a project takes its
 * site down first. That publishing one project cannot touch another's site
 * is the publish service's to keep, and is tested there
 * (`apps/publish/test/site-per-project.test.ts`).
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const BOB = 'user_bob0000000000000000000002';
const AT = '2026-09-01T00:00:00.000Z';

async function exec(db: SqliteD1Database, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

/** A site, as the publish service leaves the row. */
async function site(
  db: SqliteD1Database,
  slug: string,
  projectId: string,
  userId: string,
  state: 'live' | 'down' | 'held' = 'live',
) {
  await exec(
    db,
    `INSERT INTO published_projects
       (slug, project_id, user_id, created_at, updated_at, generation,
        unpublished_at, held_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)`,
    slug,
    projectId,
    userId,
    AT,
    state === 'down' ? null : 'g1',
    state === 'down' ? AT : null,
    state === 'held' ? AT : null,
  );
}

function call(
  db: SqliteD1Database,
  user: string,
  method: string,
  path: string,
  extra: Partial<ProjectsDeps> = {},
) {
  let ids = 0;
  return handleProjects(
    new Request(`${ORIGIN}${path}`, { method }),
    { DB: db, PROJECT_CONTENT: new InMemoryR2Bucket() },
    {
      resolvePrincipal: async () =>
        ({ denied: null, principal: { userId: user } }) as PrincipalGranted,
      newId: () => `project-${(ids += 1)}`,
      links: { origin: ORIGIN, publishHostname: 'vibld-preview.dev' },
      ...extra,
    },
  ).then(async (response) => ({
    status: response.status,
    body: (await response.json()) as Record<string, any>,
  }));
}

describe('the sites published before one per project', () => {
  it('stay at their addresses, as the site of the project each account already has', async () => {
    // The database as it stood before projects: one project per account,
    // keyed by user id, and the account's one site keyed the same way.
    const db = new SqliteD1Database(schemaSqlBetween('', '0033'));
    await exec(
      db,
      `INSERT INTO generation_projects VALUES (?1, 'r1', ?2, ?2)`,
      ALICE,
      AT,
    );
    await site(db, 'alices-bakery', ALICE, ALICE);

    db.exec(schemaSqlBetween('0033', '￿'));

    const listed = await call(db, ALICE, 'GET', '/api/projects');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.projects.length, 1);
    assert.deepEqual(listed.body.projects[0].site, {
      slug: 'alices-bakery',
      state: 'live',
      url: 'https://alices-bakery.vibld-preview.dev/',
    });

    // The builder names that project, and an older builder names none:
    // both publish to the same site, so its address does not move.
    const store = new ProjectStore(db, new InMemoryR2Bucket());
    for (const named of [ALICE, undefined]) {
      assert.deepEqual(
        await resolveSiteProject(store, ALICE, named, {
          allowArchived: false,
        }),
        { ok: true, projectId: ALICE },
      );
    }
  });

  it('gives a site whose project was never made a project, so its owner can reach it', async () => {
    const db = new SqliteD1Database(schemaSqlBetween('', '0033'));
    // Published, with no build through the Worker: 0033 made no project.
    await site(db, 'bobs-garage', BOB, BOB);
    // A site the account purge already re-keyed to its tombstone belongs
    // to nobody, and must not grow a project.
    await site(db, 'gone-site', 'deleted-1:gone-site', 'deleted-1');

    db.exec(schemaSqlBetween('0033', '￿'));

    const listed = await call(db, BOB, 'GET', '/api/projects');
    assert.deepEqual(
      listed.body.projects.map((p: any) => [p.id, p.site?.slug]),
      [[BOB, 'bobs-garage']],
    );
    const orphans = await db
      .prepare(`SELECT COUNT(*) AS n FROM projects WHERE user_id = 'deleted-1'`)
      .first<{ n: number }>();
    assert.equal(orphans?.n, 0);
  });

  it('applies to an empty database without complaint', () => {
    assert.ok(new SqliteD1Database(schemaSql()));
  });
});

describe("a project's own site", () => {
  it('is reported with its state, the way the publish service reads it', async () => {
    const db = new SqliteD1Database(schemaSql());
    const store = new ProjectStore(db, new InMemoryR2Bucket());
    for (const [id, state] of [
      ['p-live', 'live'],
      ['p-down', 'down'],
      ['p-held', 'held'],
    ] as const) {
      await store.create(ALICE, { id, name: id, now: AT }, null);
      await site(db, `${id}-site`, id, ALICE, state);
    }
    await store.create(ALICE, { id: 'p-none', name: 'p-none', now: AT }, null);
    const listed = await call(db, ALICE, 'GET', '/api/projects');
    const byId = Object.fromEntries(
      listed.body.projects.map((p: any) => [p.id, p.site?.state ?? null]),
    );
    assert.deepEqual(byId, {
      'p-live': 'live',
      'p-down': 'down',
      'p-held': 'held',
      'p-none': null,
    });
  });

  it("is only ever the caller's own project's", async () => {
    const db = new SqliteD1Database(schemaSql());
    const store = new ProjectStore(db, new InMemoryR2Bucket());
    await store.create(ALICE, { id: 'alices', name: 'A', now: AT }, null);
    await store.create(BOB, { id: 'bobs', name: 'B', now: AT }, null);

    assert.deepEqual(
      await resolveSiteProject(store, ALICE, 'alices', {
        allowArchived: false,
      }),
      { ok: true, projectId: 'alices' },
    );
    const theirs = await resolveSiteProject(store, ALICE, 'bobs', {
      allowArchived: true,
    });
    assert.equal(theirs.ok, false);
    assert.equal(!theirs.ok && theirs.status, 404);
    const malformed = await resolveSiteProject(store, ALICE, '../x', {
      allowArchived: true,
    });
    assert.equal(!malformed.ok && malformed.status, 400);
  });

  it('cannot be published from an archived project, and can still be taken down', async () => {
    const db = new SqliteD1Database(schemaSql());
    const store = new ProjectStore(db, new InMemoryR2Bucket());
    await store.create(ALICE, { id: 'shelved', name: 'S', now: AT }, null);
    await store.archive(ALICE, 'shelved', AT);
    const publish = await resolveSiteProject(store, ALICE, 'shelved', {
      allowArchived: false,
    });
    assert.equal(!publish.ok && publish.status, 409);
    assert.deepEqual(
      await resolveSiteProject(store, ALICE, 'shelved', {
        allowArchived: true,
      }),
      { ok: true, projectId: 'shelved' },
    );
  });

  it("refuses an older builder's publish once the account's first project is gone", async () => {
    const db = new SqliteD1Database(schemaSql());
    const store = new ProjectStore(db, new InMemoryR2Bucket());
    const publish = await resolveSiteProject(store, ALICE, undefined, {
      allowArchived: false,
    });
    assert.equal(!publish.ok && publish.status, 400);
    // Its takedown still asks under the old key, and the publish service
    // answers for whatever is there.
    assert.deepEqual(
      await resolveSiteProject(store, ALICE, undefined, {
        allowArchived: true,
      }),
      { ok: true, projectId: ALICE },
    );
  });
});

describe('deleting a project', () => {
  async function withSite(state: 'live' | 'down' | 'held') {
    const db = new SqliteD1Database(schemaSql());
    const store = new ProjectStore(db, new InMemoryR2Bucket());
    await store.create(ALICE, { id: 'doomed', name: 'D', now: AT }, null);
    await store.create(ALICE, { id: 'kept', name: 'K', now: AT }, null);
    await site(db, 'doomed-site', 'doomed', ALICE, state);
    await site(db, 'kept-site', 'kept', ALICE, 'live');
    return db;
  }

  async function stateOf(db: SqliteD1Database, slug: string) {
    return db
      .prepare(
        `SELECT project_id, unpublished_at, generation FROM published_projects
          WHERE slug = ?1`,
      )
      .bind(slug)
      .first<{
        project_id: string;
        unpublished_at: string | null;
        generation: string | null;
      }>();
  }

  it('takes its site down first, and only its own', async () => {
    const db = await withSite('live');
    const asked: string[] = [];
    const deleted = await call(db, ALICE, 'DELETE', '/api/projects/doomed', {
      // The router's takedown, which reaches the publish service; this
      // stands in for the service marking the site down.
      takeDownSite: async (projectId) => {
        asked.push(projectId);
        await exec(
          db,
          `UPDATE published_projects SET unpublished_at = ?1, generation = NULL
            WHERE project_id = ?2`,
          AT,
          projectId,
        );
      },
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepEqual(asked, ['doomed']);
    // The slug is never released (ADR-0010), and it no longer serves.
    const doomed = await stateOf(db, 'doomed-site');
    assert.equal(doomed?.generation, null);
    assert.notEqual(doomed?.unpublished_at, null);
    // The other project's site is exactly as it was.
    assert.equal((await stateOf(db, 'kept-site'))?.generation, 'g1');
  });

  it('is refused, and deletes nothing, when the site could not be taken down', async () => {
    const db = await withSite('live');
    const deleted = await call(db, ALICE, 'DELETE', '/api/projects/doomed', {
      takeDownSite: async () => {
        throw new Error('publish service unavailable');
      },
    });
    assert.equal(deleted.status, 409);
    assert.match(deleted.body.error, /doomed-site is still online/);
    const still = await call(db, ALICE, 'GET', '/api/projects/doomed');
    assert.equal(still.status, 200);
  });

  it('is refused where there is no way to take a live site down', async () => {
    const db = await withSite('live');
    const deleted = await call(db, ALICE, 'DELETE', '/api/projects/doomed');
    assert.equal(deleted.status, 409);
  });

  it('needs no takedown for a site that is not serving', async () => {
    for (const state of ['down', 'held'] as const) {
      const db = await withSite(state);
      const deleted = await call(db, ALICE, 'DELETE', '/api/projects/doomed', {
        takeDownSite: async () => {
          throw new Error(`asked to take a ${state} site down`);
        },
      });
      assert.equal(deleted.status, 200, state);
    }
  });

  it("disconnects the project's own domain, whatever its site's state (D189)", async () => {
    for (const state of ['live', 'down', 'held'] as const) {
      const db = await withSite(state);
      const asked: string[] = [];
      const deleted = await call(db, ALICE, 'DELETE', '/api/projects/doomed', {
        takeDownSite: async (projectId) => {
          await exec(
            db,
            `UPDATE published_projects SET unpublished_at = ?1, generation = NULL
              WHERE project_id = ?2`,
            AT,
            projectId,
          );
        },
        removeDomain: async (projectId) => {
          asked.push(projectId);
          return true;
        },
      });
      assert.equal(deleted.status, 200, state);
      // Before the project goes, and once more after, for a connect that
      // was already running.
      assert.deepEqual(asked, ['doomed', 'doomed'], state);
    }
  });

  it('is refused, and deletes nothing, when the domain could not be disconnected', async () => {
    const db = await withSite('down');
    const deleted = await call(db, ALICE, 'DELETE', '/api/projects/doomed', {
      removeDomain: async () => false,
    });
    assert.equal(deleted.status, 502);
    assert.match(deleted.body.error, /custom domain could not be disconnected/);
    const still = await call(db, ALICE, 'GET', '/api/projects/doomed');
    assert.equal(still.status, 200);
  });
});
