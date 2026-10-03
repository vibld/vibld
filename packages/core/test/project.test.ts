import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PROJECT_NAME,
  MAX_TRANSCRIPT_FIELD_CHARS,
  MAX_TRANSCRIPT_TURNS,
  PROJECT_NAME_MAX_CHARS,
  cleanProjectName,
  clipTranscriptTurn,
  copyName,
  UNSEEN_FAILURE,
  parseTranscript,
  reconciledTranscript,
  remixName,
  settledTranscript,
} from '../src/project.ts';
import type { TranscriptTurn } from '../src/project.ts';

/**
 * The shape a project's conversation is written down in, which the builder
 * writes and the Worker keeps. What matters is that the two agree: a turn
 * the builder produces is always one the Worker accepts, and nothing beyond
 * that shape is ever stored.
 */

const turn = (over: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id: 1,
  runId: 'run-1',
  prompt: 'A landing page for a bakery',
  at: 1_790_000_000_000,
  status: 'accepted',
  agentMessage: null,
  summary: 'A one-page site with a menu and opening hours.',
  fileCount: 4,
  revision: 'r1',
  problem: null,
  providerId: 'remote',
  ...over,
});

describe('reading a transcript', () => {
  it('keeps every turn the builder writes, exactly', () => {
    const turns = [
      turn(),
      turn({
        id: 2,
        runId: 'chat-1',
        status: 'replied',
        agentMessage: 'Do you want a booking form?',
        summary: null,
        fileCount: 0,
        revision: null,
      }),
    ];
    assert.deepEqual(parseTranscript(turns), { ok: true, turns });
  });

  it('stores only the known fields, whatever else was sent', () => {
    const parsed = parseTranscript([{ ...turn(), secret: 'x', html: '<p>' }]);
    assert.ok(parsed.ok);
    assert.deepEqual(Object.keys(parsed.turns[0]!).sort(), [
      'agentMessage',
      'at',
      'fileCount',
      'id',
      'problem',
      'prompt',
      'providerId',
      'revision',
      'runId',
      'status',
      'summary',
    ]);
  });

  it('reads an absent agent message as none', () => {
    const { agentMessage: _dropped, ...older } = turn();
    const parsed = parseTranscript([older]);
    assert.ok(parsed.ok);
    assert.equal(parsed.turns[0]!.agentMessage, null);
  });

  it('refuses rather than filters what it cannot read', () => {
    for (const bad of [
      'not a list',
      [null],
      [{ ...turn(), status: 'finished' }],
      [{ ...turn(), id: 'one' }],
      [{ ...turn(), at: Number.NaN }],
      [{ ...turn(), prompt: 7 }],
      [{ ...turn(), summary: 'x'.repeat(MAX_TRANSCRIPT_FIELD_CHARS + 1) }],
    ]) {
      const parsed = parseTranscript(bad);
      assert.equal(parsed.ok, false, JSON.stringify(bad).slice(0, 60));
    }
  });

  it('bounds how many turns one transcript holds', () => {
    const many = Array.from({ length: MAX_TRANSCRIPT_TURNS + 1 }, (_, i) =>
      turn({ id: i }),
    );
    assert.equal(parseTranscript(many).ok, false);
  });

  it('accepts whatever the builder clips for saving', () => {
    const long = turn({
      summary: 'y'.repeat(MAX_TRANSCRIPT_FIELD_CHARS * 2),
      problem: 'z'.repeat(MAX_TRANSCRIPT_FIELD_CHARS + 5),
    });
    const clipped = clipTranscriptTurn(long);
    assert.equal(clipped.summary!.length, MAX_TRANSCRIPT_FIELD_CHARS);
    assert.ok(parseTranscript([clipped]).ok);
  });
});

describe('a transcript read back after the page that wrote it has gone', () => {
  it('shows a turn that was still running as cancelled', () => {
    const settled = settledTranscript([
      turn(),
      turn({ id: 2, status: 'running' }),
    ]);
    assert.deepEqual(
      settled.map((t) => t.status),
      ['accepted', 'cancelled'],
    );
  });

  it('leaves a build the Worker is still running for the builder to ask after', () => {
    // A build that had been admitted outlives its page (docs/decisions.md,
    // "Resolved 2026-09-29", keep building). Reading it as cancelled would
    // tell somebody a build had stopped that was about to change their code.
    const settled = settledTranscript([
      turn(),
      turn({ id: 2, status: 'running', serverRunId: 'wf-2' }),
    ]);
    assert.equal(settled[1]!.status, 'running');
  });

  it('keeps the build id through a save and a read', () => {
    const saved = clipTranscriptTurn(
      turn({ status: 'running', serverRunId: 'wf-2' }),
    );
    const read = parseTranscript([saved]);
    assert.ok(read.ok);
    assert.equal(read.turns[0]!.serverRunId, 'wf-2');
    // And a turn without one is stored without one, not with a null.
    const plain = parseTranscript([turn()]);
    assert.ok(plain.ok);
    assert.equal('serverRunId' in plain.turns[0]!, false);
  });

  it('keeps the revision a build started from through a save and a read', () => {
    const read = parseTranscript([
      clipTranscriptTurn(turn({ baseRevision: 'r1' })),
    ]);
    assert.ok(read.ok);
    assert.equal(read.turns[0]!.baseRevision, 'r1');
    const plain = parseTranscript([turn()]);
    assert.ok(plain.ok);
    assert.equal('baseRevision' in plain.turns[0]!, false);
    assert.equal(
      parseTranscript([turn({ baseRevision: 7 as never })]).ok,
      false,
    );
  });
});

