import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  afterConnectionChanged,
  decidePreview,
  decidePush,
  previewIsEmpty,
} from '../src/github/push-view.ts';
import type { GitHubStatus } from '../src/github/github-client.ts';

/**
 * Whether to offer a push, decided apart from the button that draws it.
 *
 * The runner strips TypeScript types and errors on JSX, so a rule written
 * inside a component is typechecked and never run. Four findings on #122
 * were exactly that, so these live here from the start rather than after a
 * reviewer finds them.
 */

/** The repository `CONNECTED` names, as a push records where it went. */
const HERE = { owner: 'acme', repo: 'site' };

const CONNECTED: GitHubStatus = {
  configured: true,
  canPush: true,
  canConnect: true,
  connected: true,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
  reason: 'none',
};

describe('whether there is anything to offer', () => {
  it('offers a push to the connected repository', () => {
    const view = decidePush({ at: 'idle' }, CONNECTED);
    assert.equal(view.show, true);
    if (view.show)
      assert.deepEqual(view.destination, { owner: 'acme', repo: 'site' });
  });

  it('offers nothing on a deployment without GitHub configured', () => {
    assert.deepEqual(decidePush({ at: 'idle' }, null), { show: false });
    assert.deepEqual(decidePush({ at: 'idle' }, { configured: false }), {
      show: false,
    });
  });

  it('offers nothing when no repository is connected', () => {
    // Unlike the connect panel's retry, there is no useful button here
    // without a destination: a push with nowhere to go is not a route out of
    // anything, it is a 409.
    const view = decidePush({ at: 'idle' }, { ...CONNECTED, connected: false });
    assert.deepEqual(view, { show: false });
  });

  it('offers nothing when the deployment says it cannot push', () => {
    // It answers 503, and the connect panel already says why.
    const view = decidePush({ at: 'idle' }, { ...CONNECTED, canPush: false });
    assert.deepEqual(view, { show: false });
  });

  it('still offers one when the status did not say either way', () => {
    // `!== false`, the same rule the connect retry uses. A missing field is
    // not a refusal, and withholding the whole feature over one would hide
    // it for a reason nobody could see.
    const { canPush: _unsaid, ...quiet } = CONNECTED;
    const view = decidePush({ at: 'idle' }, quiet);
    assert.equal(view.show, true);
  });

  it('offers nothing when the destination has no name', () => {
    // A button that pushes somewhere it cannot name is worse than no button.
    const { repo: _gone, ...nameless } = CONNECTED;
    assert.deepEqual(decidePush({ at: 'idle' }, nameless), { show: false });
  });
});

describe('while a push is in flight', () => {
  it('says so, rather than letting it be pressed twice', () => {
    const view = decidePush({ at: 'pushing', to: HERE }, CONNECTED);
    assert.equal(view.show && view.busy, true);
  });

  it('is not busy when nothing is happening', () => {
    const view = decidePush({ at: 'idle' }, CONNECTED);
    assert.equal(view.show && view.busy, false);
  });
});

describe('what it says about a push that happened', () => {
  it('names the branch it wrote', () => {
    const view = decidePush(
      {
        at: 'done',
        to: HERE,
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: true },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.outcome?.branch, 'vibld/r7');
    assert.equal(view.show && view.outcome?.created, true);
  });

  it('keeps "already there" apart from "pushed"', () => {
    // The route distinguishes them because they are different things to be
    // told: one moved the work, the other found it already moved. That is
    // what a retry looks like when the first reply was lost, and reporting
    // it as a fresh push sends somebody looking for a commit that is not
    // there.
    const view = decidePush(
      {
        at: 'done',
        to: HERE,
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: false },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.outcome?.created, false);
  });

  it('carries the pull request when there is one', () => {
    const view = decidePush(
      {
        at: 'done',
        to: HERE,
        pushed: {
          branch: 'vibld/r7',
          commitSha: 'abc',
          created: true,
          pullRequestUrl: 'https://github.com/acme/site/pull/1',
        },
      },
      CONNECTED,
    );
    assert.equal(
      view.show && view.outcome?.pullRequestUrl,
      'https://github.com/acme/site/pull/1',
    );
  });

  it('says nothing about a pull request when there is none', () => {
    const view = decidePush(
      {
        at: 'done',
        to: HERE,
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: true },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.outcome?.pullRequestUrl, undefined);
  });
});

