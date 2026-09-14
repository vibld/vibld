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

function serving(answer: () => Response): Call[] {
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