describe('settling a build the page did not see finish', () => {
  const running = [
    turn(),
    turn({
      id: 2,
      status: 'running',
      revision: null,
      fileCount: 0,
      serverRunId: 'wf-2',
    }),
  ];

  it('reads as accepted, at its revision, when it moved the project', () => {
    const settled = reconciledTranscript(running, 'wf-2', {
      state: 'accepted',
      revision: 'r2',
      fileCount: 7,
    });
    assert.equal(settled[1]!.status, 'accepted');
    assert.equal(settled[1]!.revision, 'r2');
    assert.equal(settled[1]!.fileCount, 7);
    assert.deepEqual(settled[0], running[0], 'an earlier turn was rewritten');
  });

  it('keeps what the build said it made, where the Worker could say', () => {
    // A turn settled by asking used to read "9 files" and nothing else, and
    // the agent was told only "Built it (9 files)".
    const settled = reconciledTranscript(running, 'wf-2', {
      state: 'accepted',
      revision: 'r2',
      fileCount: 9,
      summary: 'A bakery site with a menu page.',
    });
    assert.equal(settled[1]!.summary, 'A bakery site with a menu page.');
    const unsaid = reconciledTranscript(running, 'wf-2', {
      state: 'accepted',
      revision: 'r2',
    });
    assert.equal(unsaid[1]!.summary, running[1]!.summary);
  });

  it('reads as failed or cancelled otherwise', () => {
    const failed = reconciledTranscript(running, 'wf-2', { state: 'failed' });
    assert.equal(failed[1]!.status, 'failed');
    assert.equal(failed[1]!.problem, UNSEEN_FAILURE);
    const cancelled = reconciledTranscript(running, 'wf-2', {
      state: 'cancelled',
    });
    assert.equal(cancelled[1]!.status, 'cancelled');
  });

  it('touches only the running turn for that build', () => {
    // Another build's answer, or a late one about a turn that already
    // ended, changes nothing.
    assert.deepEqual(
      reconciledTranscript(running, 'wf-9', { state: 'failed' }),
      running,
    );
    const ended = [turn({ status: 'cancelled', serverRunId: 'wf-2' })];
    assert.deepEqual(
      reconciledTranscript(ended, 'wf-2', {
        state: 'accepted',
        revision: 'r2',
      }),
      ended,
    );
  });
});

describe('project names', () => {
  it('has a default for a project nobody named', () => {
    assert.equal(DEFAULT_PROJECT_NAME, 'Untitled project');
  });

  it('keeps a name on one line and within its bound', () => {
    assert.equal(cleanProjectName('  My\n\tbakery   site '), 'My bakery site');
    assert.equal(
      cleanProjectName('x'.repeat(PROJECT_NAME_MAX_CHARS + 40))!.length,
      PROJECT_NAME_MAX_CHARS,
    );
  });

  it('treats a blank or non-text name as none', () => {
    for (const blank of ['', '   ', '\n', 42, null, undefined]) {
      assert.equal(cleanProjectName(blank), null);
    }
  });

  it('marks a copy, and never lets the mark push it past the bound', () => {
    assert.equal(copyName('Bakery'), 'Bakery (copy)');
    const long = copyName('x'.repeat(PROJECT_NAME_MAX_CHARS));
    assert.equal(long.length, PROJECT_NAME_MAX_CHARS);
    assert.ok(long.endsWith(' (copy)'));
  });

  it('names a remix for where it came from, within the bound', () => {
    assert.equal(remixName('Bakery'), 'Remix of Bakery');
    const long = remixName('x'.repeat(PROJECT_NAME_MAX_CHARS));
    assert.equal(long.length, PROJECT_NAME_MAX_CHARS);
    assert.ok(long.startsWith('Remix of '));
  });
});