describe('never describing a push as going where it did not', () => {
  // The connection can move under a push: another builder binds a different
  // repository, or the panel rebinds while a request is in the air. The
  // button's destination follows the connection, so a result kept from
  // before it moved would be drawn beside the new name.
  const ELSEWHERE = { owner: 'acme', repo: 'other' };

  it('withholds an outcome that was for somewhere else', () => {
    const view = decidePush(
      {
        at: 'done',
        to: ELSEWHERE,
        pushed: {
          branch: 'vibld/r7',
          commitSha: 'abc',
          created: true,
          pullRequestUrl: 'https://github.com/acme/other/pull/1',
        },
      },
      CONNECTED,
    );
    // The button still offers the connected repository. What it must not do
    // is offer a link into the one the push actually went to.
    assert.deepEqual(view.show && view.destination, HERE);
    assert.equal(view.show && view.outcome, undefined);
  });

  it('withholds a failure that was for somewhere else', () => {
    // A conflict carries the shas of the branch it collided with. Shown
    // under another repository's name they describe a branch that is not
    // there.
    const view = decidePush(
      {
        at: 'problem',
        to: ELSEWHERE,
        error: 'The branch vibld/r7 already exists and points somewhere else.',
        conflict: {
          branch: 'vibld/r7',
          existingSha: 'a'.repeat(40),
          attemptedTreeSha: 'b'.repeat(40),
        },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.problem, undefined);
  });

  it('is not busy on account of a push to somewhere else', () => {
    // Nothing is pushing here, so withholding the button would withhold a
    // push that nothing is doing.
    const view = decidePush({ at: 'pushing', to: ELSEWHERE }, CONNECTED);
    assert.equal(view.show && view.busy, false);
  });

  it('shows a refusal that was about the destination having moved', () => {
    // The one phase that records no destination, because it is about the
    // aim having been wrong. Withholding it the way a mismatched result is
    // withheld would hide it behind the very refresh it causes, and
    // somebody would have clicked Push, had nothing pushed, and been told
    // nothing at all.
    const view = decidePush(
      {
        at: 'moved',
        to: HERE,
        error:
          'Vibld is connected to acme/site, which is not where this push was for.',
      },
      CONNECTED,
    );
    assert.deepEqual(view.show && view.problem, {
      error:
        'Vibld is connected to acme/site, which is not where this push was for.',
      // The connection is not the thing that is wrong.
      reconnect: false,
    });
  });

  it('withholds a moved refusal once the connection has moved again', () => {
    // A→B→C. The route refused a push aimed at A and named B, and by the
    // time the connection was read again it was C. That sentence is about
    // neither the destination on screen nor the one that was aimed at, and
    // this phase carrying a destination is what lets the same rule catch
    // it rather than exempting it.
    const view = decidePush(
      {
        at: 'moved',
        to: { owner: 'acme', repo: 'was-b' },
        error: 'Vibld is connected to acme/was-b.',
      },
      CONNECTED,
    );
    assert.equal(view.show && view.problem, undefined);
  });

  it('withholds one that differs only in the owner', () => {
    // `acme/site` and `other/site` are different repositories and a check
    // that reads the name alone calls them the same one. Forks make that
    // pairing ordinary rather than contrived.
    const view = decidePush(
      {
        at: 'done',
        to: { owner: 'other', repo: 'site' },
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: true },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.outcome, undefined);
  });

  it('still shows a push that was for this destination', () => {
    const view = decidePush(
      {
        at: 'done',
        to: { owner: 'acme', repo: 'site' },
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: true },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.outcome?.branch, 'vibld/r7');
  });
});

describe('what survives the connection changing under it', () => {
  it('drops a result, which belonged to the push that produced it', () => {
    assert.deepEqual(
      afterConnectionChanged({
        at: 'done',
        to: HERE,
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: true },
      }),
      { at: 'idle' },
    );
    assert.deepEqual(
      afterConnectionChanged({ at: 'problem', to: HERE, error: 'nope' }),
      { at: 'idle' },
    );
    assert.deepEqual(afterConnectionChanged({ at: 'pushing', to: HERE }), {
      at: 'idle',
    });
  });

  it('keeps a refusal that is the explanation for the change', () => {
    // Dropping it would clear the only thing saying why the push somebody
    // asked for did not happen, cleared by the very change it reports.
    // Whether it is still worth drawing is `decidePush`'s to decide, by the
    // same destination rule as everything else.
    const moved = {
      at: 'moved',
      to: HERE,
      error: 'Vibld is connected to acme/site.',
    } as const;
    assert.deepEqual(afterConnectionChanged(moved), moved);
  });
});

