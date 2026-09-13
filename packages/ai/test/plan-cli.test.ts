import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Which service the CLI actually calls.
 *
 * Asserted by running `bin/plan.ts` with only the socket replaced, rather
 * than by calling `createPlanClient` directly. The bug this covers was not in
 * that function, which has always preferred the chosen model's provider: it
 * was in the CLI calling it without the model at all, so the provider and the
 * model were read from the environment independently. A test that called the
 * function would have passed throughout.
 */

const PACKAGE_ROOT = join(import.meta.dirname, '..');

function hostFor(env: Record<string, string>): string {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      './test/fixtures/record-host.ts',
      'bin/plan.ts',
      'a landing page for a coffee roaster',
    ],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: 'not-a-real-key',
        DEEPSEEK_API_KEY: 'not-a-real-key',
        OPENAI_API_KEY: 'not-a-real-key',
        ...env,
      },
    },
  );
  const out = `${result.stdout}${result.stderr}`;
  const match = out.match(/called-host (\S+)/);
  assert.ok(match, `no request was made:\n${out}`);
  return match[1]!;
}

describe('which service the plan CLI calls', () => {
  it('sends a model to its own provider, whatever VIBLD_PROVIDER says', () => {
    // The finding: an Anthropic model id with VIBLD_PROVIDER=openai was sent
    // to OpenAI, which answers 400 in a way that reads like an outage.
    assert.match(
      hostFor({ VIBLD_PROVIDER: 'openai', VIBLD_MODEL: 'claude-opus-5' }),
      /anthropic/,
    );
    assert.match(
      hostFor({ VIBLD_PROVIDER: 'anthropic', VIBLD_MODEL: 'gpt-5.6-luna' }),
      /openai/,
    );
    assert.match(
      hostFor({ VIBLD_PROVIDER: 'anthropic', VIBLD_MODEL: 'deepseek-flash' }),
      /deepseek/,
    );
  });

  it('still follows VIBLD_PROVIDER when no model is named', () => {
    // The ordinary case, which must not change: with nothing chosen, the
    // deployment's own selection decides and picks that provider's default.
    assert.match(hostFor({ VIBLD_PROVIDER: 'openai' }), /openai/);
    assert.match(hostFor({ VIBLD_PROVIDER: 'deepseek' }), /deepseek/);
    assert.match(hostFor({ VIBLD_PROVIDER: 'anthropic' }), /anthropic/);
  });
});
