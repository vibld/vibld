import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CaseOutcome, CaseResult } from '../src/harness.ts';
import { formatStability, stability } from '../src/report.ts';

function result(id: string, outcome: CaseOutcome): CaseResult {
  return { id, outcome, durationMs: 1, problems: [], estimatedTokens: 1 };
}

describe('stability', () => {
  it('groups runs by case, in the order the cases first ran', () => {
    const rows = stability([
      result('marketing', 'accepted'),
      result('marketing', 'failed-expectations'),
      result('coffee', 'accepted'),
      result('marketing', 'accepted'),
    ]);
    assert.deepEqual(
      rows.map((row) => [row.id, row.accepted, row.runs]),
      [
        ['marketing', 2, 3],
        ['coffee', 1, 1],
      ],
    );
  });

  it('keeps the outcomes in run order', () => {
    const rows = stability([
      result('marketing', 'failed-provider'),
      result('marketing', 'accepted'),
    ]);
    assert.deepEqual(rows[0]!.outcomes, ['failed-provider', 'accepted']);
  });
});

describe('formatStability', () => {
  it('says nothing when nothing was repeated', () => {
    // A single run has no variance to report, and a table saying "1/1" for
    // every case would be noise printed under every ordinary live run.
    const table = formatStability(
      stability([
        result('marketing', 'accepted'),
        result('coffee', 'accepted'),
      ]),
    );
    assert.equal(table, '');
  });

  it('names every outcome only where the runs disagreed', () => {
    // The whole reason to pay for repeats: 3/3 and 2/3 are the same line in a
    // pooled score and completely different answers. The unanimous row stays
    // a tally so the row that varied is the one that stands out.
    const table = formatStability(
      stability([
        result('marketing', 'accepted'),
        result('marketing', 'failed-expectations'),
        result('marketing', 'accepted'),
        result('coffee', 'accepted'),
        result('coffee', 'accepted'),
        result('coffee', 'accepted'),
      ]),
    );
    assert.match(
      table,
      /marketing: 2\/3 accepted \(accepted, ignored the request, accepted\)/,
    );
    assert.match(table, /coffee: 3\/3 accepted$/m);
  });
});

describe('formatStability, a case that never varied', () => {
  it('prints the tally alone when every run failed the same way', () => {
    // As unanimous as three acceptances, and the tally already says so.
    // Comparing accepted against runs called this varied and printed
    // "provider error" three times, which is the noise the rule exists to
    // suppress, in the row that needed it least.
    const table = formatStability(
      stability([
        result('marketing', 'failed-provider'),
        result('marketing', 'failed-provider'),
        result('marketing', 'failed-provider'),
      ]),
    );
    assert.match(table, /marketing: 0\/3 accepted$/m);
  });

  it('still names the outcomes when a failing case failed differently', () => {
    const table = formatStability(
      stability([
        result('marketing', 'failed-provider'),
        result('marketing', 'failed-validation'),
      ]),
    );
    assert.match(
      table,
      /marketing: 0\/2 accepted \(provider error, failed validation\)/,
    );
  });
});