describe('what it says about a push that failed', () => {
  it('shows the reason', () => {
    const view = decidePush(
      { at: 'problem', to: HERE, error: 'GitHub could not be reached.' },
      CONNECTED,
    );
    assert.equal(
      view.show && view.problem?.error,
      'GitHub could not be reached.',
    );
  });

  it('offers a reconnection only when one would help', () => {
    // The route separates a lost grant from everything else, and telling
    // somebody to reconnect about a rate limit sends them round a loop that
    // ends where it started. That distinction is the one this feature has
    // flattened more often than any other.
    const lost = decidePush(
      {
        at: 'problem',
        to: HERE,
        error: 'Vibld’s access was withdrawn.',
        reconnect: true,
      },
      CONNECTED,
    );
    assert.equal(lost.show && lost.problem?.reconnect, true);

    const transient = decidePush(
      { at: 'problem', to: HERE, error: 'Too many pushes. Try again shortly.' },
      CONNECTED,
    );
    assert.equal(transient.show && transient.problem?.reconnect, false);
  });

  it('carries a conflict through with both shas', () => {
    // The one failure the plan commits to reporting with both shas. The
    // sentence names the branch and neither, so flattening it here would
    // leave the promise unkeepable by anything downstream.
    const view = decidePush(
      {
        at: 'problem',
        to: HERE,
        error: 'The branch vibld/r7 already exists and points somewhere else.',
        conflict: {
          branch: 'vibld/r7',
          existingSha: 'a'.repeat(40),
          attemptedTreeSha: 'b'.repeat(40),
        },
      },
      CONNECTED,
    );
    assert.deepEqual(view.show && view.problem?.conflict, {
      branch: 'vibld/r7',
      existingSha: 'a'.repeat(40),
      attemptedTreeSha: 'b'.repeat(40),
    });
  });

  it('says nothing about a conflict when there was none', () => {
    // The whole object rather than the one field: assigning `undefined` and
    // assigning nothing read the same through `?.`, so checking the field
    // alone would pass either way and pin nothing.
    const view = decidePush(
      { at: 'problem', to: HERE, error: 'Too many pushes. Try again shortly.' },
      CONNECTED,
    );
    assert.deepEqual(view.show && view.problem, {
      error: 'Too many pushes. Try again shortly.',
      reconnect: false,
    });
  });

  it('still names where it was going', () => {
    // A failure is where knowing the destination matters most.
    const view = decidePush(
      { at: 'problem', to: HERE, error: 'nope' },
      CONNECTED,
    );
    assert.deepEqual(view.show && view.destination, {
      owner: 'acme',
      repo: 'site',
    });
  });
});

