import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CustomDomainStore,
  dohResolveTxt,
  normalizeHostname,
  ownershipRecord,
  readCustomHostname,
} from '../worker/custom-domain.ts';
import {
  OWNERSHIP_CODE,
  PAID_PLAN_CODE,
  handleProjectDomain,
  removeProjectDomain,
  sweepLapsedDomains,
} from '../worker/domain-handlers.ts';
import type { DomainEnv } from '../worker/domain-handlers.ts';
import type { Tier } from '../worker/entitlement.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { ProjectStore } from '../worker/project-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { schemaSql } from './fakes/schema.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * A published site on its owner's own domain (docs/decisions.md D189),
 * against the real schema over SQLite and a Cloudflare that answers from
 * memory.
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const BOB = 'user_bob0000000000000000000002';

describe('the domain an owner types (D189)', () => {
  it('takes what people paste and keeps the hostname', () => {
    for (const [typed, hostname] of [
      ['www.example.com', 'www.example.com'],
      ['  WWW.Example.COM.  ', 'www.example.com'],
      ['https://shop.example.co.uk/path?x=1', 'shop.example.co.uk'],
      ['bäckerei.de', 'xn--bckerei-5wa.de'],
    ] as const) {
      assert.deepEqual(normalizeHostname(typed), { ok: true, hostname }, typed);
    }
  });

  it('refuses what is not a domain, and vibld’s own', () => {
    for (const typed of [
      '',
      'localhost',
      'example',
      '192.168.0.1',
      'www.example.com:8080',
      '-bad.example.com',
      'a..example.com',
      'user@example.com',
      'shop.vibld.com',
      'vibld-preview.dev',
      'acme.vibld-preview.dev',
      42,
    ]) {
      assert.equal(normalizeHostname(typed).ok, false, String(typed));
    }
  });
});

describe("Cloudflare's answer about a domain", () => {
  it('is live only when the hostname and its certificate both are', () => {
    const state = readCustomHostname({
      id: 'ch1',
      hostname: 'www.example.com',
      status: 'active',
      ssl: { status: 'pending_validation' },
    });
    assert.equal(state?.status, 'pending');
    assert.equal(
      readCustomHostname({
        id: 'ch1',
        hostname: 'www.example.com',
        status: 'active',
        ssl: { status: 'active' },
      })?.status,
      'active',
    );
  });

  it('lists the checks still open, and says what went wrong', () => {
    const state = readCustomHostname({
      id: 'ch1',
      hostname: 'www.example.com',
      status: 'pending',
      verification_errors: ['custom hostname does not CNAME to this zone.'],
      ownership_verification: {
        type: 'txt',
        name: '_cf-custom-hostname.www.example.com',
        value: 'abc',
      },
      ssl: {
        status: 'validation_timed_out',
        validation_records: [{ txt_name: '_acme', txt_value: 'xyz' }],
      },
    });
    assert.equal(state?.status, 'failed');
    assert.deepEqual(state?.records, [
      {
        type: 'TXT',
        name: '_cf-custom-hostname.www.example.com',
        value: 'abc',
      },
      { type: 'TXT', name: '_acme', value: 'xyz' },
    ]);
    assert.deepEqual(state?.errors, [
      'custom hostname does not CNAME to this zone.',
    ]);
  });
});

interface Cloudflare {
  hostnames: Map<string, { id: string; hostname: string }>;
  calls: { method: string; url: string }[];
  /** Answer every request with a 500, as an outage would. */
  down: boolean;
  /** Report every certificate's validation as timed out. */
  timedOut: boolean;
  fetch: typeof fetch;
}

