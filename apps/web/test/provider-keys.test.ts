import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { UNGATED_PATHS } from '../worker/access-gate.ts';
import type { AuditEntry } from '../worker/admin-store.ts';
import {
  KEY_CACHE_MS,
  KEY_ROUTES,
  cleanKey,
  encryptionKey,
  forgetPanelKeys,
  handleProviderKeys,
  openKey,
  panelKeyQueries,
  sealKey,
  withPanelKeys,
} from '../worker/provider-keys.ts';
import type { ProviderKeysEnv } from '../worker/provider-keys.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Provider keys set from the admin panel (docs/decisions.md D127, D131,
 * D132): stored only encrypted, shown only by their last four characters,
 * used ahead of the Worker secret, and every change audited.
 */

const WORKER = join(import.meta.dirname, '..', 'worker');
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');
const ADMIN = 'admin@example.com';
const ANTHROPIC = 'sk-ant-panel-key-0000000000wxyz';

function world(over: Partial<ProviderKeysEnv> = {}) {
  const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
  const env: ProviderKeysEnv = {
    DB: db,
    VIBLD_KEY_ENCRYPTION_KEY: SECRET,
    ANTHROPIC_API_KEY: 'sk-ant-secret-key-00000000abcd',
    ...over,
  };
  const audits: AuditEntry[] = [];
  const call = async (path: string, body?: unknown, e = env) => {
    const response = await handleProviderKeys(
      new Request(`https://app.vibld.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      }),
      e,
      {
        adminEmail: ADMIN,
        audit: async (entry) => {
          audits.push(entry);
          return true;
        },
        now: () => new Date('2026-10-01T03:00:00.000Z'),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  return { db, env, audits, call };
}

beforeEach(() => forgetPanelKeys());

describe('the encryption (D127)', () => {
  it('takes 32 bytes of base64, and nothing else', async () => {
    assert.ok(await encryptionKey(SECRET));
    assert.equal(await encryptionKey(undefined), null);
    assert.equal(await encryptionKey(''), null);
    assert.equal(
      await encryptionKey(Buffer.alloc(16).toString('base64')),
      null,
    );
    assert.equal(await encryptionKey('not base64 at all!'), null);
  });

  it('opens only under the same key, for the same provider', async () => {
    const key = (await encryptionKey(SECRET))!;
    const sealed = await sealKey(key, 'anthropic', ANTHROPIC);
    assert.ok(!sealed.ciphertext.includes('panel-key'));
    assert.equal(
      await openKey(key, 'anthropic', sealed.ciphertext, sealed.iv),
      ANTHROPIC,
    );
    // A row's ciphertext moved to another provider's row does not open.
    assert.equal(
      await openKey(key, 'openai', sealed.ciphertext, sealed.iv),
      null,
    );
    const other = (await encryptionKey(OTHER_SECRET))!;
    assert.equal(
      await openKey(other, 'anthropic', sealed.ciphertext, sealed.iv),
      null,
    );
  });

  it('refuses what cannot be a key', () => {
    assert.deepEqual(cleanKey('  sk-abcdefgh  '), {
      ok: true,
      key: 'sk-abcdefgh',
    });
    assert.equal(cleanKey('short').ok, false);
    assert.equal(cleanKey('sk-abc defgh').ok, false);
    assert.equal(cleanKey('x'.repeat(501)).ok, false);
    assert.equal(cleanKey(7).ok, false);
  });
});

describe('the key routes', () => {
  it('lists each provider by where its key comes from and its last four', async () => {
    const w = world();
    const listed = await w.call('/api/admin/keys');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.canStore, true);
    assert.deepEqual(
      listed.body.keys.map((k: any) => [k.provider, k.source, k.last4]),
      [
        ['anthropic', 'secret', 'abcd'],
        ['deepseek', null, null],
        ['openai', null, null],
      ],
    );
    assert.doesNotMatch(JSON.stringify(listed.body), /secret-key/);
  });

  it('stores a key encrypted, shows its last four, and audits it', async () => {
    const w = world();
    const set = await w.call('/api/admin/keys', {
      provider: 'anthropic',
      key: ` ${ANTHROPIC} `,
    });
    assert.equal(set.status, 200);
    assert.equal(set.body.last4, 'wxyz');
    assert.doesNotMatch(JSON.stringify(set.body), /panel-key/);
    const row = await w.db
      .prepare(`SELECT * FROM provider_keys WHERE provider = 'anthropic'`)
      .first<Record<string, string>>();
    assert.ok(row);
    assert.ok(!JSON.stringify(row).includes('panel-key'), 'never in plain');
    assert.equal(row.last4, 'wxyz');
    assert.equal(row.updated_by, ADMIN);
    assert.deepEqual(
      set.body.keys.find((k: any) => k.provider === 'anthropic'),
      {
        provider: 'anthropic',
        name: 'Anthropic',
        source: 'panel',
        last4: 'wxyz',
        stored: true,
        unreadable: false,
        storedLast4: 'wxyz',
        updatedAt: '2026-10-01T03:00:00.000Z',
        updatedBy: ADMIN,
        secretSet: true,
      },
    );
    assert.deepEqual(w.audits, [
      {
        at: '2026-10-01T03:00:00.000Z',
        adminEmail: ADMIN,
        action: 'provider-key-set',
        targetUserId: null,
        target: 'anthropic',
        reason: null,
        detail: { last4: 'wxyz' },
      },
    ]);
  });

  it('removes a key, falling back to the secret, and refuses one it does not hold', async () => {
    const w = world();
    await w.call('/api/admin/keys', { provider: 'anthropic', key: ANTHROPIC });
    const removed = await w.call('/api/admin/keys/remove', {
      provider: 'anthropic',
    });
    assert.equal(removed.status, 200);
    assert.equal(
      removed.body.keys.find((k: any) => k.provider === 'anthropic').source,
      'secret',
    );
    assert.equal(w.audits.at(-1)!.action, 'provider-key-remove');
    const again = await w.call('/api/admin/keys/remove', {
      provider: 'anthropic',
    });
    assert.equal(again.status, 409);
    assert.equal(w.audits.length, 2);
  });

  it('does not call a stored key the one in use when it does not open', async () => {
    const w = world();
    await w.call('/api/admin/keys', { provider: 'anthropic', key: ANTHROPIC });
    // The encryption key replaced: the row stays, and no longer opens.
    const rotated = { ...w.env, VIBLD_KEY_ENCRYPTION_KEY: OTHER_SECRET };
    const listed = await w.call('/api/admin/keys', undefined, rotated);
    const anthropic = listed.body.keys.find(
      (k: any) => k.provider === 'anthropic',
    );
    assert.deepEqual(
      [
        anthropic.source,
        anthropic.last4,
        anthropic.stored,
        anthropic.unreadable,
        anthropic.storedLast4,
      ],
      ['secret', 'abcd', true, true, 'wxyz'],
    );
    // Without the secret either, nothing is in use.
    const bare = await w.call('/api/admin/keys', undefined, {
      ...rotated,
      ANTHROPIC_API_KEY: undefined,
    });
    assert.equal(
      bare.body.keys.find((k: any) => k.provider === 'anthropic').source,
      null,
    );
    // And it can still be removed.
    const removed = await w.call(
      '/api/admin/keys/remove',
      { provider: 'anthropic' },
      rotated,
    );
    assert.equal(removed.status, 200);
  });

  it('stores nothing without an encryption key, and says how to set one', async () => {
    const w = world({ VIBLD_KEY_ENCRYPTION_KEY: undefined });
    assert.equal((await w.call('/api/admin/keys')).body.canStore, false);
    const refused = await w.call('/api/admin/keys', {
      provider: 'openai',
      key: 'sk-openai-0000000000',
    });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /VIBLD_KEY_ENCRYPTION_KEY/);
    assert.deepEqual(w.audits, []);
  });

  it('refuses an unknown provider and a key that cannot be one', async () => {
    const w = world();
    assert.equal(
      (
        await w.call('/api/admin/keys', {
          provider: 'mistral',
          key: 'x'.repeat(20),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await w.call('/api/admin/keys', {
          provider: 'openai',
          key: 'a b c d e f',
        })
      ).status,
      400,
    );
    assert.deepEqual(w.audits, []);
  });
});

describe('the panel’s keys in use (D131)', () => {
  it('are laid over the secret, and the secret comes back when removed', async () => {
    const w = world();
    assert.equal(
      (await withPanelKeys(w.env)).ANTHROPIC_API_KEY,
      'sk-ant-secret-key-00000000abcd',
    );
    await w.call('/api/admin/keys', { provider: 'anthropic', key: ANTHROPIC });
    await w.call('/api/admin/keys', {
      provider: 'deepseek',
      key: 'sk-deepseek-panel-1234',
    });
    const keyed = await withPanelKeys(w.env);
    assert.equal(keyed.ANTHROPIC_API_KEY, ANTHROPIC);
    assert.equal(keyed.DEEPSEEK_API_KEY, 'sk-deepseek-panel-1234');
    assert.equal(keyed.DB, w.env.DB, 'bindings are carried over');
    // The Worker's own environment is never changed.
    assert.equal(w.env.ANTHROPIC_API_KEY, 'sk-ant-secret-key-00000000abcd');
    await w.call('/api/admin/keys/remove', { provider: 'anthropic' });
    assert.equal(
      (await withPanelKeys(w.env)).ANTHROPIC_API_KEY,
      'sk-ant-secret-key-00000000abcd',
    );
  });

  it('reads the table once per window, not on every request', async () => {
    const w = world();
    await w.call('/api/admin/keys', {
      provider: 'openai',
      key: 'sk-openai-first-1',
    });
    let reads = 0;
    const counting = {
      prepare: (sql: string) => {
        reads += 1;
        return w.db.prepare(sql);
      },
    } as unknown as D1Database;
    const env = { ...w.env, DB: counting };
    const t = 1_000_000;
    assert.equal(
      (await withPanelKeys(env, t)).OPENAI_API_KEY,
      'sk-openai-first-1',
    );
    await withPanelKeys(env, t + 1_000);
    assert.equal(reads, 1);
    await withPanelKeys(env, t + KEY_CACHE_MS + 1);
    assert.equal(reads, 2);
  });

  it('reads the table once for requests that arrive together', async () => {
    const w = world();
    await w.call('/api/admin/keys', {
      provider: 'openai',
      key: 'sk-openai-burst-1',
    });
    let reads = 0;
    const counting = {
      prepare: (sql: string) => {
        reads += 1;
        return w.db.prepare(sql);
      },
    } as unknown as D1Database;
    const env = { ...w.env, DB: counting };
    const all = await Promise.all(
      Array.from({ length: 8 }, () => withPanelKeys(env, 5_000_000)),
    );
    assert.equal(reads, 1);
    for (const keyed of all) {
      assert.equal(keyed.OPENAI_API_KEY, 'sk-openai-burst-1');
    }
  });

  it('does not keep a failed read, so the next request tries again', async () => {
    const w = world();
    await w.call('/api/admin/keys', {
      provider: 'openai',
      key: 'sk-openai-retry-1',
    });
    forgetPanelKeys();
    let fail = true;
    const flaky = {
      prepare: (sql: string) => {
        if (fail) throw new Error('D1 down');
        return w.db.prepare(sql);
      },
    } as unknown as D1Database;
    const env = { ...w.env, OPENAI_API_KEY: undefined, DB: flaky };
    assert.equal(
      (await withPanelKeys(env, 9_000_000)).OPENAI_API_KEY,
      undefined,
    );
    fail = false;
    assert.equal(
      (await withPanelKeys(env, 9_000_001)).OPENAI_API_KEY,
      'sk-openai-retry-1',
    );
  });

  it('skips a key that does not open, and keeps the secrets when the table cannot be read', async () => {
    const w = world();
    await w.call('/api/admin/keys', { provider: 'anthropic', key: ANTHROPIC });
    forgetPanelKeys();
    const rotated = await withPanelKeys({
      ...w.env,
      VIBLD_KEY_ENCRYPTION_KEY: OTHER_SECRET,
    });
    assert.equal(rotated.ANTHROPIC_API_KEY, 'sk-ant-secret-key-00000000abcd');
    forgetPanelKeys();
    const broken = {
      prepare: () => {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    const kept = await withPanelKeys({ ...w.env, DB: broken });
    assert.equal(kept.ANTHROPIC_API_KEY, 'sk-ant-secret-key-00000000abcd');
  });

  it('touches nothing without a database or an encryption key', async () => {
    const env = { ANTHROPIC_API_KEY: 'x' };
    assert.equal(await withPanelKeys(env), env);
    assert.equal(panelKeyQueries(env), 0);
    assert.equal(panelKeyQueries(world().env), 1);
  });
});

describe('the wiring', () => {
  it('manages keys against the Worker’s own environment, behind the admin check', async () => {
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const start = index.indexOf('if (isKeyRoute(');
    assert.ok(start > 0, 'the key routes are routed');
    const block = index.slice(start, index.indexOf('\n  }\n', start));
    assert.ok(
      block.indexOf('requireAdmin(request, env)') <
        block.indexOf('handleProviderKeys('),
    );
    assert.match(block, /handleProviderKeys\(request, env,/);
    // Laid over every route after the key routes, and before any other.
    const route = index.slice(index.indexOf('async function route('));
    const overlay = route.indexOf('env = await withPanelKeys(env);');
    assert.ok(overlay > route.indexOf('if (isKeyRoute(pathname))'));
    assert.ok(overlay < route.indexOf('if (isGated('));
    for (const path of KEY_ROUTES) {
      assert.equal(
        UNGATED_PATHS[path],
        'behind the platform-admin check instead',
      );
    }
  });

  it('uses the panel’s keys for the nightly balance check, within its query allowance', async () => {
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    assert.match(
      index,
      /withPanelKeys\(env\)\s*\.then\(checkProviderBalances\)/,
    );
    assert.match(index, /- panelKeyQueries\(env\)/);
  });

  it('uses the panel’s keys for every model call a run makes', async () => {
    const workflow = await readFile(
      join(WORKER, 'generation-workflow.ts'),
      'utf8',
    );
    assert.match(workflow, /const env = await withPanelKeys\(this\.env\);/);
    assert.doesNotMatch(workflow, /createPlanClient\(this\.env/);
    assert.doesNotMatch(workflow, /verifyAndRepair\(\s*this\.env/);
  });
});