describe('deciding whether a push preview still applies', () => {
  const HERE = { owner: 'acme', repo: 'site' };
  const PREVIEW = {
    owner: 'acme',
    repo: 'site',
    baseBranch: 'main',
    added: [],
    changed: ['index.html'],
    removed: ['LICENSE'],
    unchanged: 2,
    truncated: false,
  };

  it('shows a preview for this destination and this checkpoint', () => {
    const view = decidePreview(
      { at: 'ready', to: HERE, revision: 'r7', preview: PREVIEW },
      HERE,
      'r7',
    );

    assert.equal(view.show, true);
    assert.deepEqual(view.show && view.preview?.removed, ['LICENSE']);
  });

  it('drops a preview once the connection has moved', () => {
    // The same rule everything else in this file goes through: a diff of
    // acme/site drawn beside a button pushing to other/repo describes
    // deletions in a repository nobody is about to write to.
    const view = decidePreview(
      { at: 'ready', to: HERE, revision: 'r7', preview: PREVIEW },
      { owner: 'other', repo: 'repo' },
      'r7',
    );

    assert.equal(view.show, false);
  });

  it('drops a preview once the checkpoint has moved', () => {
    // The same failure wearing different clothes. A diff computed for the
    // previous checkpoint, drawn beside a button that would push this one,
    // lists deletions about files that are not the ones going.
    const view = decidePreview(
      { at: 'ready', to: HERE, revision: 'r7', preview: PREVIEW },
      HERE,
      'r8',
    );

    assert.equal(view.show, false);
  });

  it('shows the wait, and the failure, for this destination only', () => {
    assert.equal(
      decidePreview({ at: 'loading', to: HERE, revision: 'r7' }, HERE, 'r7')
        .show,
      true,
    );
    const problem = decidePreview(
      { at: 'problem', to: HERE, revision: 'r7', error: 'no access' },
      HERE,
      'r7',
    );
    assert.equal(problem.show && problem.error, 'no access');
    assert.equal(
      decidePreview(
        { at: 'problem', to: HERE, revision: 'r7', error: 'no access' },
        { owner: 'other', repo: 'repo' },
        'r7',
      ).show,
      false,
    );
  });

  it('shows nothing before one has been asked for', () => {
    assert.equal(decidePreview({ at: 'none' }, HERE, 'r7').show, false);
  });

  it('recognises a push that would change nothing', () => {
    assert.equal(
      previewIsEmpty({ ...PREVIEW, changed: [], removed: [] }),
      true,
    );
    assert.equal(previewIsEmpty(PREVIEW), false);
  });
});

describe('a pull request from an earlier session', () => {
  const CONNECTED_WITH_PULL: GitHubStatus = {
    configured: true,
    connected: true,
    canPush: true,
    owner: 'acme',
    repo: 'site',
    pullRequest: {
      url: 'https://github.com/acme/site/pull/9',
      branch: 'vibld/r7',
      state: 'merged',
    },
  };

  it('is shown when this button has nothing of its own to say', () => {
    const view = decidePush({ at: 'idle' }, CONNECTED_WITH_PULL);

    assert.equal(view.show && view.lastPullRequest?.state, 'merged');
  });

  it('gives way to the push just made', () => {
    // Two pull request lines under one button is two answers to one
    // question, and the fresher one is the push that just happened.
    const view = decidePush(
      {
        at: 'done',
        to: { owner: 'acme', repo: 'site' },
        pushed: {
          branch: 'vibld/r8',
          commitSha: 'c',
          created: true,
          pullRequestUrl: 'https://github.com/acme/site/pull/10',
        },
      },
      CONNECTED_WITH_PULL,
    );

    assert.equal(view.show && view.lastPullRequest, undefined);
    assert.equal(view.show && view.outcome?.branch, 'vibld/r8');
  });

  it('carries an unknown state as unknown rather than as open', () => {
    const view = decidePush(
      { at: 'idle' },
      {
        ...CONNECTED_WITH_PULL,
        pullRequest: {
          url: 'https://github.com/acme/site/pull/9',
          branch: 'vibld/r7',
          state: null,
        },
      },
    );

    assert.equal(view.show && view.lastPullRequest?.state, null);
  });
});
