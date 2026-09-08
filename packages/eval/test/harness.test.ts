import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeModelProvider } from '@vibld/core';
import { CASES, PROMPT_SET_VERSION, stubPlan } from '../src/cases.ts';
import { runCase } from '../src/harness.ts';
import { formatReport, summarise } from '../src/report.ts';

describe('the prompt set', () => {
  it('is versioned and every case is distinct', () => {
    assert.match(PROMPT_SET_VERSION, /^\d+\.\d+\.\d+$/);
    const ids = CASES.map((testCase) => testCase.id);
    assert.equal(new Set(ids).size, ids.length, 'case ids must be unique');
    const prompts = CASES.map((testCase) => testCase.prompt);
    assert.equal(new Set(prompts).size, prompts.length);
  });

  it('states an expectation for every case', () => {
    for (const testCase of CASES) {
      assert.ok(
        testCase.expects.files.length > 0,
        `${testCase.id} expects no files, so it cannot fail`,
      );
      assert.ok(
        testCase.expects.content.length > 0,
        `${testCase.id} checks no content`,
      );
    }
  });
});

describe('running a case', () => {
  it('accepts a project that meets its expectations', async () => {
    const testCase = CASES[0]!;
    const result = await runCase(
      testCase,
      new FakeModelProvider([stubPlan(testCase)]),
    );
    assert.equal(result.outcome, 'accepted');
    assert.deepEqual(result.problems, []);
    assert.ok(
      result.estimatedTokens > 0,
      'a run that spent nothing did nothing',
    );
  });

  it('fails a project that builds but ignores the request', async () => {
    // The failure a compiler cannot see: valid, portable, and not what was
    // asked for.
    const testCase = CASES[0]!;
    const result = await runCase(
      testCase,
      new FakeModelProvider([
        {
          summary: 'something else entirely',
          files: [
            {
              path: 'package.json',
              content: JSON.stringify({
                name: 'other',
                scripts: { dev: 'vite', build: 'vite build' },
              }),
            },
            { path: 'README.md', content: '# unrelated\n' },
            { path: 'index.html', content: '<!doctype html><html></html>' },
          ],
        },
      ]),
    );
    assert.equal(result.outcome, 'failed-expectations');
    assert.ok(
      result.problems.some((problem) => problem.includes('never mentions')),
    );
  });

  it('fails an unportable project rather than accepting it', async () => {
    const testCase = CASES[0]!;
    const result = await runCase(
      testCase,
      new FakeModelProvider([
        {
          summary: 'tied to Vibld',
          files: [
            {
              path: 'package.json',
              content: JSON.stringify({
                name: 'tied',
                scripts: { dev: 'vite', build: 'vite build' },
                dependencies: { '@vibld/runtime': '1.0.0' },
              }),
            },
            { path: 'README.md', content: '# coffee\n' },
            { path: 'index.html', content: '<!doctype html>' },
          ],
        },
      ]),
    );
    assert.equal(result.outcome, 'failed-validation');
  });

  it('reports a run that exceeded its budget without starting it', async () => {
    const testCase = CASES[0]!;
    const result = await runCase(
      testCase,
      new FakeModelProvider([stubPlan(testCase)]),
      { budget: { modelInputTokens: 1, modelOutputTokens: 1, toolCalls: 1 } },
    );
    assert.equal(result.outcome, 'budget-exceeded');
  });
});

describe('the report', () => {
  it('counts tokens spent by failed runs too', () => {
    const report = summarise(
      [
        {
          id: 'a',
          outcome: 'accepted',
          durationMs: 10,
          problems: [],
          estimatedTokens: 100,
        },
        {
          id: 'b',
          outcome: 'failed-validation',
          durationMs: 5,
          problems: ['bad'],
          estimatedTokens: 40,
        },
      ],
      'stub',
    );
    assert.equal(report.accepted, 1);
    assert.equal(report.total, 2);
    // A tally that counted only successes would say 100 and under-report
    // the bill by the exact amount the failures cost.
    assert.equal(report.estimatedTokens, 140);
    assert.deepEqual(report.failures, { 'failed-validation': 1 });
  });

  it('says the stub is not a model wherever the score is printed', () => {
    const text = formatReport(summarise([], 'stub'));
    assert.match(text, /deterministic stub, not a model/);
    // A plain substring check rather than a regex built from the version:
    // escaping only dots leaves every other metacharacter live, so the
    // assertion would quietly change meaning the day the version does.
    assert.ok(
      text.includes(PROMPT_SET_VERSION),
      'the report must name the prompt set version it scored',
    );
  });

  it('names every failed case and its reasons', () => {
    const text = formatReport(
      summarise(
        [
          {
            id: 'coffee-roaster',
            outcome: 'failed-expectations',
            durationMs: 3,
            problems: ['the project never mentions "coffee"'],
            estimatedTokens: 12,
          },
        ],
        'stub',
      ),
    );
    assert.match(text, /coffee-roaster/);
    assert.match(text, /never mentions "coffee"/);
  });
});
