import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ProjectSnapshot } from '@vibld/core';

import { noteConnectionChanged } from '../src/github/github-client.ts';
import { githubStatus } from '../src/github/github-status.ts';
import { GitHubPushButton } from '../src/components/GitHubPushButton.tsx';

/**
 * The wiring, which is the half no rule could be moved out of.
 *
 * `decidePush` decides everything this component shows and has its own
 * tests. What those cannot reach is whether the component asks the right
 * question, sends what it says it sends, and survives an answer arriving
 * after the thing it was about has moved on. Two findings on #123 were
 * exactly that, and the second was introduced while fixing the first.
 */

const CONNECTED = {
  configured: true,
  connected: true,
  canPush: true,
  canConnect: true,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
};

function snapshot(revision: string): ProjectSnapshot {
  return {
    revision,
    files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
  } as ProjectSnapshot;
}

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  body?: Record<string, unknown>;
}

/** A `fetch` that records what it was asked and answers per route. */
function serving(routes: Record<string, () => Promise<Response> | Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      ...(init?.body
        ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
        : {}),
    });
    for (const [path, answer] of Object.entries(routes)) {
      if (url.includes(path)) return await answer();
    }
    return reply({ error: 'unexpected' }, 500);
  }) as typeof fetch;
  return calls;
}

async function mount(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    async render(next: React.ReactNode) {
      await act(async () => root.render(next));
    },
    async click(text: string) {
      const button = [...container.querySelectorAll('button')].find((el) =>
        el.textContent?.includes(text),
      );
      assert.ok(button, `no button matching ${text}: ${container.innerHTML}`);
      await act(async () => {
        button.click();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * The connection is shared state now (#34), and shared state outlives a
 * test. Without this, a test mounting after one that connected would find a
 * repository already there and pass without ever asking for one.
 */
beforeEach(() => {
  githubStatus.forget();
});

describe('the push button, as it is actually wired', () => {
  it('asks for the status and offers the repository it names', async () => {
    const calls = serving({ '/api/github/status': () => reply(CONNECTED) });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);

    assert.deepEqual(
      calls.map((call) => call.url),
      ['/api/github/status'],
    );
    assert.match(view.container.textContent ?? '', /Push to acme\/site/);
    view.unmount();
  });

  it('sends the revision and the destination it is showing', async () => {
    // The two things #123 established the route needs: the revision it keys
    // on, and where the click believed it was going.
    const calls = serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/push': () =>
        reply({ branch: 'vibld/r7', commitSha: 'abc', created: true }),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    await view.click('Push to');

    const push = calls.find((call) => call.url.includes('/push'));
    assert.ok(push, 'no push was sent');
    assert.equal(push.body?.revision, 'r7');
    assert.equal(push.body?.owner, 'acme');
    assert.equal(push.body?.repo, 'site');
    assert.match(view.container.textContent ?? '', /vibld\/r7/);
    view.unmount();
  });

  it('says nothing when the deployment has no GitHub', async () => {
    serving({ '/api/github/status': () => reply({ configured: false }) });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    assert.equal(view.container.innerHTML, '');
    view.unmount();
  });
});

/**
 * The four findings on #123 that lived in here rather than in a rule.
 *
 * Each one was found by a reviewer reading the code, because nothing in
 * this repository could run it. Each one is a test now.
 */
describe('answers that arrive after the thing they were about moved on', () => {
  /** A reply the test decides when to give. */
  function held<T>() {
    let give!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      give = resolve;
    });
    return { promise, give };
  }

  it('clears the last result when a new checkpoint arrives', async () => {
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/push': () =>
        reply({ branch: 'vibld/r7', commitSha: 'abc', created: true }),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    await view.click('Push to');
    assert.match(view.container.textContent ?? '', /vibld\/r7/);

    // Otherwise the branch from the last push stays on screen beside a
    // project that has moved on, which reads as though the new work is
    // already on GitHub.
    await view.render(<GitHubPushButton snapshot={snapshot('r8')} />);
    assert.doesNotMatch(view.container.textContent ?? '', /vibld\/r7/);
    view.unmount();
  });

  it('discards a push that finished after the checkpoint changed', async () => {
    // Clearing the phase was not enough on its own: the request behind it
    // was still in flight and drew its branch beside the new checkpoint
    // when it landed.
    const slow = held<Response>();
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/push': () => slow.promise,
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    await view.click('Push to');
    await view.render(<GitHubPushButton snapshot={snapshot('r8')} />);

    await act(async () => {
      slow.give(reply({ branch: 'vibld/r7', commitSha: 'abc', created: true }));
    });
    assert.doesNotMatch(view.container.textContent ?? '', /vibld\/r7/);
    view.unmount();
  });

  it('discards a push that finished after the connection changed', async () => {
    // The connection moving under a push in flight is a different race from
    // the checkpoint moving, and the handler supersedes the push for it.
    // Sending the notification while nothing is pushing would leave that
    // line free to delete: the suite stayed green without it until this
    // test existed.
    const slow = held<Response>();
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/push': () => slow.promise,
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    await view.click('Push to');

    await act(async () => {
      noteConnectionChanged();
    });
    await act(async () => {
      slow.give(reply({ branch: 'vibld/r7', commitSha: 'abc', created: true }));
    });

    // The push may well have landed. Saying so beside a connection that has
    // moved since would be describing it against the wrong destination.
    assert.doesNotMatch(view.container.textContent ?? '', /vibld\/r7/);
    view.unmount();
  });

  it('clears a result the connection has moved on from', async () => {
    // The rule `afterConnectionChanged` states, asserted through the
    // component that has to call it. The destination is unchanged here on
    // purpose: `decidePush` hides a result whose destination differs, so a
    // test that also moved the repository would pass without the component
    // clearing anything and pin nothing.
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/push': () =>
        reply({ branch: 'vibld/r7', commitSha: 'abc', created: true }),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    await view.click('Push to');
    assert.match(view.container.textContent ?? '', /vibld\/r7/);

    await act(async () => {
      noteConnectionChanged();
    });
    assert.doesNotMatch(view.container.textContent ?? '', /vibld\/r7/);
    view.unmount();
  });

  it('reads the status again when the connection changes', async () => {
    // The panel that binds a repository is this component's sibling, so
    // without the subscription a bind made with the Code tab open leaves
    // the button hidden.
    let connected = false;
    const calls = serving({
      '/api/github/status': () =>
        reply(connected ? CONNECTED : { configured: true, connected: false }),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    assert.doesNotMatch(view.container.textContent ?? '', /Push to/);

    connected = true;
    await act(async () => {
      noteConnectionChanged();
    });
    assert.equal(
      calls.filter((call) => call.url.includes('/status')).length,
      2,
      'the connection changed and nothing read it again',
    );
    assert.match(view.container.textContent ?? '', /Push to acme\/site/);
    view.unmount();
  });

  it('corrects itself when the route says the destination moved', async () => {
    // A rebind in another tab or on another device reaches this browser no
    // other way. Without the re-probe the button keeps naming the old
    // repository and every click is refused for good.
    let status = CONNECTED;
    const calls = serving({
      '/api/github/status': () => reply(status),
      '/api/github/push': () => {
        status = { ...CONNECTED, repo: 'other' };
        return reply(
          {
            error: 'Vibld is connected to acme/other.',
            movedTo: { owner: 'acme', repo: 'other' },
          },
          409,
        );
      },
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r7')} />);
    await view.click('Push to');

    assert.equal(
      calls.filter((call) => call.url.includes('/status')).length,
      2,
      'a moved destination did not send it back to read the connection',
    );
    // The button follows the connection, and the sentence explaining why
    // nothing was pushed survives the refresh that sentence caused.
    assert.match(view.container.textContent ?? '', /Push to acme\/other/);
    assert.match(view.container.textContent ?? '', /connected to acme\/other/);
    view.unmount();
  });
});

describe('previewing the push, as it is actually wired', () => {
  const DIFF = {
    owner: 'acme',
    repo: 'site',
    baseBranch: 'main',
    added: ['src/new.ts'],
    changed: ['index.html'],
    removed: ['LICENSE'],
    unchanged: 2,
    truncated: false,
  };

  it('asks nothing until somebody asks it to', async () => {
    // The preview spends the same GitHub quota a push does. Fetching one
    // after every generation spends it for people who never look.
    const calls = serving({ '/api/github/status': () => reply(CONNECTED) });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);

    assert.equal(
      calls.filter((call) => call.url.includes('/api/github/diff')).length,
      0,
    );
    view.unmount();
  });

  it('names what the push would delete', async () => {
    const calls = serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/diff': () => reply(DIFF),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);

    await view.click('What would this change?');

    const text = view.container.textContent ?? '';
    assert.match(text, /Deleted from the branch/);
    assert.match(text, /LICENSE/);
    assert.match(text, /src\/new\.ts/);
    // It sends the files, and no revision: a preview is not a push and must
    // not key one.
    const asked = calls.find((call) => call.url.includes('/api/github/diff'));
    assert.deepEqual(Object.keys(asked?.body ?? {}), ['files']);
    view.unmount();
  });

  it('drops the preview when the checkpoint moves on', async () => {
    // A diff computed for the previous checkpoint, drawn beside a button
    // that would push this one, lists deletions about files that are not
    // the ones going.
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/diff': () => reply(DIFF),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);
    await view.click('What would this change?');
    assert.match(view.container.textContent ?? '', /LICENSE/);

    await view.render(<GitHubPushButton snapshot={snapshot('r2')} />);

    assert.doesNotMatch(view.container.textContent ?? '', /LICENSE/);
    view.unmount();
  });

  it('says a push would change nothing rather than drawing empty lists', async () => {
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/diff': () =>
        reply({ ...DIFF, added: [], changed: [], removed: [] }),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);

    await view.click('What would this change?');

    assert.match(view.container.textContent ?? '', /Nothing would change/);
    view.unmount();
  });

  it('warns that a truncated listing under-reports deletions', async () => {
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/diff': () => reply({ ...DIFF, truncated: true }),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);

    await view.click('What would this change?');

    assert.match(view.container.textContent ?? '', /floor, not a count/);
    view.unmount();
  });

  it('shows the refusal rather than an empty diff', async () => {
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/diff': () => reply({ error: 'vibld lost access.' }, 409),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);

    await view.click('What would this change?');

    const text = view.container.textContent ?? '';
    assert.match(text, /vibld lost access\./);
    assert.doesNotMatch(text, /Nothing would change/);
    view.unmount();
  });

  it('still offers the push when the preview failed', async () => {
    // Nobody is blocked by a missing preview: the button is the feature and
    // the diff is help.
    serving({
      '/api/github/status': () => reply(CONNECTED),
      '/api/github/diff': () => reply({ error: 'nope' }, 500),
    });
    const view = await mount(<GitHubPushButton snapshot={snapshot('r1')} />);

    await view.click('What would this change?');

    const push = [...view.container.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Push to'),
    );
    assert.ok(push);
    assert.equal(push.disabled, false);
    view.unmount();
  });
});
