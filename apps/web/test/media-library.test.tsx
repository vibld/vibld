import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { MediaLibrary } from '../src/components/MediaLibrary.tsx';

/**
 * The media library control, as it is wired: what it lists, what it says
 * when the library cannot be read, and what it lets a person do.
 */

function serving(answer: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return answer(url, init);
  }) as typeof fetch;
  return calls;
}

const LIBRARY = {
  media: [
    {
      id: 'm1',
      path: 'media/loop.mp4',
      kind: 'video',
      contentType: 'video/mp4',
      bytes: 3 * 1024 * 1024,
      alt: 'Waves at dusk',
      posterPath: 'media/loop-poster.jpg',
    },
  ],
  usage: {
    files: 1,
    bytes: 3 * 1024 * 1024,
    maxFiles: 30,
    maxBytes: 200 * 1024 * 1024,
  },
};

async function mount(disabled = false) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<MediaLibrary disabled={disabled} />);
  });
  return {
    container,
    text: () => container.textContent ?? '',
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the media library control', () => {
  it('lists each file at the path the page will use, with what it shows', async () => {
    serving(() => Response.json(LIBRARY));
    const view = await mount();
    assert.match(view.text(), /\/media\/loop\.mp4/);
    assert.match(view.text(), /video, 3\.0 MB, with poster/);
    assert.match(view.text(), /Waves at dusk/);
    assert.match(view.text(), /1 of 30 files/);
    assert.ok(
      view.container.querySelector(
        'button[aria-label="Remove /media/loop.mp4"]',
      ),
    );
    view.unmount();
  });

  it('removes a file and reads the library again', async () => {
    let removed = false;
    const calls = serving((_url, init) => {
      if (init?.method === 'DELETE') {
        removed = true;
        return Response.json({ removed: 'm1' });
      }
      return Response.json(
        removed
          ? {
              ...LIBRARY,
              media: [],
              usage: { ...LIBRARY.usage, files: 0, bytes: 0 },
            }
          : LIBRARY,
      );
    });
    const view = await mount();
    const button = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove /media/loop.mp4"]',
    )!;
    await act(async () => {
      button.click();
    });
    assert.ok(calls.some((call) => call.url === '/api/media?id=m1'));
    assert.match(view.text(), /Removed \/media\/loop\.mp4\./);
    assert.match(view.text(), /0 of 30 files/);
    view.unmount();
  });

  it('asks for alt text and keeps Add disabled until a file is chosen', async () => {
    serving(() => Response.json({ ...LIBRARY, media: [] }));
    const view = await mount();
    assert.match(view.text(), /What it shows \(alt text\)/);
    const add = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Add to library',
    )!;
    assert.equal(add.disabled, true);
    view.unmount();
  });

  it('says the library is unavailable rather than showing it empty', async () => {
    serving(() => new Response('down', { status: 503 }));
    const view = await mount();
    assert.match(view.text(), /unavailable right now/);
    view.unmount();
  });

  it('disables every control while a run is going', async () => {
    serving(() => Response.json(LIBRARY));
    const view = await mount(true);
    assert.equal(view.container.querySelector('fieldset')?.disabled, true);
    view.unmount();
  });
});
