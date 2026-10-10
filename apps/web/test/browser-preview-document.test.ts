import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { scaffoldFiles } from '@vibld/ai';
import type { ProjectFile } from '@vibld/core';

import {
  loadAssets,
  previewAssets,
  projectAssets,
} from '../src/browser-preview/assets.ts';
import {
  INDEXED_DB_MODULE,
  PREVIEW_MESSAGE,
  PREVIEW_SANDBOX,
  previewDocument,
  usesIndexedDb,
} from '../src/browser-preview/document.ts';

/** The page the in-browser preview (D125) is shown as, and what it asks for. */

const PAGE = scaffoldFiles(
  { title: 'Crumb & Co', description: 'A bakery.' },
  [],
).find((file) => file.path === 'index.html')!.content;

function payloadOf(page: string): {
  js: string;
  css: string;
  assets: unknown[];
} {
  const match =
    /<script type="application\/json" id="vibld-preview-payload">([\s\S]*?)<\/script>/.exec(
      page,
    );
  assert.ok(match, 'the page carries its payload');
  return JSON.parse(match[1]!);
}

describe('the preview page', () => {
  const page = previewDocument({
    indexHtml: PAGE,
    importMap: { imports: { react: 'https://esm.sh/react@%5E19.3.0' } },
    js: 'console.log("</script><script>alert(1)</script>");',
    css: '.a { color: red; }',
    assets: [{ path: 'media/hero.jpg', kind: 'media' }],
  });

  it("is the project's own index.html, without its module script", () => {
    assert.match(page, /<title>Crumb &amp; Co<\/title>/);
    assert.match(page, /<div id="root"><\/div>/);
    assert.doesNotMatch(page, /src="\/src\/main\.tsx"/);
  });

  it('declares the import map before anything can load a module', () => {
    const head = page.slice(page.indexOf('<head>'));
    assert.ok(head.indexOf('type="importmap"') < head.indexOf('<script>'));
    assert.match(page, /"react":"https:\/\/esm\.sh\/react@%5E19\.3\.0"/);
  });

  it("drops the project's Content-Security-Policy, which would block the inline bundle", () => {
    const strict = previewDocument({
      indexHtml: PAGE.replace(
        '<head>',
        `<head>\n<meta http-equiv="Content-Security-Policy" content="script-src 'self'; style-src 'self'" />`,
      ),
      importMap: { imports: {} },
      js: '',
      css: '',
      assets: [],
    });
    assert.doesNotMatch(strict, /Content-Security-Policy/i);
  });

  it('carries the code as data that cannot close its own script element', () => {
    // The import map, the payload, the bootstrap and the inspector (D188).
    assert.equal((page.match(/<\/script>/g) ?? []).length, 4);
    const payload = payloadOf(page);
    assert.equal(
      payload.js,
      'console.log("</script><script>alert(1)</script>");',
    );
    assert.equal(payload.css, '.a { color: red; }');
    assert.deepEqual(payload.assets, [
      { path: 'media/hero.jpg', kind: 'media' },
    ]);
  });

  it('drops a module entry whose src is not quoted', () => {
    const page = previewDocument({
      indexHtml: PAGE.replace(
        /<script type="module" src="\/src\/main\.tsx"><\/script>/,
        '<script type=module src=/src/main.tsx></script>',
      ),
      importMap: { imports: {} },
      js: '',
      css: '',
      assets: [],
    });
    assert.doesNotMatch(page, /src=\/src\/main\.tsx/);
  });

  it('keeps a script that is not the project entry', () => {
    const kept = previewDocument({
      indexHtml: PAGE.replace(
        '</body>',
        '<script type="module" src="https://cdn.example/widget.js"></script></body>',
      ),
      importMap: { imports: {} },
      js: '',
      css: '',
      assets: [],
    });
    assert.match(kept, /src="https:\/\/cdn\.example\/widget\.js"/);
  });

  it('runs in a frame that never shares the builder origin', () => {
    assert.match(PREVIEW_SANDBOX, /\ballow-scripts\b/);
    assert.doesNotMatch(
      PREVIEW_SANDBOX,
      /allow-same-origin|allow-top-navigation/,
    );
  });
});

