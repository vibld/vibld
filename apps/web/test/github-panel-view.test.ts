import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createStatusGate,
  decidePanel,
  NOTHING_PUSHABLE,
} from '../src/github/panel-view.ts';
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

const CHOICE = {
  installationId: 1,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
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
        offer: { repositories: [CHOICE], ticket: 'tkt' },
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
      assert.equal(view.summary.pushing, 'yes');
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
      assert.equal(view.summary.pushing, 'no');
    }
  });

  it('makes no claim either way when nothing said', () => {
    // The finding: a bind whose status probe and post-bind refresh both
    // failed is shown from the write's own reply, which says what was bound
    // and nothing about the deployment. Reading that silence as "no" told
    // somebody pushing was unconfigured on a deployment that pushes fine.
    // Unknown has to stay unknown, because only one of the three says
    // anything worth printing.
    const { canPush: _unstated, ...unsaid } = CONNECTED;
    const view = decidePanel({ at: 'idle' }, unsaid);
    assert.equal(view.show && view.summary?.connected, true);
    if (view.show && view.summary?.connected) {
      assert.equal(view.summary.pushing, 'unknown');
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

  it('offers connecting rather than stranding somebody on a silence', () => {
    // Unknown goes the other way here than it does for pushing, and for a
    // reason: an offered button that turns out not to work answers with the
    // reason, while a withheld one leaves no route anywhere. The same rule
    // the retry uses.
    const { canConnect: _unstated, ...unsaid } = CONFIGURED;
    const view = decidePanel({ at: 'idle' }, unsaid);
    if (view.show && view.summary && !view.summary.connected) {
      assert.equal(view.summary.canConnect, true);
    }
  });
});

describe('what a Disconnect would end', () => {
  it('names the repository, so the route can refuse a stale one', () => {
    const view = decidePanel({ at: 'idle' }, CONNECTED);
    assert.deepEqual(
      view.show && view.summary?.connected === true
        ? view.summary.disconnect
        : null,
      { owner: 'acme', repo: 'site' },
    );
  });

  it('offers nothing to end when the name is only half there', () => {
    // The route refuses a disconnect that does not say which repository it
    // is for, so a button with no name to send would be offering something
    // that cannot work. A status saying `connected` always carries both, so
    // this is a reply that has already contradicted itself.
    const half = decidePanel({ at: 'idle' }, { ...CONNECTED, repo: undefined });
    assert.equal(
      half.show && half.summary?.connected === true
        ? half.summary.disconnect
        : 'wrong shape',
      undefined,
    );
  });
});

describe('which answer about the connection is allowed to win', () => {
  // The finding: the status probe starts alongside the callback exchange, so
  // it can still be in flight when a repository is bound and land afterwards
  // carrying what it read before the write. The panel then replaced a
  // confirmed repository with `connected: false`, making a write that landed
  // look like one that never happened.

  it('lets a read commit when nothing has been written since', () => {
    const gate = createStatusGate();
    const commit = gate.begin();
    assert.equal(commit(), true);
  });

  it('discards a read that a write overtook', () => {
    const gate = createStatusGate();
    const commit = gate.begin();
    gate.supersede();
    assert.equal(commit(), false);
  });

  it('discards it however long the read sat there', () => {
    const gate = createStatusGate();
    const commit = gate.begin();
    gate.supersede();
    gate.supersede();
    assert.equal(commit(), false);
  });

  it("lets the write's own refresh commit", () => {
    // A mutation supersedes the reads before it and then reads again; that
    // later read is the newest thing there is and must be allowed through,
    // or the panel would never pick up anything the server corrected.
    const gate = createStatusGate();
    gate.supersede();
    const refresh = gate.begin();
    assert.equal(refresh(), true);
  });

  it("lets a second write overtake the first write's refresh", () => {
    const gate = createStatusGate();
    gate.supersede();
    const refresh = gate.begin();
    gate.supersede();
    assert.equal(refresh(), false);
  });

  it('keeps two reads in flight independent of each other', () => {
    const gate = createStatusGate();
    const first = gate.begin();
    const second = gate.begin();
    assert.equal(first(), true);
    assert.equal(second(), true);
    gate.supersede();
    assert.equal(first(), false);
    assert.equal(second(), false);
  });
});

describe('an exchange that found nothing to offer', () => {
  // The finding: a successful completion with no pushable repositories left
  // an alert and nothing else. The picker draws no buttons for an empty
  // list, and the summary carrying the Connect button was suppressed because
  // the phase was `choosing`. The ticket is signed and empty, so it cannot
  // pick up access granted afterwards: without an action here the only way
  // on was a page reload.
  const EMPTY = {
    at: 'choosing' as const,
    offer: { repositories: [], ticket: 'tkt' },
  };

  it('offers a way to start again', () => {
    const view = decidePanel(EMPTY, CONFIGURED);
    assert.equal(view.show && view.problem?.retry, true);
  });

  it('links to where the access is actually granted', () => {
    const view = decidePanel(EMPTY, CONFIGURED);
    assert.equal(view.show && view.problem?.install, true);
    assert.equal(view.show && view.problem?.error, NOTHING_PUSHABLE);
  });

  it('draws no picker, because there is nothing to pick', () => {
    const view = decidePanel(EMPTY, CONFIGURED);
    assert.equal(view.show && view.picker, undefined);
  });

  it('keeps a connected repository visible beside it', () => {
    // It is a failure, not a choice, so the rule that keeps the summary
    // beside a failure applies: whatever is already connected stays on
    // screen rather than vanishing behind an empty offer.
    const view = decidePanel(EMPTY, CONNECTED);
    assert.equal(view.show && view.summary?.connected, true);
  });

  it('withholds the retry the deployment could not honour', () => {
    const view = decidePanel(EMPTY, { ...CONFIGURED, canConnect: false });
    assert.equal(view.show && view.problem?.retry, false);
  });
});

describe('accounts the read budget never reached', () => {
  // The finding: without an installation hint, and GitHub's callback carries
  // none once the App is already installed, the server's budget stops at ten
  // and everything past it is dropped. The user token is discarded by then,
  // so those repositories cannot be fetched afterwards: a short list that
  // looks exactly like a complete one, permanently.
  const OMITTED = {
    at: 'choosing' as const,
    offer: {
      repositories: [CHOICE],
      ticket: 'tkt',
      omitted: ['globex', 'initech'],
    },
  };

  it('names them beside the offer', () => {
    const view = decidePanel(OMITTED, CONFIGURED);
    assert.deepEqual(view.show && view.omitted, ['globex', 'initech']);
    assert.ok(view.show && view.picker, 'the offer itself went missing');
  });

  it('says nothing when the budget reached everything', () => {
    const view = decidePanel(
      { at: 'choosing', offer: { repositories: [CHOICE], ticket: 'tkt' } },
      CONFIGURED,
    );
    assert.equal(view.show && view.omitted, undefined);
  });

  it('treats an empty list as nothing to say, not as something to draw', () => {
    // The first version of the test above passed whether or not the guard
    // was there, because assigning `undefined` and assigning nothing are the
    // same to it. An empty array is what the guard actually stops, and
    // letting one through leaves the panel drawing a sentence about no
    // accounts.
    const view = decidePanel(
      {
        at: 'choosing',
        offer: { repositories: [CHOICE], ticket: 'tkt', omitted: [] },
      },
      CONFIGURED,
    );
    assert.equal(view.show && view.omitted, undefined);
  });

  it('still names them when the offer itself is empty', () => {
    // The case where saying so matters most: "none of these are pushable"
    // and "Vibld did not look at two of your accounts" are different
    // sentences, and only the second one has a route out of it.
    const view = decidePanel(
      {
        at: 'choosing',
        offer: { repositories: [], ticket: 'tkt', omitted: ['globex'] },
      },
      CONFIGURED,
    );
    assert.deepEqual(view.show && view.omitted, ['globex']);
    assert.ok(view.show && view.problem, 'the empty offer lost its remedy');
  });
});

describe('a list GitHub paginates that was cut short', () => {
  // Separate from an omitted account, and the difference is the remedy.
  // Installing again reaches a skipped account, because a named installation
  // is read outside the budget. It does nothing for a page bound inside a
  // list: the next read follows the same bound. Offering the install button
  // here would be offering something that cannot work.
  it('says so', () => {
    const view = decidePanel(
      {
        at: 'choosing',
        offer: { repositories: [CHOICE], ticket: 'tkt', truncated: true },
      },
      CONFIGURED,
    );
    assert.equal(view.show && view.truncated, true);
  });

  it('says nothing when nothing was cut short', () => {
    const view = decidePanel(
      { at: 'choosing', offer: { repositories: [CHOICE], ticket: 'tkt' } },
      CONFIGURED,
    );
    assert.equal(view.show && view.truncated, undefined);
  });

  it('is reported apart from the accounts that were skipped', () => {
    const view = decidePanel(
      {
        at: 'choosing',
        offer: { repositories: [CHOICE], ticket: 'tkt', omitted: ['globex'] },
      },
      CONFIGURED,
    );
    assert.deepEqual(view.show && view.omitted, ['globex']);
    assert.equal(view.show && view.truncated, undefined);
  });
});

describe('what is shown beside what', () => {
  it('leaves the summary out while a choice is being made', () => {
    const view = decidePanel(
      { at: 'choosing', offer: { repositories: [CHOICE], ticket: 'tkt' } },
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
