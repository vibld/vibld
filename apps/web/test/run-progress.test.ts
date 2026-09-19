import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  PROGRESS_REPORT_INTERVAL_MS,
  throttleProgress,
  type ProgressReport,
} from '../worker/generation-run.ts';
import { POLL_INTERVAL_MS } from '../worker/run-stage.ts';

/**
 * What a run is allowed to spend to say how it is doing (#183).
 *
 * The progress meter was built, shipped, and then orphaned when generation
 * moved into a durable Workflow: a step's return value is the only channel
 * Workflows give, and it arrives once, at the end. `run-progress.ts` is the
 * channel that replaces it, and this is the valve in front of it.
 *
 * The valve is the design, not a detail. A stream calls back on every delta,
 * several times a second, for up to fifteen minutes. Without it the channel
 * would carry thousands of requests per run to produce a number that is read
 * every 1.5 seconds and thrown away.
 */
describe('how often a run reports what it has produced', () => {
  const collect = () => {
    const sent: ProgressReport[] = [];
    let now = 0;
    const report = throttleProgress(
      (r) => sent.push(r),
      PROGRESS_REPORT_INTERVAL_MS,
      () => now,
    );
    return {
      sent,
      report,
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it('reports the first thing it hears without waiting', () => {
    // A reasoning model thinks before it writes, so the second delta can be
    // a long way off. Holding the first one back for an interval would
    // withhold the only news there is at the moment it is most wanted.
    const { sent, report } = collect();
    report({ characters: 0, reasoningCharacters: 12 });
    assert.deepEqual(sent, [{ characters: 0, reasoningCharacters: 12 }]);
  });

  it('drops what would arrive before the next read', () => {
    const { sent, report, advance } = collect();
    report({ characters: 1, reasoningCharacters: 0 });
    advance(PROGRESS_REPORT_INTERVAL_MS - 1);
    report({ characters: 900, reasoningCharacters: 0 });
    report({ characters: 1_800, reasoningCharacters: 0 });
    assert.equal(sent.length, 1, 'the channel carried reports nobody read');
    advance(1);
    report({ characters: 2_700, reasoningCharacters: 0 });
    assert.deepEqual(sent.at(-1), {
      characters: 2_700,
      reasoningCharacters: 0,
    });
  });

  it('never repeats a report, however long it has been', () => {
    // The case the meter exists for: a model that thinks for minutes
    // streams nothing at all. Reporting an unchanged pair once a second for
    // that whole time would spend a request per second to tell the reader
    // what they were already being shown.
    const { sent, report, advance } = collect();
    report({ characters: 0, reasoningCharacters: 5_000 });
    for (let i = 0; i < 60; i += 1) {
      advance(PROGRESS_REPORT_INTERVAL_MS * 10);
      report({ characters: 0, reasoningCharacters: 5_000 });
    }
    assert.equal(sent.length, 1);
  });

  it('counts a provider that says nothing about reasoning as none', () => {
    // `PlanProgress.reasoningCharacters` is optional so that "this provider
    // does not say" stays distinguishable from "it says none" (#190). The
    // channel carries a count, and a count that is sometimes absent would
    // make the reader re-draw that distinction for no purpose -- and would
    // leave `stageFor` comparing undefined against zero.
    const { sent, report } = collect();
    report({ characters: 40 });
    assert.deepEqual(sent, [{ characters: 40, reasoningCharacters: 0 }]);
  });

  it('reports at least as often as the poll loop reads', () => {
    // Not a preference: a valve slower than the read is a reader watching a
    // number that is stale every other poll.
    assert.ok(
      PROGRESS_REPORT_INTERVAL_MS <= POLL_INTERVAL_MS,
      `reporting every ${PROGRESS_REPORT_INTERVAL_MS}ms cannot feed a loop that reads every ${POLL_INTERVAL_MS}ms`,
    );
  });
});

/**
 * That the chain is joined, end to end.
 *
 * This is the finding #183 actually was. Nothing in the meter was missing:
 * the component, the wording, the SSE event, the client's decoder and the
 * provider's per-delta callback all shipped and all still worked. One link
 * was cut, and every piece on either side of it went on passing its own
 * tests for months. Unit tests of the parts cannot catch that, by
 * construction, so the joins are asserted directly.
 *
 * `index.ts` and `generation-workflow.ts` both import `cloudflare:workers`
 * and cannot be loaded under `node --test`, so they are read as source --
 * the same way `access-gate.test.ts` and `client-gone.test.ts` do it.
 */
const worker = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', 'worker', name), 'utf8');

describe('the link between a running step and the reader watching it', () => {
  const workflow = worker('generation-workflow.ts');
  const entrypoint = worker('index.ts');

  it('has the generate step report through the channel', () => {
    assert.match(
      workflow,
      /onProgress/,
      'the provider streams into nothing again, which is the whole of #183',
    );
    assert.match(
      workflow,
      /throttleProgress\(/,
      'reporting every delta would spend thousands of requests a run',
    );
    assert.match(workflow, /RUN_PROGRESS/);
  });

  it('has the poll loop read the channel and say what it found', () => {
    assert.match(
      entrypoint,
      /RUN_PROGRESS\?\.getByName\(runId\)/,
      'the poll loop reads no report, so nothing it writes can carry one',
    );
    assert.match(
      entrypoint,
      /stageFor\(status\.status, report\)/,
      'the report is read but not used to name the stage, so a thinking run still reads as building',
    );
    assert.match(
      entrypoint,
      /report\.characters > 0\s*\?\s*\{ characters: report\.characters \}/,
      'the count is sent unconditionally, so a run that has written nothing reports a confident zero',
    );
  });
});