function cloudflare(): Cloudflare {
  const hostnames = new Map<string, { id: string; hostname: string }>();
  const calls: { method: string; url: string }[] = [];
  let ids = 0;
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const view = (entry: { id: string; hostname: string }) => ({
    ...entry,
    status: 'pending',
    ssl: {
      status: state.timedOut ? 'validation_timed_out' : 'pending_validation',
    },
    ownership_verification: {
      type: 'txt',
      name: `_cf-custom-hostname.${entry.hostname}`,
      value: 'token',
    },
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (state.down) {
      return answer(
        { success: false, errors: [{ code: 1000, message: 'Internal' }] },
        500,
      );
    }
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer cf-token',
    );
    const id = url.match(/custom_hostnames\/([^/?]+)$/)?.[1];
    if (method === 'POST') {
      const { hostname } = JSON.parse(String(init?.body)) as {
        hostname: string;
      };
      if ([...hostnames.values()].some((h) => h.hostname === hostname)) {
        return answer(
          {
            success: false,
            errors: [
              { code: 1406, message: 'Duplicate custom hostname found.' },
            ],
          },
          409,
        );
      }
      const entry = { id: `ch${(ids += 1)}`, hostname };
      hostnames.set(entry.id, entry);
      return answer({ success: true, result: view(entry) });
    }
    const entry = id ? hostnames.get(id) : undefined;
    if (!entry) {
      return answer(
        { success: false, errors: [{ code: 1436, message: 'Not found' }] },
        404,
      );
    }
    if (method === 'DELETE') {
      hostnames.delete(entry.id);
      return answer({ success: true, result: { id: entry.id } });
    }
    return answer({ success: true, result: view(entry) });
  }) as typeof fetch;
  const state: Cloudflare = {
    hostnames,
    calls,
    down: false,
    timedOut: false,
    fetch: fetchImpl,
  };
  return state;
}

interface World {
  db: SqliteD1Database;
  env: DomainEnv;
  cf: Cloudflare;
  tiers: Map<string, Tier | null>;
  /** TXT records by name; null makes every lookup fail. */
  dns: Map<string, string[]> | null;
  /** Add the TXT record that proves `hostname` is `user`'s. */
  prove(user: string, hostname: string): Promise<void>;
  call(
    user: string,
    method: string,
    project: string,
    body?: unknown,
    query?: string,
  ): Promise<{ status: number; body: Record<string, any> }>;
}

