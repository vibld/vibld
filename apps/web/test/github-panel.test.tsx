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
  const CONNECTED = {
    configured: true,
    connected: true,
    canPush: true,
    owner: 'acme',
    repo: 'site',
    defaultBranch: 'main',
  };
  const MOVED = { ...CONNECTED, repo: 'other' };

  const REFUSAL = () =>
    new Response(
      JSON.stringify({
        error: 'Vibld is connected to acme/other.',
        movedTo: { owner: 'acme', repo: 'other' },
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    );

  async function mountPanel() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GitHubConnection />));
    return {
      container,
      async clickDisconnect() {
        const button = [...container.querySelectorAll('button')].find((el) =>
          el.textContent?.includes('Disconnect'),
        );
        assert.ok(button, `no Disconnect button: ${container.innerHTML}`);
        await act(async () => {
          button.click();
        });
      },
      done() {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('stops naming a repository the server has contradicted', async () => {
    // The refusal sends the panel back to read the connection, and that
    // read can fail. `refreshStatus` only commits a status it actually got,
    // so without forgetting first this panel would go on naming acme/site
    // beside an error saying Vibld is connected to acme/other, and would
    // still offer to disconnect the wrong one.
    let probes = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/github/status')) return REFUSAL();
      probes += 1;
      // The read after the refusal is the one that fails.
      if (probes > 1) throw new Error('offline');
      return reply(CONNECTED);
    }) as typeof fetch;

    const panel = await mountPanel();
    assert.match(panel.container.textContent ?? '', /acme\/site/);
    await panel.clickDisconnect();

    assert.match(panel.container.textContent ?? '', /connected to acme\/other/);
    assert.doesNotMatch(
      panel.container.textContent ?? '',
      /acme\/site/,
      'it kept naming the repository the server had just contradicted',
    );
    assert.equal(
      [...panel.container.querySelectorAll('button')].some((el) =>
        el.textContent?.includes('Disconnect'),
      ),
      false,
      'it still offered to disconnect a repository it no longer knows about',
    );
    panel.done();
  });

  it('does not let a read from before the refusal put it back', async () => {
    // A status read already in flight when the refusal arrives carries what
    // it saw beforehand. Forgetting is not enough on its own: without
    // superseding, that read lands afterwards and repaints the repository
    // the server has just contradicted, over the fresher one.
    let release: ((value: Response) => void) | null = null;
    let probes = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/github/status')) return REFUSAL();
      probes += 1;
      // Held open across the click, carrying what the connection was
      // before it moved.
      if (probes === 2) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      // Every read after the move sees where it moved to.
      return reply(probes === 1 ? CONNECTED : MOVED);
    }) as typeof fetch;

    const panel = await mountPanel();
    await act(async () => {
      noteConnectionChanged();
    });
    assert.ok(release, 'the read this test holds open never started');

    await panel.clickDisconnect();
    assert.match(panel.container.textContent ?? '', /acme\/other/);

    // Now let the older read finish, carrying what it saw before the click.
    await act(async () => {
      release?.(reply(CONNECTED));
    });

    assert.doesNotMatch(
      panel.container.textContent ?? '',
      /acme\/site/,
      'a read from before the refusal put the old repository back',
    );
    panel.done();
  });

  it('stops showing the refusal once the connection has moved again', async () => {
    // The route's sentence is true of the connection as it stood when it
    // answered. If the binding moves once more while the panel is reading
    // it, that sentence describes a state nothing on screen is in.
    let probes = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/api/github/status')) return REFUSAL();
      probes += 1;
      // The read after the refusal finds a third repository.
      return reply(probes === 1 ? CONNECTED : { ...CONNECTED, repo: 'third' });
    }) as typeof fetch;

    const panel = await mountPanel();
    await panel.clickDisconnect();

    assert.match(panel.container.textContent ?? '', /acme\/third/);
    assert.doesNotMatch(
      panel.container.textContent ?? '',
      /acme\/other/,
      'it kept a sentence about a repository that is no longer the one on screen',
    );
    panel.done();
  });

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
      if (!url.includes('/api/github/status')) return REFUSAL();
      return reply(CONNECTED);
    }) as typeof fetch;

    const panel = await mountPanel();
    await panel.clickDisconnect();

    assert.ok(
      heard > 0,
      'a refused disconnect told nobody the connection moved',
    );
    stop();
    panel.done();
  });
});