describe('IndexedDB in the preview', () => {
  it('gives an app that uses it an in-memory database before its code runs', () => {
    const page = previewDocument({
      indexHtml: PAGE,
      importMap: { imports: {} },
      js: 'const request = indexedDB.open("notes");',
      css: '',
      assets: [],
    });
    const { js } = payloadOf(page);
    const first = js.split('\n')[0]!;
    assert.match(first, /^import "data:text\/javascript,/);
    assert.ok(
      decodeURIComponent(first).includes(INDEXED_DB_MODULE),
      'the shim loads fake-indexeddb',
    );
  });

  it('notices the packages that wrap it, and leaves other apps alone', () => {
    assert.ok(usesIndexedDb('import { openDB } from "idb";'));
    assert.ok(usesIndexedDb('import Dexie from "dexie";'));
    assert.ok(usesIndexedDb('import { get } from "idb-keyval";'));
    assert.ok(
      usesIndexedDb('const { default: Dexie } = await import("dexie");'),
    );
    assert.ok(!usesIndexedDb('import { motion } from "motion/react";'));
  });
});

describe('what the page asks for', () => {
  const files: ProjectFile[] = [
    {
      path: 'src/App.tsx',
      content:
        'export default () => <><img src="/media/hero-loaf.jpg" /><img src="/logo.svg" /></>;',
    },
    { path: 'public/logo.svg', content: '<svg/>' },
  ];

  it('lists the media the code names and the public files', () => {
    assert.deepEqual(previewAssets(files), [
      { path: 'media/hero-loaf.jpg', kind: 'media' },
      { path: 'logo.svg', kind: 'public' },
    ]);
  });

  it("reads media from the caller's own library, signed in, and leaves out what it cannot read", async () => {
    const asked: { url: string; auth: string | null }[] = [];
    const loaded = await loadAssets(
      [...files, { path: 'src/B.tsx', content: '"/media/gone.png"' }],
      [
        { path: 'media/hero-loaf.jpg', kind: 'media' },
        { path: 'media/gone.png', kind: 'media' },
        { path: 'logo.svg', kind: 'public' },
      ],
      (async (url: string, init?: RequestInit) => {
        asked.push({
          url,
          auth: new Headers(init?.headers).get('authorization'),
        });
        return url.includes('gone')
          ? new Response('{}', { status: 404 })
          : new Response(new Uint8Array([1, 2, 3]), {
              headers: { 'content-type': 'image/jpeg' },
            });
      }) as typeof fetch,
      async () => 'token-1',
    );
    assert.deepEqual(asked, [
      {
        url: '/api/media/file?path=media%2Fhero-loaf.jpg',
        auth: 'Bearer token-1',
      },
      { url: '/api/media/file?path=media%2Fgone.png', auth: 'Bearer token-1' },
    ]);
    assert.deepEqual(
      loaded.map((asset) => asset.path),
      ['media/hero-loaf.jpg', 'logo.svg'],
    );
    assert.equal(loaded[1]!.blob.type, 'image/svg+xml');
    assert.equal(await loaded[1]!.blob.text(), '<svg/>');
  });
});

describe('a stylesheet the page is handed', () => {
  it('names the files it references from the root, where they are served', async () => {
    const loaded = await loadAssets(
      [
        {
          path: 'public/css/site.css',
          content:
            '@import "./theme.css"; body { background: url(../hero.png); }',
        },
      ],
      [{ path: 'css/site.css', kind: 'public' }],
      fetch,
      async () => null,
    );
    assert.equal(
      await loaded[0]!.blob.text(),
      '@import "/css/theme.css"; body { background: url(/hero.png); }',
    );
  });
});

describe("the page's request for its files", () => {
  /** Runs the page's bootstrap against a stand-in window and parent. */
  function boot(
    assets: { path: string; kind: 'public' }[] = [
      { path: 'logo.svg', kind: 'public' },
    ],
    workers: { path: string; js: string }[] = [],
    js = 'export {};',
  ) {
    const page = previewDocument({
      indexHtml: PAGE,
      importMap: { imports: {} },
      js,
      css: '',
      assets,
      workers,
    });
    const bootstrap = /<script>(\(function \(\) {[\s\S]*?)<\/script>/.exec(
      page,
    )![1]!;
    const payload = /id="vibld-preview-payload">([\s\S]*?)<\/script>/.exec(
      page,
    )![1]!;
    const sent: { kind: string }[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const timers: (() => void)[] = [];
    const appended: unknown[] = [];
    const parsed: (() => void)[] = [];
    const parent = {
      postMessage: (message: { kind: string }) => sent.push(message),
    };
    const element = () => ({ addEventListener() {}, textContent: '' });
    const attributes: Record<string, string> = {
      href: '/logo.svg?v=2',
      src: '/logo.svg#mark',
      poster: './logo.svg',
      srcset: 'logo.svg 1x, about 2x',
    };
    const icon = {
      getAttribute: (name: string) => attributes[name] ?? null,
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
    };
    const started: { url: string; options: unknown }[] = [];
    const blobs: Blob[] = [];
    const frameWindow: Record<string, unknown> = {
      Worker: function Worker(
        this: { postMessage: (message: unknown) => void },
        url: string,
        options: unknown,
      ) {
        started.push({ url, options });
        this.postMessage = (message) => started.push({ url, options: message });
      },
      SharedWorker: function SharedWorker() {
        throw new Error('Access to shared workers is denied');
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === 'message') listeners.push(listener);
      },
      removeEventListener() {},
    };
    runInNewContext(bootstrap, {
      parent,
      Blob,
      MessageChannel,
      URL: {
        createObjectURL: (blob: Blob) => {
          blobs.push(blob);
          return 'blob:null/1';
        },
      },
      setInterval: (tick: () => void) => {
        timers.push(tick);
        return timers.length;
      },
      clearInterval: (id: number) => {
        timers[id - 1] = () => {};
      },
      document: {
        readyState: 'loading',
        addEventListener: (type: string, listener: () => void) => {
          if (type === 'DOMContentLoaded') parsed.push(listener);
        },
        getElementById: () => ({ textContent: payload }),
        querySelectorAll: () => [icon],
        createElement: element,
        head: { appendChild: (node: unknown) => appended.push(node) },
        body: { appendChild: (node: unknown) => appended.push(node) },
      },
      window: frameWindow,
    });
    return {
      parent,
      sent,
      listeners,
      timers,
      appended,
      attributes,
      parsed,
      frameWindow,
      started,
      blobs,
    };
  }

  it('asks again until the builder answers, so a request sent before it listens is not the last', () => {
    const { parent, sent, listeners, timers, appended, attributes, parsed } =
      boot();
    assert.deepEqual(
      sent.map((message) => message.kind),
      ['assets'],
    );
    timers[0]!();
    timers[0]!();
    assert.deepEqual(
      sent.map((message) => message.kind),
      ['assets', 'assets', 'assets'],
    );
    listeners[0]!({
      source: parent,
      data: {
        source: PREVIEW_MESSAGE.fromBuilder,
        assets: [{ path: 'logo.svg', blob: new Blob(['<svg/>']) }],
      },
    });
    assert.equal(appended.length, 0, 'nothing runs before the body exists');
    parsed[0]!();
    assert.equal(appended.length, 2, 'the stylesheet and the module start');
    assert.equal(
      attributes.href,
      'blob:null/1',
      "index.html's own reference is served too, without its query",
    );
    assert.equal(attributes.src, 'blob:null/1#mark', 'a fragment is kept');
    assert.equal(
      attributes.poster,
      'blob:null/1',
      'a relative name is from the root',
    );
    assert.equal(attributes.srcset, 'blob:null/1 1x, about 2x');
    timers[0]!();
    assert.deepEqual(
      sent.map((message) => message.kind),
      ['assets', 'assets', 'assets', 'started'],
      'answered, it stops asking',
    );
  });

  it('starts an app with no files once the body is parsed', () => {
    const { sent, appended, parsed, timers } = boot([]);
    assert.equal(appended.length, 0);
    assert.equal(timers.length, 0, 'nothing to ask for');
    parsed[0]!();
    assert.equal(appended.length, 2);
    assert.deepEqual(
      sent.map((message) => message.kind),
      ['started'],
    );
  });

  it('serves a public file the code names relatively, from the root', () => {
    const { parent, listeners, parsed, appended } = boot(
      undefined,
      [],
      'img("logo.svg"); img(\'./logo.svg?v=2#mark\'); alt("a logo.svg file");',
    );
    listeners[0]!({
      source: parent,
      data: {
        source: PREVIEW_MESSAGE.fromBuilder,
        assets: [{ path: 'logo.svg', blob: new Blob(['<svg/>']) }],
      },
    });
    parsed[0]!();
    const script = appended[1] as { textContent: string };
    assert.equal(
      script.textContent,
      'img("blob:null/1"); img(\'blob:null/1#mark\'); alt("a logo.svg file");',
    );
  });

  it("serves the files a worker names from the worker's own code", async () => {
    const { parent, listeners, parsed, blobs } = boot(undefined, [
      { path: 'src/worker.ts', js: 'fetch("/logo.svg");' },
    ]);
    listeners[0]!({
      source: parent,
      data: {
        source: PREVIEW_MESSAGE.fromBuilder,
        assets: [{ path: 'logo.svg', blob: new Blob(['<svg/>']) }],
      },
    });
    parsed[0]!();
    const worker = blobs.find((blob) => blob.type === 'text/javascript')!;
    const text = await worker.text();
    assert.ok(text.endsWith('\nfetch("blob:null/1");'), text.slice(-80));
    assert.match(
      text,
      /^\(function installWorkerShim/,
      'it can start workers of its own',
    );
  });

  it('starts a module worker as a classic one that imports it', async () => {
    const { frameWindow, started, blobs, parsed } = boot(
      [],
      [{ path: 'src/built.ts', js: 'export {};' }],
    );
    parsed[0]!();
    blobs.length = 0;
    const Worker = frameWindow.Worker as new (
      url: string,
      options?: object,
    ) => unknown;
    new Worker('blob:null/worker', { type: 'module', name: 'w' });
    new Worker('blob:null/classic');
    new Worker('blob:null/1');
    assert.deepEqual(JSON.parse(JSON.stringify(started)), [
      { url: 'blob:null/1', options: { name: 'w' } },
      { url: 'blob:null/classic' },
      { url: 'blob:null/1', options: {} },
    ]);
    assert.match(
      await blobs[1]!.text(),
      /import\("blob:null\/1"\)/,
      'a worker the bundle built is loaded as a module, started either way',
    );
    const loader = await blobs[0]!.text();
    assert.match(loader, /import\("blob:null\/worker"\)/);
    assert.match(loader, /held\.forEach/, 'messages sent meanwhile are kept');
  });

  it('starts a shared worker as a worker of its own, with a port', async () => {
    const { frameWindow, started, blobs, parsed } = boot(
      [],
      [{ path: 'src/shared.ts', js: 'export {};' }],
    );
    parsed[0]!();
    blobs.length = 0;
    started.length = 0;
    const SharedWorker = frameWindow.SharedWorker as new (
      url: string,
      options?: object | string,
    ) => { port: MessagePort };
    const shared = new SharedWorker('blob:null/1', 'chat');
    assert.ok(shared.port, 'it has a port to talk on');
    shared.port.close();
    assert.deepEqual(JSON.parse(JSON.stringify(started)), [
      { url: 'blob:null/1', options: { name: 'chat' } },
      { url: 'blob:null/1', options: 'connect' },
    ]);
    const loader = await blobs[0]!.text();
    assert.match(loader, /import\("blob:null\/1"\)/, 'a built one is a module');
    assert.match(loader, /new MessageEvent\("connect"/);
    new SharedWorker('blob:null/classic');
    assert.match(
      await blobs[1]!.text(),
      /importScripts\("blob:null\/classic"\)/,
    );
  });

  it('keeps storage in memory where the browser refuses the page any', () => {
    const { frameWindow } = boot([]);
    const storage = frameWindow.localStorage as Storage;
    storage.setItem('theme', 'dark');
    assert.equal(storage.getItem('theme'), 'dark');
    assert.equal(storage.getItem('missing'), null);
    assert.equal(storage.length, 1);
    storage.clear();
    assert.equal(storage.length, 0);
    assert.ok(frameWindow.sessionStorage);
  });

  it('serves a project file the code names by URL from its own text', async () => {
    const loaded = projectAssets(
      [{ path: 'src/assets/logo.svg', content: '<svg/>' }],
      ['src/assets/logo.svg', 'src/gone.png'],
    );
    assert.deepEqual(
      loaded.map(({ path, kind }) => ({ path, kind })),
      [{ path: 'src/assets/logo.svg', kind: 'project' }],
    );
    assert.equal(loaded[0]!.blob.type, 'image/svg+xml');
    assert.equal(await loaded[0]!.blob.text(), '<svg/>');
  });
});
