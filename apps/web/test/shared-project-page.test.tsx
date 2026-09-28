import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { ShareControl } from '../src/components/ProjectBar.tsx';
import { SharedProjectView } from '../src/components/SharedProjectPage.tsx';
import type { ProjectSummary } from '../src/projects/projects-client.ts';

/**
 * The share page and the owner's share switch, as they are wired
 * (docs/decisions.md, "Resolved 2026-09-28", sharing).
 *
 * The rules behind them (what a link shows, when it stops, what a remix
 * copies) are the Worker's and are tested there. What only these can get
 * wrong: what the page puts on screen, that its preview waits to be asked,
 * that Remix lands in the new project, and that the owner is told what the
 * link gives away before turning it on.
 */

const TOKEN = 'T'.repeat(43);

async function settle() {
  for (let n = 0; n < 5; n += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await settle();
  });
  return {
    container,
    text: () => container.textContent ?? '',
    button(text: RegExp): HTMLButtonElement | undefined {
      return [...container.querySelectorAll('button')].find((b) =>
        text.test(b.textContent ?? ''),
      );
    },
    async press(target: HTMLElement | undefined) {
      assert.ok(target, 'nothing to press');
      await act(async () => {
        target.click();
        await settle();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

interface Call {
  url: string;
  method: string;
  auth?: string;
}

function serving(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      ...(headers.Authorization ? { auth: headers.Authorization } : {}),
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const SHARED = {
  project: { name: 'Bakery' },
  snapshot: {
    revision: 'r1',
    files: [
      { path: 'index.html', content: '<div id="root"></div>' },
      { path: 'src/App.tsx', content: 'export default () => <h1>Bread</h1>;' },
    ],
  },
  livePreview: true,
};

describe('the share page', () => {
  it('shows the project and its code, and starts no preview on its own', async () => {
    const calls = serving(() => reply(SHARED));
    const view = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    assert.match(view.text(), /Bakery/);
    // The app's own component first, which is what somebody came to read.
    assert.match(view.text(), /export default \(\) => <h1>Bread<\/h1>/);
    assert.ok(view.button(/Run live preview/));
    assert.ok(view.button(/^Remix$/));
    // It asks whether a preview is already running, which anybody may, and
    // starts nothing.
    assert.deepEqual(
      calls.map((call) => [call.method, call.url]),
      [
        ['GET', `/api/share/${TOKEN}`],
        ['GET', `/api/share/${TOKEN}/preview`],
      ],
    );
    view.unmount();
  });

  it('runs the live preview when asked, and shows it once it is ready', async () => {
    let ready = false;
    let started = false;
    const calls = serving((call) => {
      if (call.url.endsWith('/preview')) {
        if (call.method === 'POST') started = true;
        if (!started) return reply({ status: 'ready-to-start' });
        return reply(
          ready
            ? {
                status: 'ready',
                url: 'https://8080-shared-abc-tok.vibld-preview.dev/',
                expiresAt: 1,
              }
            : { status: 'installing' },
        );
      }
      return reply(SHARED);
    });
    const view = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    await view.press(view.button(/Run live preview/));
    assert.match(view.text(), /Installing/);
    assert.equal(calls.at(-1)?.method, 'POST');

    ready = true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_100));
      await settle();
    });
    const frame = view.container.querySelector('iframe');
    assert.equal(
      frame?.getAttribute('src'),
      'https://8080-shared-abc-tok.vibld-preview.dev/',
    );
    view.unmount();
  });

  it('says a dead link is not active, and shows nothing of it', async () => {
    serving(() =>
      reply({ error: 'This link is not active. Ask whoever sent it.' }, 404),
    );
    const view = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    assert.match(view.text(), /This link is not active/);
    assert.equal(view.button(/Remix/), undefined);
    view.unmount();
  });

  it('opens the remix in the builder once it is made', async () => {
    const calls = serving((call) =>
      call.url.endsWith('/remix')
        ? reply({ project: { id: 'p-new', name: 'Remix of Bakery' } }, 201)
        : reply(SHARED),
    );
    const view = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    await view.press(view.button(/^Remix$/));
    const remix = calls.find((call) => call.url.endsWith('/remix'));
    assert.equal(remix?.method, 'POST');
    assert.equal(window.location.pathname, '/p/p-new');
    view.unmount();
  });

  it('says why a remix was refused, and points at the projects when it is the limit', async () => {
    serving((call) =>
      call.url.endsWith('/remix')
        ? reply(
            {
              error: 'A free account can have 3 active projects.',
              code: 'project-limit',
              limit: 3,
            },
            403,
          )
        : reply(SHARED),
    );
    const view = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    await view.press(view.button(/^Remix$/));
    assert.match(view.text(), /A free account can have 3 active projects/);
    assert.ok(view.container.querySelector('a[href="/projects"]'));
    view.unmount();
  });
});

describe('the live preview while signed out', () => {
  it('offers to sign in to run it, and starts it once signed in', async () => {
    let started = false;
    const calls = serving((call) => {
      if (call.url.endsWith('/preview')) {
        if (call.method === 'POST') started = true;
        return reply(
          started ? { status: 'installing' } : { status: 'ready-to-start' },
        );
      }
      return reply(SHARED);
    });
    const asked: string[] = [];
    window.history.replaceState(null, '', `/s/${TOKEN}`);
    const out = await render(
      <SharedProjectView
        token={TOKEN}
        signedIn={false}
        signIn={(returnTo) => {
          asked.push(returnTo);
          return <p>Sign in here</p>;
        }}
      />,
    );
    assert.equal(out.button(/^Run live preview$/), undefined);
    await out.press(out.button(/^Sign in to run the live preview$/));
    assert.match(out.text(), /Sign in here/);
    assert.deepEqual(asked.slice(-1), [`/s/${TOKEN}?preview=1`]);
    assert.equal(
      calls.some((call) => call.method === 'POST'),
      false,
      'started a preview for somebody not signed in',
    );
    out.unmount();

    // Back from signing in, with the intent on the link: it starts, once,
    // signed, without a second press.
    window.history.replaceState(null, '', `/s/${TOKEN}?preview=1`);
    const back = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    const posts = calls.filter((call) => call.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.url, `/api/share/${TOKEN}/preview`);
    assert.equal(window.location.search, '');
    assert.match(back.text(), /Installing/);
    back.unmount();
  });

  it('shows a preview somebody else started, signed in or not', async () => {
    serving((call) =>
      call.url.endsWith('/preview')
        ? reply({
            status: 'ready',
            url: 'https://8080-shared-abc-tok.vibld-preview.dev/',
            expiresAt: 1,
          })
        : reply(SHARED),
    );
    window.history.replaceState(null, '', `/s/${TOKEN}`);
    const view = await render(
      <SharedProjectView token={TOKEN} signedIn={false} signIn={() => null} />,
    );
    assert.equal(
      view.container.querySelector('iframe')?.getAttribute('src'),
      'https://8080-shared-abc-tok.vibld-preview.dev/',
    );
    view.unmount();
  });
});

describe('a remix while signed out', () => {
  it('signs in first, on the page, and comes back to carry on', async () => {
    const calls = serving((call) =>
      call.url.endsWith('/remix')
        ? reply({ project: { id: 'p-after', name: 'Remix of Bakery' } }, 201)
        : reply(SHARED),
    );
    const asked: string[] = [];
    window.history.replaceState(null, '', `/s/${TOKEN}`);
    const out = await render(
      <SharedProjectView
        token={TOKEN}
        signedIn={false}
        signIn={(returnTo) => {
          asked.push(returnTo);
          return <p>Sign in here</p>;
        }}
      />,
    );
    await out.press(out.button(/^Remix$/));
    assert.match(out.text(), /Sign in here/);
    assert.deepEqual(asked.slice(-1), [`/s/${TOKEN}?remix=1`]);
    assert.equal(
      calls.some((call) => call.url.endsWith('/remix')),
      false,
      'remixed before anybody signed in',
    );
    out.unmount();

    // Signing in brings the browser back to the link with the intent on it,
    // and the remix carries on without a second press.
    window.history.replaceState(null, '', `/s/${TOKEN}?remix=1`);
    const back = await render(
      <SharedProjectView token={TOKEN} signedIn={true} signIn={() => null} />,
    );
    assert.equal(calls.filter((call) => call.url.endsWith('/remix')).length, 1);
    assert.equal(window.location.pathname, '/p/p-after');
    back.unmount();
  });
});

describe("the owner's share switch", () => {
  const project = (share: ProjectSummary['share']): ProjectSummary => ({
    id: 'p1',
    name: 'Bakery',
    archived: false,
    archivedAt: null,
    createdAt: '2026-09-28T12:00:00.000Z',
    editedAt: '2026-09-28T12:00:00.000Z',
    lastOpenedAt: '2026-09-28T12:00:00.000Z',
    hasCode: true,
    turns: 0,
    settings: {
      style: null,
      referenceUrl: null,
      model: null,
      knowledge: null,
      styleDna: null,
    },
    ...(share ? { share } : {}),
  });

  it('says what the link gives away before it is turned on', async () => {
    const asked: boolean[] = [];
    const view = await render(
      <ShareControl
        project={project({ on: false, url: null, held: false })}
        busy={false}
        onChange={(on) => asked.push(on)}
      />,
    );
    assert.match(view.text(), /^Share/);
    assert.match(view.text(), /conversation with the agent.*not shared/);
    await view.press(view.button(/Turn on link/));
    assert.deepEqual(asked, [true]);
    view.unmount();
  });

  it('shows the link to copy once it is on, and turns it off for good', async () => {
    const asked: boolean[] = [];
    const url = `https://app.vibld.com/s/${TOKEN}`;
    const view = await render(
      <ShareControl
        project={project({ on: true, url, held: false })}
        busy={false}
        onChange={(on) => asked.push(on)}
      />,
    );
    const field = view.container.querySelector('input');
    assert.equal(field?.value, url);
    assert.match(view.text(), /stops this link working for good/);
    await view.press(view.button(/Turn off link/));
    assert.deepEqual(asked, [false]);
    view.unmount();
  });

  it('says an operator turned it off, and offers nothing to undo that', async () => {
    const view = await render(
      <ShareControl
        project={project({ on: true, url: null, held: true })}
        busy={false}
        onChange={() => assert.fail('offered a switch under a hold')}
      />,
    );
    assert.match(view.text(), /turned off by the operator/);
    assert.equal(view.button(/Turn/), undefined);
    view.unmount();
  });

  it('reads a Worker older than sharing as a link that is off', async () => {
    const view = await render(
      <ShareControl
        project={project(undefined)}
        busy={false}
        onChange={() => {}}
      />,
    );
    assert.ok(view.button(/Turn on link/));
    view.unmount();
  });
});
