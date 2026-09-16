import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readConfig, readVars } from '../scripts/wrangler-var.ts';

/**
 * The deploy workflow reads `VIBLD_PROVIDER` out of wrangler.jsonc to decide
 * which model key must exist before it deploys. If that read is wrong the
 * gate passes on a missing key, the Worker deploys without it, and the live
 * site silently falls back to the deterministic fake.
 */
describe('readVars', () => {
  it('reads the committed config', () => {
    const vars = readVars(
      readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8'),
    );
    assert.ok(vars.VIBLD_PROVIDER);
    assert.ok(['anthropic', 'deepseek'].includes(vars.VIBLD_PROVIDER));
    assert.ok(vars.CLERK_FRONTEND_API_URL);
  });

  it('ignores a commented-out entry, which grep would have matched', () => {
    const vars = readVars(`{
      "vars": {
        // "VIBLD_PROVIDER": "anthropic",
        "VIBLD_PROVIDER": "deepseek",
      },
    }`);
    assert.equal(vars.VIBLD_PROVIDER, 'deepseek');
  });

  it('tolerates trailing commas, which JSON.parse alone would not', () => {
    assert.deepEqual(readVars('{ "vars": { "A": "1", }, }'), { A: '1' });
  });

  it('returns nothing rather than throwing when there are no vars', () => {
    assert.deepEqual(readVars('{ "name": "w" }'), {});
  });
});

/**
 * A rate limit namespace id is account-global, so two bindings that share one
 * share counters: a push would then consume a plan request's allowance and
 * neither gate would mean what it says. wrangler.jsonc says so in a comment,
 * which is the kind of thing a later edit copies past.
 */
describe('the rate limit bindings', () => {
  const config = readConfig(
    readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8'),
  );

  it('gives every binding its own namespace', () => {
    const ids = (config.ratelimits ?? []).map((limit) => limit.namespace_id);
    assert.ok(ids.length > 0, 'no rate limits are declared at all');
    assert.equal(new Set(ids).size, ids.length, `shared namespace: ${ids}`);
  });

  it('declares the ones the Worker actually reads', () => {
    const names = new Set((config.ratelimits ?? []).map((limit) => limit.name));
    for (const required of [
      'PLAN_BURST',
      'PLAN_SUSTAINED',
      'IP_BURST',
      'PUBLISH_BURST',
      'GITHUB_BURST',
    ]) {
      assert.ok(names.has(required), `${required} is not declared`);
    }
  });
});

describe('the billing replay query budget', () => {
  const vars = readVars(
    readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8'),
  );

  it('is declared, and is a number the Worker will take', () => {
    // Unset falls back to the value that is safe on Workers Free, which on a
    // Workers Paid deployment quietly clears about nine events a night
    // instead of a few hundred. Not wrong, and not what this account is
    // paying for.
    const budget = Number(vars.VIBLD_REPLAY_QUERY_BUDGET);
    assert.ok(
      Number.isFinite(budget) && budget > 0,
      'the replay would fall back to the Free-plan default',
    );
  });

  it('leaves the rest of the nightly pass some of the allowance', () => {
    // D1 stops the invocation at 1000 queries on Workers Paid by throwing,
    // and a throw freezes the replay's cursor, so every following night dies
    // in the same place. The parked-event retry, the payout resume and the
    // subscription reconcile all draw on the same allowance, so the replay
    // must not be entitled to the lot.
    const budget = Number(vars.VIBLD_REPLAY_QUERY_BUDGET);
    assert.ok(budget < 1000, 'the replay may spend the whole invocation');
  });
});
