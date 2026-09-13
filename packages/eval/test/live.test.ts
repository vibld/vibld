import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  containedPath,
  liveProblems,
  planWrites,
  readLiveOptions,
  runCostCents,
  selectCaseIds,
} from '../src/live.ts';

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

describe('selectCaseIds', () => {
  it('refuses a bare --case instead of running everything', () => {
    // The expensive one. Against the stub this is merely wrong; live it is
    // every case against every configured model, billed, for what was meant
    // to be a single generation.
    const result = selectCaseIds(['--case']);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /needs a case id/);
  });

  it('refuses an empty or blank --case', () => {
    // `--case "$CASE"` with the variable unset arrives exactly like this.
    for (const value of ['', '   ']) {
      const result = selectCaseIds(['--case', value]);
      assert.equal(result.ok, false, JSON.stringify(value));
    }
  });

  it('refuses a --case that swallowed the next flag', () => {
    const result = selectCaseIds(['--case', '--verbose']);
    assert.equal(result.ok, false);
  });

  it('selects nothing when --case is absent, which means the whole set', () => {
    const result = selectCaseIds([]);
    assert.deepEqual(result, { ok: true, ids: [] });
  });

  it('collects every --case given', () => {
    const result = selectCaseIds(['--case', 'a', '--case', 'b']);
    assert.deepEqual(result, { ok: true, ids: ['a', 'b'] });
  });
});

describe('containedPath', () => {
  it('accepts a nested project path', () => {
    const target = containedPath('/out/opus/case', 'src/App.tsx');
    assert.equal(target, resolve('/out/opus/case/src/App.tsx'));
  });

  it('refuses an escape, the directory itself, and an absolute path', () => {
    for (const path of [
      '../escaped.txt',
      'src/../../escaped.txt',
      '.',
      '/etc/passwd',
    ]) {
      assert.equal(containedPath('/out/opus/case', path), null, path);
    }
  });

  it('keeps a file whose name merely starts with two dots', () => {
    // A prefix check on ".." would throw this away. It is a legitimate name.
    const target = containedPath('/out/opus/case', '..rc');
    assert.equal(target, resolve('/out/opus/case/..rc'));
  });
});

describe('selectCaseIds refuses anything it cannot account for', () => {
  // The first fix only closed the empty-value path. These are the forms that
  // still reached "no selection", and no selection meant the full set: every
  // case against every configured model, billed.
  it('refuses the equals spelling with no value, and accepts it with one', () => {
    assert.deepEqual(selectCaseIds(['--case=vibld-marketing']), {
      ok: true,
      ids: ['vibld-marketing'],
    });
    assert.equal(selectCaseIds(['--case=']).ok, false);
  });

  it('refuses a near-miss flag rather than silently running everything', () => {
    for (const argv of [['--cases', 'x'], ['--csae', 'x'], ['--case-id=x']]) {
      const result = selectCaseIds(argv);
      assert.equal(result.ok, false, argv.join(' '));
      if (!result.ok) assert.match(result.error, /Unrecognised argument/);
    }
  });

  it('refuses a bare positional argument', () => {
    assert.equal(selectCaseIds(['vibld-marketing']).ok, false);
  });

  it('refuses a value that is really the next flag', () => {
    assert.equal(selectCaseIds(['--case', '-v']).ok, false);
  });
});

describe('planWrites', () => {
  it('plans every file of a well-formed snapshot', () => {
    const plan = planWrites('/out/opus/case', [
      { path: 'package.json', content: '{}' },
      { path: 'src/App.tsx', content: 'x' },
    ]);
    assert.equal(plan.ok, true);
    if (plan.ok) assert.equal(plan.writes.length, 2);
  });

  it('refuses two paths that are one file on a case-insensitive volume', () => {
    // Distinct to the validator, which compares exactly; the same file on the
    // default macOS and Windows volumes. Writing both would report a file
    // count the directory does not have.
    const plan = planWrites('/out/opus/case', [
      { path: 'src/App.tsx', content: 'first' },
      { path: 'src/app.tsx', content: 'second' },
    ]);
    assert.equal(plan.ok, false);
    if (!plan.ok)
      assert.match(plan.error, /same file on a case-insensitive volume/);
  });

  it('refuses an escaping path', () => {
    const plan = planWrites('/out/opus/case', [
      { path: '../escaped.txt', content: 'x' },
    ]);
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.match(plan.error, /refusing to write outside/);
  });

  it('plans nothing at all when any single file is refused', () => {
    // The reason this returns a plan instead of writing as it goes: the
    // directory is cleared only once the whole snapshot is known to be
    // writable, so a bad file never destroys the run it would be compared to.
    const plan = planWrites('/out/opus/case', [
      { path: 'package.json', content: '{}' },
      { path: '../escaped.txt', content: 'x' },
    ]);
    assert.equal(plan.ok, false);
  });
});
