import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fieldsOf,
  formatEvent,
  queryBody,
  redact,
  selectEvents,
  stepSummary,
  summaryTable,
} from './worker-logs.mjs';

const at = (seconds) => Date.UTC(2026, 8, 29, 22, 0, seconds);

// The three shapes a line reaches Workers Logs in.
const generationStep = {
  timestamp: at(3),
  $metadata: { level: 'log' },
  source: {
    event: 'generation.step',
    runId: 'run_1',
    model: 'gpt-6-luna',
    name: 'group-3',
    ms: 41000,
    outputTokens: 900,
  },
};
const previewStep = (seconds, step, ms) => ({
  timestamp: at(seconds),
  $metadata: { level: 'log' },
  source: { message: ['preview.step', JSON.stringify({ step, ms })] },
});
const plainText = {
  timestamp: at(1),
  $metadata: { level: 'error', message: 'Preview start failed', error: 'boom' },
  source: { message: 'Preview start failed' },
};
const request = {
  timestamp: at(2),
  $metadata: { statusCode: 200, url: 'https://app.vibld.com/api/plan?x=1' },
  $workers: { outcome: 'ok' },
  source: {},
};

describe('worker-logs', () => {
  it('sends the match as a needle, and no needle without one', () => {
    const body = queryBody({
      from: 1,
      to: 2,
      service: 'vibld-preview',
      match: 'preview.step',
    });
    assert.deepEqual(body.parameters.needle, {
      value: 'preview.step',
      isRegex: false,
      matchCase: true,
    });
    assert.equal(body.parameters.filters[0].value, 'vibld-preview');
    assert.equal(
      'needle' in queryBody({ from: 1, to: 2, service: 's' }).parameters,
      false,
    );
  });

  it('reads fields from each shape a line is logged in', () => {
    assert.equal(fieldsOf(generationStep).name, 'group-3');
    assert.deepEqual(fieldsOf(previewStep(4, 'seed', 13000)), {
      event: 'preview.step',
      step: 'seed',
      ms: 13000,
    });
    assert.deepEqual(
      fieldsOf({ source: 'preview.updated {"ms":2100,"written":3}' }),
      { event: 'preview.updated', ms: 2100, written: 3 },
    );
    assert.deepEqual(
      fieldsOf({ $metadata: { message: '{"event":"x","ms":1}' } }),
      { event: 'x', ms: 1 },
    );
    assert.equal(fieldsOf(plainText), null);
    assert.equal(fieldsOf(request), null);
  });

  it('finds a structured line by a match its message does not carry', () => {
    const events = [
      plainText,
      request,
      generationStep,
      previewStep(4, 'seed', 1),
    ];
    const found = selectEvents(events, {
      errorsOnly: false,
      match: 'generation.step',
    });
    assert.deepEqual(found, [generationStep]);
    assert.equal(
      selectEvents(events, { errorsOnly: false, match: 'preview.step' }).length,
      1,
    );
    assert.deepEqual(selectEvents(events, { errorsOnly: true, match: '' }), [
      plainText,
    ]);
  });

  it('never prints a header or a body, wherever it sits', () => {
    assert.deepEqual(
      redact({
        a: 1,
        headers: { cookie: 'x' },
        nested: [{ Authorization: 'y', b: 2 }],
        body: 'z',
      }),
      { a: 1, nested: [{ b: 2 }] },
    );
    const line = formatEvent({
      timestamp: at(0),
      $metadata: {},
      source: {
        event: 'e',
        ms: 1,
        request: { headers: { authorization: 'secret' } },
      },
    });
    assert.doesNotMatch(line, /secret/);
    assert.match(formatEvent(request), /\/api\/plan \|/);
  });

  it('sums the timings per step, folding group numbers', () => {
    const events = [
      previewStep(4, 'seed', 10),
      previewStep(5, 'seed', 30),
      previewStep(6, 'seed', 20),
      previewStep(7, 'dev-server', 5),
      generationStep,
      {
        ...generationStep,
        source: { ...generationStep.source, name: 'group-7', ms: 1000 },
      },
      plainText,
    ];
    const rows = stepSummary(events);
    assert.deepEqual(
      rows.map((r) => [r.event, r.step, r.n, r.median, r.max]),
      [
        ['generation.step', 'group-N', 2, 1000, 41000],
        ['preview.step', 'seed', 3, 20, 30],
        ['preview.step', 'dev-server', 1, 5, 5],
      ],
    );
    assert.match(
      summaryTable(rows),
      /\| `preview.step` \| `seed` \| 3 \| 20 \| 30 \| 30 \|/,
    );
    assert.equal(summaryTable([]), '');
  });
});
