import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decidePush } from '../src/github/push-view.ts';
import type { GitHubStatus } from '../src/github/github-client.ts';

/**
 * Whether to offer a push, decided apart from the button that draws it.
 *
 * The runner strips TypeScript types and errors on JSX, so a rule written
 * inside a component is typechecked and never run. Four findings on #122
 * were exactly that, so these live here from the start rather than after a
 * reviewer finds them.
 */

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
    const view = decidePush({ at: 'pushing' }, CONNECTED);
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
        pushed: { branch: 'vibld/r7', commitSha: 'abc', created: true },
      },
      CONNECTED,
    );
    assert.equal(view.show && view.outcome?.pullRequestUrl, undefined);
  });
});

describe('what it says about a push that failed', () => {
  it('shows the reason', () => {
    const view = decidePush(
      { at: 'problem', error: 'GitHub could not be reached.' },
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
        error: 'Vibld’s access was withdrawn.',
        reconnect: true,
      },
      CONNECTED,
    );
    assert.equal(lost.show && lost.problem?.reconnect, true);

    const transient = decidePush(
      { at: 'problem', error: 'Too many pushes. Try again shortly.' },
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
      { at: 'problem', error: 'Too many pushes. Try again shortly.' },
      CONNECTED,
    );
    assert.deepEqual(view.show && view.problem, {
      error: 'Too many pushes. Try again shortly.',
      reconnect: false,
    });
  });

  it('still names where it was going', () => {
    // A failure is where knowing the destination matters most.
    const view = decidePush({ at: 'problem', error: 'nope' }, CONNECTED);
    assert.deepEqual(view.show && view.destination, {
      owner: 'acme',
      repo: 'site',
    });
  });
});