async function world(options: { configured?: boolean } = {}): Promise<World> {
  const db = new SqliteD1Database(schemaSql());
  const bucket = new InMemoryR2Bucket();
  const store = new ProjectStore(
    db as unknown as D1Database,
    bucket as unknown as R2Bucket,
  );
  const now = '2026-10-10T12:00:00.000Z';
  for (const [user, id] of [
    [ALICE, 'project-a'],
    [ALICE, 'project-unpublished'],
    [BOB, 'project-b'],
  ] as const) {
    await store.create(user, { id, name: id, now }, null);
  }
  for (const [user, id, slug] of [
    [ALICE, 'project-a', 'bakery'],
    [BOB, 'project-b', 'florist'],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO published_projects
           (slug, project_id, user_id, created_at, updated_at, generation)
         VALUES (?1, ?2, ?3, ?4, ?4, 'g1')`,
      )
      .bind(slug, id, user, now)
      .run();
  }
  const cf = cloudflare();
  const tiers = new Map<string, Tier | null>([
    [ALICE, 'build'],
    [BOB, 'free'],
  ]);
  const env: DomainEnv = {
    DB: db as unknown as D1Database,
    PROJECT_CONTENT: bucket as unknown as R2Bucket,
    ...(options.configured === false
      ? {}
      : {
          CUSTOM_HOSTNAME_ZONE_ID: 'zone-1',
          CUSTOM_HOSTNAME_API_TOKEN: 'cf-token',
        }),
  };
  const w: World = {
    db,
    env,
    cf,
    tiers,
    dns: new Map(),
    async prove(user, hostname) {
      const record = await ownershipRecord(user, hostname);
      const values = w.dns?.get(record.name) ?? [];
      w.dns?.set(record.name, [...values, record.value]);
    },
    async call(user, method, project, body, query = '') {
      const response = await handleProjectDomain(
        new Request(`${ORIGIN}/api/projects/${project}/domain${query}`, {
          method,
          headers: {
            origin: ORIGIN,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
        {
          resolvePrincipal: async () =>
            ({
              denied: null,
              principal: { userId: user, policyIdentity: user },
            }) as PrincipalGranted,
          tierOf: async (who) => tiers.get(who) ?? null,
          fetchImpl: cf.fetch,
          resolveTxt: async (name) =>
            w.dns === null ? null : (w.dns.get(name) ?? []),
          now: () => new Date(now),
        },
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
  };
  return w;
}

async function slugFor(db: SqliteD1Database, hostname: string) {
  return db
    .prepare(
      `SELECT s.slug FROM custom_domains AS d
         JOIN published_projects AS s ON s.project_id = d.project_id
        WHERE d.hostname = ?1`,
    )
    .bind(hostname)
    .first<{ slug: string }>();
}

describe('a published site on its own domain (D189)', () => {
  it('offers nothing where the deployment has no custom domains', async () => {
    const w = await world({ configured: false });
    const got = await w.call(ALICE, 'GET', 'project-a');
    assert.equal(got.status, 200);
    assert.equal(got.body.configured, false);
    const post = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'www.bakery.com',
    });
    assert.equal(post.status, 503);
    assert.equal(w.cf.calls.length, 0);
  });

  it('connects a domain, lists the records, and serves the site there', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    const made = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'WWW.Bakery.com',
    });
    assert.equal(made.status, 201);
    assert.equal(made.body.domain.hostname, 'www.bakery.com');
    assert.equal(made.body.domain.status, 'pending');
    assert.deepEqual(made.body.domain.records[0], {
      type: 'CNAME',
      name: 'www.bakery.com',
      value: 'domains.vibld-preview.dev',
    });
    assert.equal((await slugFor(w.db, 'www.bakery.com'))?.slug, 'bakery');

    const read = await w.call(ALICE, 'GET', 'project-a');
    assert.equal(read.body.eligible, true);
    assert.equal(read.body.domain.hostname, 'www.bakery.com');
  });

  it('keeps the Free plan to the vibld address', async () => {
    const w = await world();
    const refused = await w.call(BOB, 'POST', 'project-b', {
      hostname: 'www.florist.com',
    });
    assert.equal(refused.status, 402);
    assert.equal(refused.body.code, PAID_PLAN_CODE);
    assert.equal((await w.call(BOB, 'GET', 'project-b')).body.eligible, false);
    assert.equal(w.cf.calls.length, 0);
  });

  it('lets every account connect one where no plans are sold', async () => {
    const w = await world();
    w.tiers.set(BOB, null);
    await w.prove(BOB, 'www.florist.com');
    const made = await w.call(BOB, 'POST', 'project-b', {
      hostname: 'www.florist.com',
    });
    assert.equal(made.status, 201);
  });

  it("refuses somebody else's project, and one not published", async () => {
    const w = await world();
    assert.equal(
      (await w.call(BOB, 'POST', 'project-a', { hostname: 'www.x.com' }))
        .status,
      404,
    );
    assert.equal(
      (
        await w.call(ALICE, 'POST', 'project-unpublished', {
          hostname: 'www.x.com',
        })
      ).status,
      409,
    );
    assert.equal(w.cf.calls.length, 0);
  });

  it('gives a domain to one site and a site one domain', async () => {
    const w = await world();
    w.tiers.set(BOB, 'ship');
    await w.prove(ALICE, 'www.bakery.com');
    await w.prove(BOB, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const second = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'shop.bakery.com',
    });
    assert.equal(second.status, 409);
    const taken = await w.call(BOB, 'POST', 'project-b', {
      hostname: 'www.bakery.com',
    });
    assert.equal(taken.status, 409);
    assert.equal(w.cf.hostnames.size, 1);
  });

  it('asks for proof the domain is the account’s before registering it', async () => {
    const w = await world();
    const asked = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'www.bakery.com',
    });
    assert.equal(asked.status, 409);
    assert.equal(asked.body.code, OWNERSHIP_CODE);
    assert.deepEqual(
      asked.body.record,
      await ownershipRecord(ALICE, 'www.bakery.com'),
    );
    assert.equal(asked.body.record.name, '_vibld.www.bakery.com');
    assert.equal(w.cf.calls.length, 0);
    assert.equal(await slugFor(w.db, 'www.bakery.com'), null);

    await w.prove(ALICE, 'www.bakery.com');
    const made = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'www.bakery.com',
    });
    assert.equal(made.status, 201);
  });

  it("does not take another account's proof for the same domain", async () => {
    const w = await world();
    w.tiers.set(BOB, 'ship');
    await w.prove(ALICE, 'www.bakery.com');
    const refused = await w.call(BOB, 'POST', 'project-b', {
      hostname: 'www.bakery.com',
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, OWNERSHIP_CODE);
    assert.equal(w.cf.calls.length, 0);
  });

  it('says so when DNS could not be checked', async () => {
    const w = await world();
    w.dns = null;
    const failed = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'www.bakery.com',
    });
    assert.equal(failed.status, 502);
    assert.equal(w.cf.calls.length, 0);
  });

  it('removes the hostname it made when its row could not be written', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    // D1 failing the write, and only the write.
    await w.db
      .prepare(
        `CREATE TRIGGER custom_domains_down BEFORE INSERT ON custom_domains
         BEGIN SELECT RAISE(ABORT, 'D1 is unavailable'); END`,
      )
      .run();
    const failed = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'www.bakery.com',
    });
    assert.equal(failed.status, 502);
    assert.equal(w.cf.hostnames.size, 0);
  });

  it('records no domain for a project deleted while Cloudflare was asked', async () => {
    const w = await world();
    await w.db.prepare(`DELETE FROM projects WHERE id = 'project-a'`).run();
    const added = await new CustomDomainStore(
      w.db as unknown as D1Database,
    ).add(
      {
        hostname: 'www.bakery.com',
        projectId: 'project-a',
        userId: ALICE,
        cloudflareId: 'ch1',
      },
      '2026-10-10T12:00:00.000Z',
    );
    assert.equal(added, false);
    assert.equal(await slugFor(w.db, 'www.bakery.com'), null);
  });

  it('refuses a domain that is not one, before Cloudflare is asked', async () => {
    const w = await world();
    const refused = await w.call(ALICE, 'POST', 'project-a', {
      hostname: 'shop.vibld.com',
    });
    assert.equal(refused.status, 400);
    assert.equal(w.cf.calls.length, 0);
  });

  it('refuses a cross-site write', async () => {
    const w = await world();
    const response = await handleProjectDomain(
      new Request(`${ORIGIN}/api/projects/project-a/domain`, {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      }),
      w.env,
      {
        resolvePrincipal: async () => {
          throw new Error('identity was asked before the origin');
        },
        tierOf: async () => 'build',
      },
    );
    assert.equal(response.status, 403);
  });

  it('asks Cloudflare to validate a pending domain again on "Check again"', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const patches = () =>
      w.cf.calls.filter((call) => call.method === 'PATCH').length;
    await w.call(ALICE, 'GET', 'project-a');
    assert.equal(patches(), 0, 'an ordinary load only reads');
    const checked = await w.call(
      ALICE,
      'GET',
      'project-a',
      undefined,
      '?recheck=1',
    );
    assert.equal(checked.status, 200);
    assert.equal(checked.body.domain.status, 'pending');
    assert.equal(patches(), 1);

    // And one whose validation timed out before the CNAME was added.
    w.cf.timedOut = true;
    const timedOut = await w.call(
      ALICE,
      'GET',
      'project-a',
      undefined,
      '?recheck=1',
    );
    assert.equal(timedOut.body.domain.status, 'failed');
    assert.equal(patches(), 2);
  });

  it('disconnects a domain, here and at Cloudflare', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const removed = await w.call(ALICE, 'DELETE', 'project-a');
    assert.equal(removed.status, 200);
    assert.equal(w.cf.hostnames.size, 0);
    assert.equal(await slugFor(w.db, 'www.bakery.com'), null);
    assert.equal((await w.call(ALICE, 'GET', 'project-a')).body.domain, null);
    assert.equal((await w.call(ALICE, 'DELETE', 'project-a')).status, 404);
  });

  it("goes with the project's deletion", async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    assert.equal(
      await removeProjectDomain(w.env, 'project-a', w.cf.fetch),
      true,
    );
    assert.equal(w.cf.hostnames.size, 0);
    assert.equal(await slugFor(w.db, 'www.bakery.com'), null);
    assert.equal(
      await removeProjectDomain(w.env, 'project-a', w.cf.fetch),
      true,
      'nothing left to remove',
    );
  });

  it('keeps the row when Cloudflare could not remove the hostname', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    w.cf.down = true;
    assert.equal(
      await removeProjectDomain(w.env, 'project-a', w.cf.fetch),
      false,
    );
    assert.equal((await slugFor(w.db, 'www.bakery.com'))?.slug, 'bakery');
    w.cf.down = false;
    assert.equal(
      await removeProjectDomain(w.env, 'project-a', w.cf.fetch),
      true,
    );
    assert.equal(w.cf.hostnames.size, 0);
  });

  it('keeps the row, and the project, where the token was taken off', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const { CUSTOM_HOSTNAME_API_TOKEN: _token, ...untokened } = w.env;
    assert.equal(
      await removeProjectDomain(untokened, 'project-a', w.cf.fetch),
      false,
    );
    assert.equal((await slugFor(w.db, 'www.bakery.com'))?.slug, 'bakery');
    assert.equal(w.cf.hostnames.size, 1);
    assert.equal(
      await removeProjectDomain(untokened, 'project-b', w.cf.fetch),
      true,
      'a project with no domain is not held',
    );
  });
});

describe('the nightly plan check (D189)', () => {
  it('disconnects the domain of an account whose plan reads Free', async () => {
    const w = await world();
    w.tiers.set(BOB, 'ship');
    await w.prove(ALICE, 'www.bakery.com');
    await w.prove(BOB, 'www.florist.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    await w.call(BOB, 'POST', 'project-b', { hostname: 'www.florist.com' });
    w.tiers.set(BOB, 'free');
    const swept = await sweepLapsedDomains(w.env, {
      tierOf: async (who) => w.tiers.get(who) ?? null,
      fetchImpl: w.cf.fetch,
    });
    assert.deepEqual(swept, { checked: 2, removed: 1, failed: 0 });
    assert.equal(await slugFor(w.db, 'www.florist.com'), null);
    assert.equal((await slugFor(w.db, 'www.bakery.com'))?.slug, 'bakery');
    assert.deepEqual(
      [...w.cf.hostnames.values()].map((entry) => entry.hostname),
      ['www.bakery.com'],
    );
  });

  it('removes a domain whose project is gone, whatever the plan', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    await w.db.prepare(`DELETE FROM projects WHERE id = 'project-a'`).run();
    const swept = await sweepLapsedDomains(w.env, {
      tierOf: async () => null,
      fetchImpl: w.cf.fetch,
    });
    assert.deepEqual(swept, { checked: 1, removed: 1, failed: 0 });
    assert.equal(w.cf.hostnames.size, 0);
  });

  it('drops only the row for the hostname it removed', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const store = new CustomDomainStore(w.db as unknown as D1Database);
    await store.remove('project-a', 'ch-an-older-one');
    assert.equal((await slugFor(w.db, 'www.bakery.com'))?.slug, 'bakery');
  });

  it('keeps every domain where no plans are sold', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const swept = await sweepLapsedDomains(w.env, {
      tierOf: async () => null,
      fetchImpl: w.cf.fetch,
    });
    assert.equal(swept.removed, 0);
    assert.equal(w.cf.hostnames.size, 1);
  });

  it('keeps the row when Cloudflare fails, and looks at others first next', async () => {
    const w = await world();
    w.tiers.set(BOB, 'ship');
    await w.prove(ALICE, 'www.bakery.com');
    await w.prove(BOB, 'www.florist.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    await w.call(BOB, 'POST', 'project-b', { hostname: 'www.florist.com' });
    w.tiers.set(ALICE, 'free');
    w.cf.down = true;
    const first = await sweepLapsedDomains(
      w.env,
      {
        tierOf: async (who) => w.tiers.get(who) ?? null,
        fetchImpl: w.cf.fetch,
        now: () => new Date('2026-10-11T09:47:00.000Z'),
      },
      1,
    );
    assert.deepEqual(first, { checked: 1, removed: 0, failed: 1 });
    assert.equal((await slugFor(w.db, 'www.bakery.com'))?.slug, 'bakery');
    // The failed one waits behind the one not checked since it connected.
    w.cf.down = false;
    const second = await sweepLapsedDomains(
      w.env,
      {
        tierOf: async (who) => w.tiers.get(who) ?? null,
        fetchImpl: w.cf.fetch,
        now: () => new Date('2026-10-12T09:47:00.000Z'),
      },
      1,
    );
    assert.deepEqual(second, { checked: 1, removed: 0, failed: 0 });
    const third = await sweepLapsedDomains(
      w.env,
      {
        tierOf: async (who) => w.tiers.get(who) ?? null,
        fetchImpl: w.cf.fetch,
        now: () => new Date('2026-10-13T09:47:00.000Z'),
      },
      1,
    );
    assert.deepEqual(third, { checked: 1, removed: 1, failed: 0 });
    assert.equal(await slugFor(w.db, 'www.bakery.com'), null);
  });
});

describe('the order the nightly plan check takes domains in', () => {
  it('reaches every domain in turn, however many are connected each day', async () => {
    const w = await world();
    const store = new CustomDomainStore(w.db as unknown as D1Database);
    const add = (hostname: string, at: string) =>
      w.db
        .prepare(
          `INSERT INTO custom_domains
             (hostname, project_id, user_id, cloudflare_id, created_at, checked_at)
           VALUES (?1, ?1, ?2, ?1, ?3, ?3)`,
        )
        .bind(hostname, ALICE, at)
        .run();
    await add('a.com', '2026-10-01T10:00:00.000Z');
    await add('b.com', '2026-10-01T11:00:00.000Z');
    await add('c.com', '2026-10-01T12:00:00.000Z');
    const due = async (limit: number) =>
      (await store.dueForCheck(limit)).map((row) => row.hostname);
    assert.deepEqual(await due(2), ['a.com', 'b.com']);
    await store.markChecked('a.com', '2026-10-02T09:47:00.000Z');
    await store.markChecked('b.com', '2026-10-02T09:47:00.000Z');
    // Connected after last night's pass: behind a and b, not ahead of them.
    await add('d.com', '2026-10-02T15:00:00.000Z');
    assert.deepEqual(await due(4), ['c.com', 'a.com', 'b.com', 'd.com']);
  });

  it('counts a domain as checked when it was connected', async () => {
    const w = await world();
    await w.prove(ALICE, 'www.bakery.com');
    await w.call(ALICE, 'POST', 'project-a', { hostname: 'www.bakery.com' });
    const row = await w.db
      .prepare(
        `SELECT created_at, checked_at FROM custom_domains WHERE hostname = 'www.bakery.com'`,
      )
      .first<{ created_at: string; checked_at: string }>();
    assert.equal(row?.checked_at, row?.created_at);
  });
});

describe('reading a TXT record over DNS over HTTPS', () => {
  it('joins quoted pieces, and tells no record from no answer', async () => {
    const answers: Record<string, unknown> = {
      '_vibld.www.bakery.com': {
        Status: 0,
        Answer: [
          { type: 16, data: '"vibld-verify=" "abc"' },
          { type: 5, data: 'elsewhere.example.' },
        ],
      },
      '_vibld.none.example': { Status: 3 },
      '_vibld.broken.example': { Status: 2 },
    };
    const resolve = dohResolveTxt((async (input: RequestInfo | URL) => {
      const name = new URL(String(input)).searchParams.get('name')!;
      return new Response(JSON.stringify(answers[name]), { status: 200 });
    }) as typeof fetch);
    assert.deepEqual(await resolve('_vibld.www.bakery.com'), [
      'vibld-verify=abc',
    ]);
    assert.deepEqual(await resolve('_vibld.none.example'), []);
    assert.equal(await resolve('_vibld.broken.example'), null);
  });
});
