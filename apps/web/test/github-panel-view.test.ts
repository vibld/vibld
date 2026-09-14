import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decidePanel } from '../src/github/panel-view.ts';
import type { GitHubStatus } from '../src/github/github-client.ts';

/**
 * What the GitHub panel shows, decided apart from how it is drawn.
 *
 * Four findings on this feature were in `GitHubPanel.tsx` and none of them
 * could be caught by this suite: the runner errors on JSX, so a component is
 * typechecked and never exercised. Each was a decision rather than a
 * rendering problem, so the decisions live here now, where they can be run.
 *
 * Every case below is one of those findings or the behaviour it broke.
 */

const CONFIGURED: GitHubStatus = {
  configured: true,
  canPush: true,
  canConnect: true,
  connected: false,
  reason: 'none',
};

const CONNECTED: GitHubStatus = {
  ...CONFIGURED,
  connected: true,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
};

describe('whether the panel appears at all', () => {
  it('shows nothing while the first read is in flight', () => {
    assert.deepEqual(decidePanel({ at: 'loading' }, null), { show: false });
  });

  it('stays hidden even once the status has arrived', () => {
    // The status request and the callback exchange run alongside each other,
    // so the status can land first. Showing "Connect a repository" then
    // offers a button that throws away a handoff still being completed.
    assert.deepEqual(decidePanel({ at: 'loading' }, CONFIGURED), {
      show: false,
    });
    assert.deepEqual(decidePanel({ at: 'loading' }, CONNECTED), {
      show: false,
    });
  });

  it('shows nothing on a deployment without GitHub configured', () => {
    assert.deepEqual(decidePanel({ at: 'idle' }, null), { show: false });
    assert.deepEqual(decidePanel({ at: 'idle' }, { configured: false }), {
      show: false,
    });
  });

  it('shows a connection in flight even when the status never arrived', () => {
    // The finding: a transient `/api/github/status` failure hid the panel
    // after the exchange had already succeeded, stranding somebody whose code
    // and state were spent, holding a ticket they could not see.
    for (const phase of [
      { at: 'working' as const, note: 'Finishing…' },
      { at: 'problem' as const, error: 'something went wrong' },
      {
        at: 'choosing' as const,
        offer: { repositories: [], ticket: 'tkt' },
      },
    ]) {
      const view = decidePanel(phase, null);
      assert.equal(view.show, true, `${phase.at} was hidden`);
    }
  });
});

describe('offering a way out of a failure', () => {
  it('offers a retry when the status never arrived', () => {
    // The finding: the code is spent by the time a completion fails, so "try
    // again" means a fresh authorization. Gating that on a status request
    // that may itself have failed left a page reload as the only escape.
    const view = decidePanel({ at: 'problem', error: 'nope' }, null);
    assert.equal(view.show && view.problem?.retry, true);
  });

  it('offers a retry when the deployment says connecting works', () => {
    const view = decidePanel({ at: 'problem', error: 'nope' }, CONFIGURED);
    assert.equal(view.show && view.problem?.retry, true);
  });

  it('does not offer one the deployment could not honour', () => {
    const view = decidePanel(
      { at: 'problem', error: 'nope' },
      { ...CONFIGURED, canConnect: false },
    );
    assert.equal(view.show && view.problem?.retry, false);
  });

  it('passes the install hint through so the panel can link to it', () => {
    const view = decidePanel(
      { at: 'problem', error: 'not installed', install: true },
      CONFIGURED,
    );
    assert.equal(view.show && view.problem?.install, true);
  });
});

describe('describing a connected repository', () => {
  it('says it is pushing when pushing is configured', () => {
    const view = decidePanel({ at: 'idle' }, CONNECTED);
    assert.equal(view.show && view.summary?.connected, true);
    if (view.show && view.summary?.connected) {
      assert.equal(view.summary.canPush, true);
      assert.equal(view.summary.owner, 'acme');
      assert.equal(view.summary.repo, 'site');
    }
  });

  it('does not claim to push on a deployment that cannot', () => {
    // The finding: with the OAuth half and no App key, binding works and
    // every push answers 503, and the panel still said "Pushing to".
    const view = decidePanel({ at: 'idle' }, { ...CONNECTED, canPush: false });
    assert.equal(view.show && view.summary?.connected, true);
    if (view.show && view.summary?.connected) {
      assert.equal(view.summary.canPush, false);
    }
  });

  it('offers connecting when nothing is connected and it is configured', () => {
    const view = decidePanel({ at: 'idle' }, CONFIGURED);
    assert.equal(view.show && view.summary?.connected, false);
    if (view.show && view.summary && !view.summary.connected) {
      assert.equal(view.summary.canConnect, true);
    }
  });

  it('says so rather than offering a button that cannot work', () => {
    const view = decidePanel(
      { at: 'idle' },
      { ...CONFIGURED, canConnect: false },
    );
    if (view.show && view.summary && !view.summary.connected) {
      assert.equal(view.summary.canConnect, false);
    }
  });
});

describe('what is shown beside what', () => {
  it('leaves the summary out while a choice is being made', () => {
    const view = decidePanel(
      { at: 'choosing', offer: { repositories: [], ticket: 'tkt' } },
      CONNECTED,
    );
    assert.equal(view.show && view.summary, undefined);
    assert.ok(view.show && view.picker);
  });

  it('leaves the summary out while something is in progress', () => {
    const view = decidePanel({ at: 'working', note: 'Connecting…' }, CONNECTED);
    assert.equal(view.show && view.summary, undefined);
    assert.equal(view.show && view.working, 'Connecting…');
  });

  it('keeps the summary beside a failure, so the state stays visible', () => {
    // A failed disconnect should still show what is connected.
    const view = decidePanel({ at: 'problem', error: 'nope' }, CONNECTED);
    assert.ok(view.show && view.problem);
    assert.equal(view.show && view.summary?.connected, true);
  });

  it('shows a failure with no summary when the status never arrived', () => {
    const view = decidePanel({ at: 'problem', error: 'nope' }, null);
    assert.ok(view.show && view.problem);
    assert.equal(view.show && view.summary, undefined);
  });
});
