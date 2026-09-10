import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVars } from '../scripts/wrangler-var.ts';

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
