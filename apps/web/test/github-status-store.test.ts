import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGitHubStatusStore } from '../src/github/github-status.ts';
import type { GitHubStatus } from '../src/github/github-client.ts';

const CONNECTED: GitHubStatus = {
  configured: true,
  connected: true,
  canPush: true,
  canConnect: true,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
};

/** A loader whose answer is settled by the test, not by a timer. */
function deferred() {
  let resolve: (value: GitHubStatus | null) => void = () => {};
  const promise = new Promise<GitHubStatus | null>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('the shared GitHub status', () => {
  it('gives every reader the same answer', async () => {
    // The whole point of #34: the panel and the push button cannot say
    // different things about one connection.
    const store = createGitHubStatusStore(async () => CONNECTED);
    let panelSaw = 0;
    let buttonSaw = 0;
    store.subscribe(() => (panelSaw += 1));
    store.subscribe(() => (buttonSaw += 1));

    await store.refresh();

    assert.equal(store.read()?.repo, 'site');
    assert.equal(panelSaw, 1);
    assert.equal(buttonSaw, 1);
  });

  it('makes one request when two readers ask at once', async () => {
    let asked = 0;
    const store = createGitHubStatusStore(async () => {
      asked += 1;
      return CONNECTED;
    });

    await Promise.all([store.refresh(), store.refresh()]);

    // Two probes racing can commit in either order, which is the other half
    // of two surfaces agreeing.
    assert.equal(asked, 1);
  });

  it('keeps the last known connection when a probe fails', async () => {
    let answer: GitHubStatus | null = CONNECTED;
    const store = createGitHubStatusStore(async () => answer);
    await store.refresh();

    answer = null;
    await store.refresh();

    // A dropped request is not news that somebody's repository is gone.
    assert.equal(store.read()?.repo, 'site');
  });

  it('lets a completed write win over a read still in flight', async () => {
    // Binding already knows the answer: the route just told it. A probe that
    // started earlier must not land afterwards and put the old repository
    // back.
    const slow = deferred();
    const store = createGitHubStatusStore(() => slow.promise);
    const reading = store.refresh();

    store.amend(() => ({ ...CONNECTED, owner: 'other', repo: 'newer' }));
    slow.resolve(CONNECTED);
    await reading;

    assert.equal(store.read()?.repo, 'newer');
  });

  it('lets forgetting win over a read still in flight', async () => {
    const slow = deferred();
    const store = createGitHubStatusStore(() => slow.promise);
    const reading = store.refresh();

    store.forget();
    slow.resolve(CONNECTED);
    await reading;

    assert.equal(store.read(), null);
  });

  it('tells every reader about a local write, not just the one that made it', async () => {
    const store = createGitHubStatusStore(async () => CONNECTED);
    let told = 0;
    store.subscribe(() => (told += 1));

    store.amend(() => CONNECTED);
    store.forget();

    assert.equal(told, 2);
  });

  it('stops telling a reader that has gone', async () => {
    const store = createGitHubStatusStore(async () => CONNECTED);
    let told = 0;
    const stop = store.subscribe(() => (told += 1));

    stop();
    await store.refresh();

    assert.equal(told, 0);
  });

  it('can be refreshed again after one finished', async () => {
    let asked = 0;
    const store = createGitHubStatusStore(async () => {
      asked += 1;
      return CONNECTED;
    });

    await store.refresh();
    await store.refresh();

    // The join is for concurrent callers, not a one-shot: a later ask has to
    // reach the route, or nothing would ever notice a connection changing.
    assert.equal(asked, 2);
  });
});
