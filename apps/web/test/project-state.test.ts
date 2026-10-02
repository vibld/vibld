import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TranscriptTurn } from '@vibld/core';

import {
  changedSince,
  formatEdited,
  marksFor,
  pathAction,
  settingsToRestore,
} from '../src/projects/project-state.ts';
import {
  isProjectsPath,
  projectIdFromPath,
  projectPath,
  withPath,
} from '../src/projects/project-route.ts';
import type {
  ProjectSettings,
  ProjectSummary,
} from '../src/projects/projects-client.ts';

/**
 * The decisions behind opening a project and saving it, apart from React:
 * what the address means, what opening puts back, and what counts as a
 * change worth saving.
 */

const NOTHING: ProjectSettings = {
  style: null,
  referenceUrl: null,
  model: null,
  knowledge: null,
  styleDna: null,
};

const summary = (over: Partial<ProjectSummary>): ProjectSummary => ({
  id: 'p1',
  name: 'Bakery',
  archived: false,
  archivedAt: null,
  createdAt: '2026-09-28T12:00:00.000Z',
  editedAt: '2026-09-28T12:00:00.000Z',
  lastOpenedAt: '2026-09-28T12:00:00.000Z',
  hasCode: false,
  turns: 0,
  settings: NOTHING,
  ...over,
});

const turn = (over: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id: 1,
  runId: 'run-1',
  prompt: 'A bakery',
  at: 1,
  status: 'accepted',
  agentMessage: null,
  summary: 'Built it.',
  fileCount: 1,
  revision: 'r1',
  problem: null,
  providerId: 'remote',
  ...over,
});

describe('the address of a project', () => {
  it('is /p/<id>, and the list is /projects', () => {
    assert.equal(projectPath('a b'), '/p/a%20b');
    assert.equal(projectIdFromPath('/p/a%20b'), 'a b');
    assert.equal(projectIdFromPath('/p/abc/'), 'abc');
    assert.equal(projectIdFromPath('/p/abc/more'), null);
    assert.equal(projectIdFromPath('/p/'), null);
    assert.equal(projectIdFromPath('/'), null);
    assert.ok(isProjectsPath('/projects'));
    assert.ok(isProjectsPath('/projects/'));
    assert.ok(!isProjectsPath('/projectsx'));
  });

  it('keeps the fragment and the query when the path is corrected', () => {
    // The GitHub callback leaves its code in the fragment, and a Stripe
    // return carries a query: rewriting `/` must not eat either.
    assert.equal(
      withPath({ search: '?checkout=done', hash: '#code=x' }, '/p/abc'),
      '/p/abc?checkout=done#code=x',
    );
  });
});

describe('what an address asks for', () => {
  const list = [
    summary({ id: 'archived', archived: true }),
    summary({ id: 'recent' }),
    summary({ id: 'older' }),
  ];

  it('opens the project it names, unless it is already open', () => {
    assert.deepEqual(pathAction('/p/older', false, 'recent', list), {
      kind: 'open',
      id: 'older',
    });
    assert.deepEqual(pathAction('/p/recent', false, 'recent', list), {
      kind: 'none',
    });
  });

  it('shows the list, and leaves the admin page alone', () => {
    assert.deepEqual(pathAction('/projects', false, 'recent', list), {
      kind: 'list',
    });
    assert.deepEqual(pathAction('/admin', true, null, list), { kind: 'none' });
  });

  it('on a load with no project named, opens the most recently opened active one', () => {
    assert.deepEqual(pathAction('/', false, null, list), {
      kind: 'open-recent',
      id: 'recent',
    });
  });

  it('with a project already open, only puts its address back', () => {
    assert.deepEqual(pathAction('/', false, 'older', list), {
      kind: 'address',
      id: 'older',
    });
  });

  it('makes a project for an account with no active one', () => {
    assert.deepEqual(
      pathAction('/', false, null, [summary({ archived: true })]),
      { kind: 'create' },
    );
    assert.deepEqual(pathAction('/', false, null, []), { kind: 'create' });
  });
});

