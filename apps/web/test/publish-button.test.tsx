import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ProjectSnapshot } from '@vibld/core';

import { PublishButton } from '../src/components/PublishButton.tsx';

/**
 * Publishing, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 */

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

function serving(answer: () => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      ...(init?.body
        ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
        : {}),
    });
    return answer();
  }) as typeof fetch;
  return calls;
}

/**
 * A reply held back, so a publish can be caught mid-flight.
 *
 * `land` resolves it and then drains the microtasks behind it: the request
 * settling is three awaits away from the state it sets, and `act` alone
 * returns before the last of them.
 */
function held(response: () => Response) {
  let open: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    answer: async () => {
      await waiting;
      return response();
    },
    async land() {
      await act(async () => {
        open?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
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
    slug(): HTMLInputElement | null {
      return container.querySelector('input');
    },
    async type(value: string) {
      const input = container.querySelector('input');
      assert.ok(input, 'no slug field');
      await act(async () => {
        // What React listens for: setting `.value` alone does not notify it.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async click() {
      const button = container.querySelector('button');
      assert.ok(button, 'no publish button');
      await act(async () => {
        button.click();
      });
    },
    label(): string {
      return container.querySelector('button')?.textContent ?? '';
    },
    busy(): boolean {
      return container.querySelector('button')?.disabled ?? false;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('publishing an accepted checkpoint', () => {
  it('refuses an empty slug without asking the server', async () => {
    const calls = serving(() => reply({}));
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.click();

    assert.deepEqual(calls, [], 'it published without a slug');
    assert.match(view.container.textContent ?? '', /Choose a slug/);
    view.unmount();
  });

  it('sends the slug that was typed', async () => {
    const calls = serving(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.body?.slug, 'my-site');
    assert.match(
      view.container.textContent ?? '',
      /https:\/\/my-site\.example/,
    );
    view.unmount();
  });

  it('reuses the slug it published under, and stops asking for one', async () => {
    const calls = serving(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();

    assert.equal(view.slug(), null, 'it still asks for a slug it already has');
    assert.match(view.label(), /Republish/);

    await view.click();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.body?.slug, 'my-site');
    view.unmount();
  });

  it('names the files it could not publish', async () => {
    serving(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: ['app.tsx'],
      }),
    );
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();

    assert.match(view.container.textContent ?? '', /skipped file/);
    assert.match(view.container.textContent ?? '', /app\.tsx/);
    view.unmount();
  });

  it('keeps the slug across a new checkpoint, so nobody retypes it', async () => {
    // The site's name is not a fact about one checkpoint. Forgetting it with
    // the result would ask somebody to retype it after every accepted change.
    const calls = serving(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();
    await view.render(<PublishButton snapshot={snapshot('r2')} />);

    assert.equal(view.slug(), null, 'it asked again for a slug it already had');
    assert.match(view.label(), /Republish/);

    await view.click();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.body?.slug, 'my-site');
    view.unmount();
  });

  it('discards a publish that lands after the checkpoint moved on', async () => {
    // Clearing the result is only half of it. The request that was already
    // in flight still answers, and an unguarded completion then puts the
    // previous checkpoint's address back beside the new one, which is the
    // sentence this component is being fixed for. The same latest-wins gate
    // the push button uses on #123.
    const reply1 = held(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    serving(reply1.answer);
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();

    await view.render(<PublishButton snapshot={snapshot('r2')} />);
    await reply1.land();

    assert.doesNotMatch(
      view.container.textContent ?? '',
      /my-site\.example/,
      'a superseded publish said the new checkpoint was live',
    );
    assert.equal(view.busy(), false, 'the button was left waiting on it');
    view.unmount();
  });

  it('leaves an abandoned republish knowing the name it published under', async () => {
    // Putting the wait back to idle must not throw away what was already
    // known. It also must not invent it: the slug that comes back is the one
    // an earlier publish went out under, not the one this abandoned request
    // was carrying, whose fate nobody saw.
    const first = held(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    const calls = serving(first.answer);
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();
    await first.land();

    const second = held(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    serving(second.answer);
    await view.render(<PublishButton snapshot={snapshot('r2')} />);
    await view.click();
    await view.render(<PublishButton snapshot={snapshot('r3')} />);
    await second.land();

    assert.equal(view.slug(), null, 'it asked again for a slug it already had');
    assert.match(view.label(), /Republish/);

    await view.click();
    assert.equal(calls.length, 1, 'the first fake kept being called');
    view.unmount();
  });

  it('stops saying the project is live once a new checkpoint arrives', async () => {
    // The same rule the push button needed on #123: what is live is the
    // checkpoint that was published, and a later one has not been. Leaving
    // the sentence up reads as though the new work is already on the web.
    serving(() =>
      reply({
        ok: true,
        slug: 'my-site',
        url: 'https://my-site.example',
        skipped: [],
      }),
    );
    const view = await mount(<PublishButton snapshot={snapshot('r1')} />);
    await view.type('my-site');
    await view.click();
    assert.match(view.container.textContent ?? '', /my-site\.example/);

    await view.render(<PublishButton snapshot={snapshot('r2')} />);
    assert.doesNotMatch(
      view.container.textContent ?? '',
      /my-site\.example/,
      'it said the new checkpoint was live when only the old one was',
    );
    view.unmount();
  });
});
