import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveProblems, readLiveOptions, runCostCents } from '../src/live.ts';

const KEYED = {
  ANTHROPIC_API_KEY: 'a',
  DEEPSEEK_API_KEY: 'd',
  OPENAI_API_KEY: 'o',
};

describe('readLiveOptions', () => {
  it('stays off when nothing opts in, even with every key present', () => {
    // The property that matters most here. This same command runs in CI, so a
    // key in the environment must never be enough to start spending money.
    const options = readLiveOptions({
      ...KEYED,
      VIBLD_EVAL_MODELS: 'claude-opus-5',
    });
    assert.equal(options.enabled, false);
  });

  it('treats only a deliberate yes as opting in', () => {
    for (const flag of ['1', 'true', 'TRUE', 'yes']) {
      assert.equal(
        readLiveOptions({ VIBLD_EVAL_LIVE: flag }).enabled,
        true,
        flag,
      );
    }
    for (const flag of ['0', 'false', 'no', '', ' ', 'maybe']) {
      assert.equal(
        readLiveOptions({ VIBLD_EVAL_LIVE: flag }).enabled,
        false,
        flag,
      );
    }
  });

  it('reads a comma-separated model list, ignoring blanks', () => {
    const options = readLiveOptions({
      VIBLD_EVAL_LIVE: '1',
      VIBLD_EVAL_MODELS: 'claude-opus-5, claude-sonnet-5 ,,gpt-5.6-luna',
    });
    assert.deepEqual(options.models, [
      'claude-opus-5',
      'claude-sonnet-5',
      'gpt-5.6-luna',
    ]);
  });
});

describe('liveProblems', () => {
  it('says nothing at all when the run is not live', () => {
    // A stub run must not be blocked by a complaint about live configuration.
    const options = readLiveOptions({ VIBLD_EVAL_MODELS: 'not-a-model' });
    assert.deepEqual(liveProblems(options, {}), []);
  });

  it('refuses a live run that names no model', () => {
    const options = readLiveOptions({ VIBLD_EVAL_LIVE: '1', ...KEYED });
    const problems = liveProblems(options, KEYED);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /names no model/);
  });

  it('refuses a model the catalogue does not have, before paying for it', () => {
    const options = readLiveOptions({
      VIBLD_EVAL_LIVE: '1',
      VIBLD_EVAL_MODELS: 'gpt-9-imaginary',
    });
    const problems = liveProblems(options, KEYED);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /not a model in the catalogue/);
  });

  it('refuses a real model whose provider has no key', () => {
    // Otherwise the run fails partway through a set that already cost money.
    const options = readLiveOptions({
      VIBLD_EVAL_LIVE: '1',
      VIBLD_EVAL_MODELS: 'claude-opus-5',
    });
    const problems = liveProblems(options, { DEEPSEEK_API_KEY: 'd' });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /needs ANTHROPIC_API_KEY/);
  });

  it('accepts a fully configured live run', () => {
    const options = readLiveOptions({
      VIBLD_EVAL_LIVE: '1',
      VIBLD_EVAL_MODELS: 'claude-opus-5,deepseek-flash',
    });
    assert.deepEqual(liveProblems(options, KEYED), []);
  });
});

describe('runCostCents', () => {
  it('prices a run from the catalogue', () => {
    // Opus 5 is $5 per million in, $25 per million out.
    const cents = runCostCents('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(cents, 3000);
  });

  it('reports a sub-cent run as a real number, not as zero', () => {
    // The reason this is in cents. Rounded to dollars, the cheapest model in
    // the catalogue prints every case as $0.00, which reads as "free".
    // Luna at $0.20 in / $1.20 out per million: 0.0002 + 0.0006 = $0.0008.
    const cents = runCostCents('gpt-5.6-luna', {
      inputTokens: 1_000,
      outputTokens: 500,
    });
    assert.ok(cents !== null);
    assert.ok(cents > 0 && cents < 1, `${cents}c should be under a cent`);
    // The assertion that earns the unit: this is what the report prints.
    assert.equal(cents.toFixed(3), '0.080');
    assert.equal((cents / 100).toFixed(2), '0.00');
  });

  it('cannot price a model it does not know', () => {
    assert.equal(
      runCostCents('gpt-9-imaginary', {
        inputTokens: 1,
        outputTokens: 1,
      }),
      null,
    );
  });
});