describe('what opening a project puts back', () => {
  const defaults = {
    model: 'browser-model',
    knowledge: 'From this browser.',
    styleDna: { corners: 'round' },
  };
  const offered = [{ id: 'project-model' }, { id: 'browser-model' }];

  it("uses the project's own choices where it made them", () => {
    const restored = settingsToRestore(
      {
        style: 'brutalism',
        referenceUrl: 'https://example.com/',
        model: 'project-model',
        knowledge: '',
        styleDna: {},
      },
      defaults,
      offered,
      'current-model',
    );
    assert.deepEqual(restored, {
      style: 'brutalism',
      referenceUrl: 'https://example.com/',
      model: 'project-model',
      // Emptied on purpose is kept empty: the browser's does not return.
      knowledge: '',
      styleDna: {},
      galleryStyle: null,
    });
  });

  it("fills what it never chose from this browser's last choice", () => {
    const restored = settingsToRestore(NOTHING, defaults, offered, null);
    assert.equal(restored.model, 'browser-model');
    assert.equal(restored.knowledge, 'From this browser.');
    assert.deepEqual(restored.styleDna, { corners: 'round' });
    assert.equal(restored.referenceUrl, '');
    assert.equal(restored.style, null);
  });

  it('keeps the current model when the saved one is no longer offered', () => {
    const restored = settingsToRestore(
      { ...NOTHING, model: 'retired-model' },
      defaults,
      offered,
      'current-model',
    );
    assert.equal(restored.model, 'current-model');
  });

  it('restores the saved model before the offer is known, for the probe to check', () => {
    const restored = settingsToRestore(
      { ...NOTHING, model: 'project-model' },
      defaults,
      [],
      null,
    );
    assert.equal(restored.model, 'project-model');
  });
});

describe('what counts as a change worth saving', () => {
  const settings = {
    style: null,
    referenceUrl: null,
    model: 'm',
    knowledge: '',
    styleDna: {},
    galleryStyle: null,
  };

  it('is nothing, for a project exactly as it was opened', () => {
    const saved = { ...NOTHING, model: 'm', knowledge: '', styleDna: {} };
    assert.equal(
      changedSince(marksFor(saved, [turn()]), settings, [turn()]),
      null,
    );
  });

  it('is a setting the project never had, filled from this browser, once', () => {
    const marks = marksFor(NOTHING, []);
    const first = changedSince(marks, settings, []);
    assert.deepEqual(first?.patch, {
      settings: {
        style: null,
        referenceUrl: null,
        model: 'm',
        knowledge: '',
        styleDna: {},
        galleryStyle: null,
      },
    });
    assert.equal(changedSince(first!.marks, settings, []), null);
  });

  it('waits for a turn to settle before saving the conversation', () => {
    const marks = marksFor(
      { ...NOTHING, model: 'm', knowledge: '', styleDna: {} },
      [],
    );
    const running = [turn({ status: 'running', revision: null })];
    assert.equal(changedSince(marks, settings, running), null);
    const settled = [turn()];
    assert.deepEqual(changedSince(marks, settings, settled)?.patch, {
      transcript: settled,
    });
  });

  it('saves a build the Worker has admitted while it is still running', () => {
    // It outlives the page (docs/decisions.md, "Resolved 2026-09-29", keep
    // building), so a reload has to find its turn to show it running and
    // settle it; a turn not saved is a prompt that vanishes from the
    // conversation while its build changes the code.
    const marks = marksFor(
      { ...NOTHING, model: 'm', knowledge: '', styleDna: {} },
      [],
    );
    const admitted = [
      turn({ status: 'running', revision: null, serverRunId: 'wf-1' }),
    ];
    const changed = changedSince(marks, settings, admitted);
    assert.equal(changed?.patch.transcript?.[0]?.serverRunId, 'wf-1');
    assert.equal(changed?.patch.transcript?.[0]?.status, 'running');
  });

  it('saves again a turn that was saved running and reads back cancelled', () => {
    const marks = marksFor(
      { ...NOTHING, model: 'm', knowledge: '', styleDna: {} },
      [turn({ status: 'running' })],
    );
    const changed = changedSince(marks, settings, [
      turn({ status: 'cancelled' }),
    ]);
    assert.equal(changed?.patch.transcript?.[0]?.status, 'cancelled');
  });
});

describe('when a project was last edited', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  it('reads as a person would say it', () => {
    assert.equal(formatEdited('2026-09-28T11:59:40.000Z', now), 'just now');
    assert.equal(
      formatEdited('2026-09-28T11:57:00.000Z', now),
      '3 minutes ago',
    );
    assert.equal(formatEdited('2026-09-28T10:00:00.000Z', now), '2 hours ago');
    assert.equal(formatEdited('2026-09-27T11:00:00.000Z', now), 'yesterday');
    assert.equal(formatEdited('2026-09-24T12:00:00.000Z', now), '4 days ago');
    assert.match(formatEdited('2026-08-01T12:00:00.000Z', now), /2026/);
  });
});
