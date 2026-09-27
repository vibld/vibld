import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ProjectSnapshot } from '@vibld/core';

import { GitHubConnection } from '../src/components/GitHubPanel.tsx';
import { GitHubPushButton } from '../src/components/GitHubPushButton.tsx';
import { githubStatus } from '../src/github/github-status.ts';

/**
 * The panel and the push button, mounted together, which is how they are
 * used and the only way the thing #34 is about can be seen at all.
 *
 * Each had its own copy of the connection and its own probe, so the two
 * could name different repositories at the same moment. Neither component's
 * own suite could catch that: it takes both on screen.
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

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SNAPSHOT = {
  revision: 'r1',
  files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
} as ProjectSnapshot;

beforeEach(() => {
  githubStatus.forget();
});

async function mountBoth(answers: () => Response) {
  let asked = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/github/status')) asked += 1;
    return answers();
  }) as typeof fetch;

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <>
        <GitHubConnection />
        <GitHubPushButton snapshot={SNAPSHOT} />
      </>,
    );
  });
  return {
    text: () => container.textContent ?? '',
    statusRequests: () => asked,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the panel and the push button, on one connection', () => {
  it('both name the repository, from one request', async () => {
    // One copy means one probe. Two components each reading for themselves
    // is how they came to disagree in the first place.
    const view = await mountBoth(() => reply(CONNECTED));

    const text = view.text();
    assert.match(text, /acme\/site/);
    assert.match(text, /Push to acme\/site/);
    assert.equal(view.statusRequests(), 1);
    view.unmount();
  });

  it('offers no push when the panel says nothing is connected', async () => {
    const view = await mountBoth(() =>
      reply({ configured: true, connected: false, canConnect: true }),
    );

    assert.doesNotMatch(view.text(), /Push to/);
    view.unmount();
  });

  it('moves both at once when the connection is forgotten', async () => {
    // What a route refusing a push, or a disconnect, does to the store.
    // Before the shared copy, this cleared one surface and left the other
    // offering to push to a repository it had just been told about.
    const view = await mountBoth(() => reply(CONNECTED));
    assert.match(view.text(), /Push to acme\/site/);

    await act(async () => {
      githubStatus.forget();
    });

    assert.doesNotMatch(view.text(), /Push to acme\/site/);
    view.unmount();
  });

  it('moves both at once when a write says where the connection went', async () => {
    const view = await mountBoth(() => reply(CONNECTED));

    await act(async () => {
      githubStatus.amend(() => ({
        ...CONNECTED,
        owner: 'other',
        repo: 'newer',
      }));
    });

    const text = view.text();
    assert.match(text, /Push to other\/newer/);
    assert.doesNotMatch(text, /acme\/site/);
    view.unmount();
  });
});
