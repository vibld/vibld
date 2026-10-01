import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { MODEL_CATALOGUE } from '@vibld/ai/model-catalogue';

import { UNGATED_PATHS } from '../worker/access-gate.ts';
import { AdminStore } from '../worker/admin-store.ts';
import type { AuditEntry } from '../worker/admin-store.ts';
import { handleAdminUsers } from '../worker/admin-users.ts';
import type { AdminUsersDeps } from '../worker/admin-users.ts';
import {
  FREE_PLAN_MODELS_NOTE,
  NO_PANEL,
  decideModel,
  draftModelFor,
  grantedFor,
  planModelsNote,
} from '../worker/model-access.ts';
import type { ModelGrantSource } from '../worker/model-access.ts';
import {
  MODEL_ROUTES,
  PLAN_MODELS_CACHE_MS,
  forgetPlanModels,
  handleModelAccess,
  modelGrantSource,
  savedPlanModels,
  startingPlanModels,
} from '../worker/model-grants.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Model access set in the admin panel (docs/decisions.md D133, D135,
 * D136): each plan's models saved as a whole, used in place of
 * `VIBLD_MODEL_POLICY` once saved, an account's extras on top of its
 * plan's, and every change audited.
 */

const WORKER = join(import.meta.dirname, '..', 'worker');
const ADMIN = 'admin@example.com';
const USER = 'user_a';
const ALL_KEYED = {
  ANTHROPIC_API_KEY: 'a',
  DEEPSEEK_API_KEY: 'd',
  OPENAI_API_KEY: 'o',
};
/** A policy that gives everybody Flash only, which the panel replaces. */
const POLICY = JSON.stringify({ default: ['deepseek-flash'] });
const EVERY = MODEL_CATALOGUE.map((model) => model.id);
/** What ALL_KEYED can serve: everything but the local model (D124). */
const EVERY_KEYED = MODEL_CATALOGUE.filter(
  (model) => model.provider !== 'local',
).map((model) => model.id);

const panel = (
  plans: Partial<Record<'free' | 'build' | 'ship', string[]>>,
  extras: string[] = [],
): ModelGrantSource => ({
  plans: { ...startingPlanModels(), ...plans },
  extras,
});

const ids = (models: readonly { id: string }[]) => models.map((m) => m.id);

