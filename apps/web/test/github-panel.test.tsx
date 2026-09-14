import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { noteConnectionChanged } from '../src/github/github-client.ts';
import { GitHubConnection } from '../src/components/GitHubPanel.tsx';

/**
 * The panel had been publishing connection changes and never listening.
 *
 * A rebind found by a push in another tab or on another device refreshed
 * the push button and left the header naming the repository connected
 * before it. Worse than looking out of date: Disconnect on a stale panel
 * disconnects whatever is bound now rather than the thing it is naming.
 *
 * It shipped on #123 with no test, because subscribing is wiring in a
 * `.tsx` and there was no way to run one. This is that gap closed.
 */

function reply(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('the connect panel, as it is actually wired', () => {
  it('reads the status again when the connection changes', async () => {
    const reads: string[] = [];
    let repo = 'site';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      reads.push(url);
      if (url.includes('/api/github/status')) {
        return reply({
          configured: true,
          connected: true,
          canPush: true,
          owner: 'acme',
          repo,
          defaultBranch: 'main',
        });
      }
      return reply({});
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GitHubConnection />));
    assert.match(container.textContent ?? '', /acme\/site/);

    // What a rebind in another tab looks like from in here.
    repo = 'other';
    await act(async () => {
      noteConnectionChanged();
    });

    assert.equal(
      reads.filter((url) => url.includes('/status')).length,
      2,
      'the connection changed and the panel never read it again',
    );
    assert.match(container.textContent ?? '', /acme\/other/);
    // The stale name is the dangerous part: Disconnect acts on the binding,
    // not on the name beside it.
    assert.doesNotMatch(container.textContent ?? '', /acme\/site/);

    act(() => root.unmount());
    container.remove();
  });
});
