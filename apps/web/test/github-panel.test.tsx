import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  noteConnectionChanged,
  onConnectionChanged,
} from '../src/github/github-client.ts';
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

describe('ending a connection from the panel', () => {
  it('sends the repository it is naming, not whatever is bound', async () => {
    // The route acts on the binding as it stands when the request arrives.
    // This is the half that makes its guard usable: a panel that sent
    // nothing would be refused, and one that sent the wrong thing would
    // end a connection somebody meant to keep.
    const sent: { url: string; body?: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      sent.push({
        url,
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
          : {}),
      });
      if (url.includes('/api/github/status')) {
        return reply({
          configured: true,
          connected: true,
          canPush: true,
          owner: 'acme',
          repo: 'site',
          defaultBranch: 'main',
        });
      }
      return reply({ connected: false });
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GitHubConnection />));

    const button = [...container.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Disconnect'),
    );
    assert.ok(button, `no Disconnect button: ${container.innerHTML}`);
    await act(async () => {
      button.click();
    });

    const ended = sent.find((call) => call.url.includes('/disconnect'));
    assert.ok(ended, 'nothing was sent to the disconnect route');
    assert.deepEqual(ended.body, { owner: 'acme', repo: 'site' });

    act(() => root.unmount());
    container.remove();
  });
});

describe('a disconnect the route refuses', () => {
  it('tells the rest of the builder, not just itself', async () => {
    // The push button keeps its own copy of the status. A panel that only
    // refreshed itself would leave it offering a push to the repository
    // this just learned about, until somebody clicked it and was refused in
    // turn.
    let heard = 0;
    const stop = onConnectionChanged(() => {
      heard += 1;
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/github/status')) {
        return reply({
          configured: true,
          connected: true,
          canPush: true,
          owner: 'acme',
          repo: 'site',
          defaultBranch: 'main',
        });
      }
      return new Response(
        JSON.stringify({
          error: 'Vibld is connected to acme/other.',
          movedTo: { owner: 'acme', repo: 'other' },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GitHubConnection />));

    const button = [...container.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Disconnect'),
    );
    assert.ok(button, `no Disconnect button: ${container.innerHTML}`);
    await act(async () => {
      button.click();
    });

    assert.ok(
      heard > 0,
      'a refused disconnect told nobody the connection moved',
    );

    stop();
    act(() => root.unmount());
    container.remove();
  });
});