function world() {
  const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
  const audits: AuditEntry[] = [];
  const call = async (
    path: string,
    body?: unknown,
    deployable = MODEL_CATALOGUE,
  ) => {
    const response = await handleModelAccess(
      new Request(`https://app.vibld.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      }),
      db,
      {
        adminEmail: ADMIN,
        audit: async (entry) => {
          audits.push(entry);
          return true;
        },
        deployable,
        policySet: true,
        now: () => new Date('2026-10-01T05:00:00.000Z'),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  return { db, audits, call };
}

beforeEach(() => forgetPlanModels());

describe('which models a caller has, once the panel decides (D133)', () => {
  it('uses the plan’s list in place of the policy, within what is deployable', () => {
    const env = { ...ALL_KEYED, VIBLD_MODEL_POLICY: POLICY };
    // Before anything is saved, the policy and D66 decide.
    assert.deepEqual(ids(grantedFor(env, 'a@example.com', 'build')), [
      'deepseek-flash',
    ]);
    const source = panel({ build: ['claude-opus-5-5', 'deepseek-v4-pro'] });
    assert.deepEqual(ids(grantedFor(env, 'a@example.com', 'build', source)), [
      'claude-opus-5-5',
      'deepseek-v4-pro',
    ]);
    // A model whose provider has no key is not offered, saved or not.
    assert.deepEqual(
      ids(
        grantedFor({ DEEPSEEK_API_KEY: 'd' }, 'a@example.com', 'build', source),
      ),
      ['deepseek-v4-pro'],
    );
  });

  it('starts from D66: Free has GPT-6 Luna, the paid plans everything', () => {
    const starting = startingPlanModels();
    assert.deepEqual(starting.free, ['gpt-6-luna']);
    assert.deepEqual(starting.build, EVERY);
    assert.deepEqual(starting.ship, EVERY);
    const source = panel({});
    assert.deepEqual(ids(grantedFor(ALL_KEYED, 'a', 'free', source)), [
      'gpt-6-luna',
    ]);
    assert.deepEqual(
      ids(grantedFor(ALL_KEYED, 'a', 'ship', source)),
      EVERY_KEYED,
    );
  });

  it('holds a deployment that sells no plans to the Free row (D135)', () => {
    const source = panel({ free: ['deepseek-flash'] });
    assert.deepEqual(ids(grantedFor(ALL_KEYED, 'a', null, source)), [
      'deepseek-flash',
    ]);
    // And says nothing about upgrading: there is no plan to buy.
    assert.equal(planModelsNote(ALL_KEYED, 'a', null, source), null);
  });

  it('adds an account’s extras to its plan’s, under the policy or the panel (D136)', () => {
    const extras = { plans: null, extras: ['claude-sonnet-5'] };
    assert.deepEqual(ids(grantedFor(ALL_KEYED, 'a', 'free', extras)), [
      'claude-sonnet-5',
      'gpt-6-luna',
    ]);
    assert.deepEqual(
      ids(grantedFor(ALL_KEYED, 'a', 'free', panel({}, ['claude-sonnet-5']))),
      ['claude-sonnet-5', 'gpt-6-luna'],
    );
    // Not deployable, not offered.
    assert.deepEqual(
      ids(grantedFor({ OPENAI_API_KEY: 'o' }, 'a', 'free', extras)),
      ['gpt-6-luna'],
    );
    // An extra can be the draft model, which then draws the draft.
    assert.equal(
      draftModelFor(ALL_KEYED, 'a', 'free', panel({}, ['deepseek-flash'])),
      'deepseek-flash',
    );
    assert.equal(draftModelFor(ALL_KEYED, 'a', 'free', panel({})), null);
  });

  it('says what the plan includes, and what a higher plan would add', () => {
    const source = panel({
      free: ['gpt-6-luna'],
      build: ['gpt-6-luna', 'deepseek-flash'],
      ship: EVERY,
    });
    assert.equal(
      planModelsNote(ALL_KEYED, 'a', 'free', source),
      'Your plan builds with GPT-6 Luna. Paid plans unlock more models.',
    );
    assert.equal(
      planModelsNote(ALL_KEYED, 'a', 'build', source),
      'Your plan builds with GPT-6 Luna and DeepSeek Flash. The Ship plan unlocks more models.',
    );
    assert.equal(planModelsNote(ALL_KEYED, 'a', 'ship', source), null);
    // Nothing higher adds anything, so nothing is promised.
    assert.equal(
      planModelsNote(
        ALL_KEYED,
        'a',
        'free',
        panel({ free: EVERY, build: EVERY, ship: EVERY }),
      ),
      null,
    );
    // Until saved, the D66 sentence, as before the panel.
    assert.equal(
      planModelsNote(ALL_KEYED, 'a', 'free', NO_PANEL),
      FREE_PLAN_MODELS_NOTE,
    );
    // But not for an account an admin gave more than Luna: it names what
    // that account has, under the policy or the panel (Codex review of internal PR 344).
    const extras = { plans: null, extras: ['claude-sonnet-5'] };
    assert.equal(
      planModelsNote(ALL_KEYED, 'a', 'free', extras),
      'You build with Claude Sonnet 5 and GPT-6 Luna. Paid plans unlock more models.',
    );
    const refused = decideModel(
      ALL_KEYED,
      'a@example.com',
      'free',
      'claude-opus-5-5',
      'gpt-6-luna',
      extras,
    );
    assert.equal(
      !refused.ok && refused.error,
      'You build with Claude Sonnet 5 and GPT-6 Luna. Paid plans unlock more models.',
    );
    assert.equal(
      planModelsNote(ALL_KEYED, 'a', 'free', panel({}, ['claude-sonnet-5'])),
      'You build with Claude Sonnet 5 and GPT-6 Luna. Paid plans unlock more models.',
    );
  });

  it('refuses a model the plan does not include, and says which plan does', () => {
    const source = panel({ build: ['deepseek-flash'] });
    const refused = decideModel(
      ALL_KEYED,
      'a@example.com',
      'free',
      'deepseek-flash',
      'gpt-6-luna',
      source,
    );
    assert.deepEqual(refused, {
      ok: false,
      status: 403,
      error: 'Your plan builds with GPT-6 Luna. Paid plans unlock more models.',
    });
    // No plan has it: plainly not available.
    const nobody = decideModel(
      ALL_KEYED,
      'a@example.com',
      'ship',
      'claude-opus-5-5',
      'gpt-6-luna',
      panel({ ship: ['deepseek-flash'] }),
    );
    assert.equal(nobody.ok, false);
    assert.match(!nobody.ok ? nobody.error : '', /not available to a@/);
    // The policy no longer narrows anybody once the panel decides.
    const granted = decideModel(
      { ...ALL_KEYED, VIBLD_MODEL_POLICY: POLICY },
      'a@example.com',
      'ship',
      'claude-opus-5-5',
      'gpt-6-luna',
      panel({}),
    );
    assert.equal(granted.ok && granted.model, 'claude-opus-5-5');
  });

  it('refuses everything, and says where to fix it, when a plan has nothing to run', () => {
    const empty = decideModel(
      ALL_KEYED,
      'a@example.com',
      'ship',
      null,
      'gpt-6-luna',
      panel({ ship: [] }),
    );
    assert.equal(empty.ok, false);
    assert.match(!empty.ok ? empty.error : '', /admin panel/);
    const freeEmpty = decideModel(
      ALL_KEYED,
      'a@example.com',
      'free',
      null,
      'gpt-6-luna',
      panel({ free: [] }),
    );
    assert.deepEqual(freeEmpty, {
      ok: false,
      status: 403,
      error:
        'Your plan includes no model this deployment can run. Paid plans unlock more models.',
    });
  });
});

describe('the model access routes', () => {
  it('shows the starting setting and the catalog until an admin saves', async () => {
    const w = world();
    const shown = await w.call(
      '/api/admin/models',
      undefined,
      MODEL_CATALOGUE.filter((model) => model.provider === 'openai'),
    );
    assert.equal(shown.status, 200);
    assert.deepEqual(shown.body.plans, startingPlanModels());
    assert.equal(shown.body.saved, null);
    assert.equal(shown.body.policySet, true);
    assert.equal(shown.body.catalog.length, MODEL_CATALOGUE.length);
    const luna = shown.body.catalog.find((m: any) => m.id === 'gpt-6-luna');
    const flash = shown.body.catalog.find(
      (m: any) => m.id === 'deepseek-flash',
    );
    assert.equal(luna.deployable, true);
    assert.equal(flash.deployable, false);
  });

  it('saves all three plans together, in catalog order, and audits it', async () => {
    const w = world();
    const saved = await w.call('/api/admin/models', {
      plans: {
        // Duplicates and an old id are cleaned, not refused.
        free: ['deepseek-flash', 'gpt-6-luna', 'gpt-6-luna'],
        build: ['claude-opus-5-5'],
        ship: EVERY,
      },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.plans.free, ['gpt-6-luna', 'deepseek-flash']);
    assert.deepEqual(saved.body.saved, {
      updatedAt: '2026-10-01T05:00:00.000Z',
      updatedBy: ADMIN,
    });
    assert.equal(w.audits.length, 1);
    assert.equal(w.audits[0]!.action, 'model-access');
    assert.deepEqual(w.audits[0]!.detail, saved.body.plans);
    const read = await savedPlanModels(w.db);
    assert.deepEqual(read?.plans, saved.body.plans);
  });

  it('refuses an unknown model or a missing plan, saving nothing', async () => {
    const w = world();
    for (const plans of [
      { free: ['gpt-6-luna'], build: [], ship: ['not-a-model'] },
      { free: ['gpt-6-luna'], build: [] },
      { free: 'gpt-6-luna', build: [], ship: [] },
      { free: [1], build: [], ship: [] },
    ]) {
      const refused = await w.call('/api/admin/models', { plans });
      assert.equal(refused.status, 400, JSON.stringify(plans));
    }
    assert.equal((await w.call('/api/admin/models', { plan: [] })).status, 400);
    assert.equal(await savedPlanModels(w.db), null);
    assert.deepEqual(w.audits, []);
  });

  it('goes back to the policy, and refuses a reset with nothing saved', async () => {
    const w = world();
    assert.equal((await w.call('/api/admin/models/reset', {})).status, 409);
    await w.call('/api/admin/models', {
      plans: { free: [], build: [], ship: [] },
    });
    const reset = await w.call('/api/admin/models/reset', {});
    assert.equal(reset.status, 200);
    assert.equal(reset.body.saved, null);
    assert.equal(await savedPlanModels(w.db), null);
    assert.deepEqual(
      w.audits.map((entry) => entry.action),
      ['model-access', 'model-access-reset'],
    );
  });

  it('reads the saved plans once per window, and keeps no failed read', async () => {
    const w = world();
    let reads = 0;
    let fail = true;
    const counting = {
      prepare: (sql: string) => {
        reads += 1;
        if (fail) throw new Error('D1 down');
        return w.db.prepare(sql);
      },
    } as unknown as D1Database;
    await assert.rejects(savedPlanModels(counting, 1_000_000));
    fail = false;
    await Promise.all(
      Array.from({ length: 4 }, () => savedPlanModels(counting, 1_000_001)),
    );
    assert.equal(reads, 2);
    await savedPlanModels(counting, 1_000_001 + PLAN_MODELS_CACHE_MS - 1);
    assert.equal(reads, 2);
    await savedPlanModels(counting, 1_000_001 + PLAN_MODELS_CACHE_MS);
    assert.equal(reads, 3);
  });
});

describe('an account’s extra models (D136)', () => {
  async function setModels(db: D1Database, body: Record<string, unknown>) {
    const deps = {
      authorize: async () => ({ denied: null, adminEmail: ADMIN }),
      now: () => new Date('2026-10-01T05:00:00.000Z'),
    } as unknown as AdminUsersDeps;
    const response = await handleAdminUsers(
      new Request('https://app.vibld.com/api/admin/user/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { DB: db },
      deps,
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }

  it('sets, reads and clears them, with an audit row each time', async () => {
    const w = world();
    const set = await setModels(w.db, {
      userId: USER,
      models: ['claude-sonnet-5', 'deepseek-flash'],
      reason: 'tester',
    });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.models, ['claude-sonnet-5', 'deepseek-flash']);
    assert.deepEqual(await modelGrantSource(w.db, USER), {
      plans: null,
      extras: ['claude-sonnet-5', 'deepseek-flash'],
    });
    assert.deepEqual(await modelGrantSource(w.db, 'user_b'), NO_PANEL);

    const cleared = await setModels(w.db, { userId: USER, models: [] });
    assert.equal(cleared.status, 200);
    assert.equal(await new AdminStore(w.db).personModels(USER), null);
    const audit = await new AdminStore(w.db).auditFor(USER, 10);
    assert.deepEqual(audit.map((row) => [row.action, row.detail]).reverse(), [
      ['person-models', { models: ['claude-sonnet-5', 'deepseek-flash'] }],
      ['person-models', { models: [] }],
    ]);
  });

  it('refuses an unknown model, saving nothing', async () => {
    const w = world();
    const refused = await setModels(w.db, {
      userId: USER,
      models: ['gpt-9'],
    });
    assert.equal(refused.status, 400);
    assert.equal(await new AdminStore(w.db).personModels(USER), null);
  });

  it('applies alongside the panel’s plans', async () => {
    const w = world();
    await w.call('/api/admin/models', {
      plans: { free: ['gpt-6-luna'], build: EVERY, ship: EVERY },
    });
    await setModels(w.db, { userId: USER, models: ['claude-haiku-4-5'] });
    const source = await modelGrantSource(w.db, USER);
    assert.deepEqual(ids(grantedFor(ALL_KEYED, 'a', 'free', source)), [
      'claude-haiku-4-5',
      'gpt-6-luna',
    ]);
  });
});

/** Each call of the named functions, from its name to its closing paren. */
function callsOf(source: string, names: string[]): string[] {
  const calls: string[] = [];
  const pattern = new RegExp(`\\b(${names.join('|')})\\(`, 'g');
  for (const match of source.matchAll(pattern)) {
    // Skip the import list and the declarations.
    const before = source.slice(Math.max(0, match.index - 9), match.index);
    if (/function\s$/.test(before)) continue;
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')' && --depth === 0) break;
    }
    calls.push(source.slice(match.index, end + 1));
  }
  return calls;
}

describe('where the panel’s model access is read', () => {
  it('is routed behind the admin check, and passed to every decision', async () => {
    const index = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const start = index.indexOf('if (isModelRoute(pathname))');
    assert.ok(start > 0);
    const block = index.slice(start, index.indexOf('\n  }\n', start));
    assert.ok(
      block.indexOf('requireAdmin(request, env)') <
        block.indexOf('handleModelAccess('),
    );
    for (const path of [...MODEL_ROUTES, '/api/admin/user/models']) {
      assert.equal(
        UNGATED_PATHS[path],
        'behind the platform-admin check instead',
        path,
      );
    }
    // Every decision that names a tier names the panel's access with it:
    // a call that left it out would quietly go back to the policy.
    const chat = await readFile(join(WORKER, 'chat-handler.ts'), 'utf8');
    for (const source of [index, chat]) {
      const calls = callsOf(source, [
        'decideModel',
        'grantedFor',
        'draftModelFor',
        'planModelsNote',
      ]);
      assert.ok(calls.length >= (source === index ? 6 : 1));
      for (const call of calls) assert.match(call, /access\b/, call);
    }
  });
});
