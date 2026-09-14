import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ProjectSnapshot } from '@vibld/core';
import { ExportButton } from '../src/components/ExportButton.tsx';

/**
 * Taking the project away, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 * `createZip` and `archiveName` have their own tests; what was unexercised is
 * the wiring between them and the browser.
 */

function snapshot(
  files: ProjectSnapshot['files'],
  revision = 'r1',
): ProjectSnapshot {
  return { revision, files } as ProjectSnapshot;
}

const GOOD = [{ path: 'index.html', content: '<h1>hi</h1>' }];

/**
 * Stands in for the browser's download, which nothing here can observe: the
 * anchor is never in the document, and a real click would ask the runner's
 * DOM to fetch a blob URL.
 */
/** Never reset, so one test's late revoke cannot look like another's. */
let handles = 0;

function watchDownloads() {
  const offered: { href: string | null; name: string | null; size: number }[] =
    [];
  const revoked: string[] = [];
  const madeUrl = URL.createObjectURL;
  const killedUrl = URL.revokeObjectURL;
  const element = window.document.createElement.bind(window.document);
  const blobs = new Map<string, Blob>();

  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:fake-${(handles += 1)}`;
    blobs.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;
  window.document.createElement = ((tag: string) => {
    const made = element(tag) as HTMLElement;
    if (tag === 'a') {
      made.click = () => {
        const href = made.getAttribute('href');
        offered.push({
          href,
          name: made.getAttribute('download'),
          size: (href && blobs.get(href)?.size) || 0,
        });
      };
    }
    return made;
  }) as typeof window.document.createElement;

  return {
    offered,
    revoked,
    /**
     * Drains first: the revoke is deferred, so a test that ends without
     * waiting leaves a timer that fires inside the next one and records
     * against its stubs.
     */
    async restore() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      URL.createObjectURL = madeUrl;
      URL.revokeObjectURL = killedUrl;
      window.document.createElement = element;
    },
  };
}

async function mount(files: ProjectSnapshot['files'], revision = 'r1') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ExportButton snapshot={snapshot(files, revision)} />);
  });
  return {
    container,
    text: () => container.textContent ?? '',
    async click() {
      const button = container.querySelector('button');
      assert.ok(button, 'no download button');
      await act(async () => {
        button.click();
      });
    },
    /**
     * Synchronously, so a deferred revoke cannot have run yet. Awaiting
     * `act` yields to the event loop, which lets a `setTimeout(..., 0)`
     * fire and makes "deferred" indistinguishable from "immediate".
     */
    clickNow() {
      const button = container.querySelector('button');
      assert.ok(button, 'no download button');
      act(() => {
        button.click();
      });
    },
    async render(next: ProjectSnapshot['files'], nextRevision = 'r1') {
      await act(async () =>
        root.render(<ExportButton snapshot={snapshot(next, nextRevision)} />),
      );
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('taking the project away, as it is actually wired', () => {
  it('offers the packaged project under the checkpoint it came from', async () => {
    const watch = watchDownloads();
    try {
      const view = await mount(GOOD);
      await view.click();

      assert.equal(watch.offered.length, 1);
      assert.equal(watch.offered[0]?.name, 'vibld-r1.zip');
      assert.ok(
        (watch.offered[0]?.size ?? 0) > 0,
        'it offered an empty download',
      );
      view.unmount();
    } finally {
      await watch.restore();
    }
  });

  it('lets go of the handle once the click has been dispatched', async () => {
    // Revoking in the same tick can cancel the download in some browsers,
    // so it is deferred rather than skipped: skipping it leaks the blob for
    // as long as the page is open.
    const watch = watchDownloads();
    try {
      const view = await mount(GOOD);
      view.clickNow();
      assert.deepEqual(watch.revoked, [], 'revoked before the click landed');

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.deepEqual(watch.revoked, [watch.offered[0]?.href]);
      view.unmount();
    } finally {
      await watch.restore();
    }
  });

  it('says what the packager refused, in its own words', async () => {
    const watch = watchDownloads();
    try {
      const view = await mount([{ path: '../escaped.txt', content: 'x' }]);
      await view.click();

      const alert = view.container.querySelector('[role="alert"]');
      assert.match(
        alert?.textContent ?? '',
        /Relative segment in archive path/,
      );
      assert.deepEqual(watch.offered, [], 'it offered a download it refused');
      view.unmount();
    } finally {
      await watch.restore();
    }
  });

  it('clears a refusal once a later attempt works', async () => {
    const watch = watchDownloads();
    try {
      const view = await mount([{ path: '../escaped.txt', content: 'x' }]);
      await view.click();
      assert.match(view.text(), /Relative segment/);

      await view.render(GOOD);
      await view.click();

      assert.doesNotMatch(view.text(), /Relative segment/);
      assert.equal(watch.offered.length, 1);
      view.unmount();
    } finally {
      await watch.restore();
    }
  });

  it('drops a refusal that was about an earlier checkpoint', async () => {
    // It is about the checkpoint it was refused for. Left up under a later
    // one it reads as "this cannot be exported either", which stops
    // somebody trying something that would work.
    const watch = watchDownloads();
    try {
      const view = await mount([{ path: '../escaped.txt', content: 'x' }]);
      await view.click();
      assert.match(view.text(), /Relative segment/);

      await view.render(GOOD, 'r2');

      assert.doesNotMatch(
        view.text(),
        /Relative segment/,
        'a refusal about one checkpoint was left under another',
      );
      view.unmount();
    } finally {
      await watch.restore();
    }
  });
});
