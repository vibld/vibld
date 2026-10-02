import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import type { StyleCard } from '@vibld/ai/style-gallery';

import {
  PAGE,
  StyleGalleryPicker,
} from '../src/components/StyleGalleryPicker.tsx';
import { loadStyleCards } from '../src/generation/style-gallery-client.ts';
import type { StyleCardsResult } from '../src/generation/style-gallery-client.ts';
import {
  STYLE_GALLERY_DATA,
  writeStyleGalleryAssets,
} from '../scripts/style-gallery-assets.ts';
import {
  handleStyleGallery,
  isStyleGalleryAssetPath,
  readStyleGalleryAsset,
  readGalleryStyle,
} from '../worker/style-gallery.ts';
import type { PrincipalGranted } from '../worker/principal.ts';

/** The style gallery's picker and the route behind it (D142, D144). */

function card(over: Partial<StyleCard> & { id: string }): StyleCard {
  return {
    name: over.id,
    kind: 'Product site',
    group: 'saas',
    category: 'monochrome-minimal',
    theme: 'light',
    style_tags: [],
    signature: [],
    palette: [
      { role: 'canvas', hex: '#ffffff' },
      { role: 'ink', hex: '#111111' },
      { role: 'glow (decorative)', hex: '#ff00aa' },
    ],
    fonts: { display: 'Inter', body: 'Inter' },
    ...over,
  };
}

const CARDS: StyleCard[] = [
  card({
    id: 'harbor',
    name: 'Harbor',
    kind: 'Editorial journal',
    category: 'editorial-serif',
    group: 'media-publishing',
    style_tags: ['serif'],
    fonts: { display: 'Fraunces', body: 'Inter' },
  }),
  card({
    id: 'nightshift',
    name: 'Nightshift',
    theme: 'dark',
    group: 'devtools',
  }),
  ...Array.from({ length: 30 }, (_, i) =>
    card({ id: `plain-${String(i).padStart(2, '0')}`, name: `Plain ${i}` }),
  ),
];

const loaded = (cards: StyleCard[]) => async (): Promise<StyleCardsResult> => ({
  ok: true,
  cards,
});

let mounted: (() => void) | null = null;
afterEach(() => {
  mounted?.();
  mounted = null;
});

async function mount(props: {
  value?: string | null;
  active?: boolean;
  loader?: () => Promise<StyleCardsResult>;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const changes: (string | null)[] = [];
  let root: Root;
  const render = (value: string | null, active: boolean) =>
    root.render(
      <StyleGalleryPicker
        active={active}
        value={value}
        onChange={(id) => changes.push(id)}
        disabled={false}
        loader={props.loader ?? loaded(CARDS)}
      />,
    );
  await act(async () => {
    root = createRoot(container);
    render(props.value ?? null, props.active ?? true);
  });
  mounted = () => {
    act(() => root.unmount());
    container.remove();
  };
  const cards = () => [
    ...container.querySelectorAll<HTMLButtonElement>('button.gallery__card'),
  ];
  return {
    container,
    changes,
    cards,
    names: () =>
      cards().map((b) => b.querySelector('.gallery__name')!.textContent),
    status: () => container.querySelector('[role="status"]')?.textContent,
    button: (text: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === text,
      ),
    rerender: (value: string | null, active: boolean) =>
      act(async () => render(value, active)),
    async choose(label: string, value: string) {
      const select = [...container.querySelectorAll('label')]
        .find((l) => l.textContent === label)!
        .parentElement!.querySelector('select')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          'value',
        )?.set?.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    async search(text: string) {
      const input = container.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}

describe('the style gallery picker', () => {
  it('loads nothing until it is opened', async () => {
    let calls = 0;
    const view = await mount({
      active: false,
      loader: async () => {
        calls += 1;
        return { ok: true, cards: CARDS };
      },
    });
    assert.equal(calls, 0);
    await view.rerender(null, true);
    assert.equal(calls, 1);
    await view.rerender(null, false);
    await view.rerender(null, true);
    assert.equal(calls, 1, 'loaded once, not on every opening');
  });

  it('shows a page of cards, and more on asking', async () => {
    const view = await mount({});
    assert.equal(view.cards().length, PAGE);
    assert.equal(view.status(), `${CARDS.length} styles match.`);
    await act(async () => view.button('Show more')!.click());
    assert.equal(view.cards().length, CARDS.length);
    assert.equal(view.button('Show more'), undefined);
  });

  it('shows the palette and the display and body faces', async () => {
    const view = await mount({});
    const harbor = view.cards()[0]!;
    assert.equal(
      harbor.querySelector('.gallery__fonts')!.textContent,
      'Fraunces / Inter',
    );
    const swatches = harbor.querySelectorAll('.gallery__swatch');
    assert.equal(swatches.length, 3);
    assert.equal(
      harbor.querySelectorAll('.gallery__swatch--decorative').length,
      1,
    );
    // One face for both is named once.
    assert.equal(
      view.cards()[1]!.querySelector('.gallery__fonts')!.textContent,
      'Inter',
    );
  });

  it('filters by theme, aesthetic and industry', async () => {
    const view = await mount({});
    await view.choose('Theme', 'dark');
    assert.deepEqual(view.names(), ['Nightshift']);
    await view.choose('Theme', '');
    await view.choose('Aesthetic', 'editorial-serif');
    assert.deepEqual(view.names(), ['Harbor']);
    await view.choose('Aesthetic', '');
    await view.choose('Industry', 'devtools');
    assert.deepEqual(view.names(), ['Nightshift']);
  });

  it('searches the name, descriptor and tags', async () => {
    const view = await mount({});
    await view.search('serif');
    assert.deepEqual(view.names(), ['Harbor']);
    await view.search('editorial journal');
    assert.deepEqual(view.names(), ['Harbor']);
    await view.search('nothing like this');
    assert.equal(view.status(), 'No style matches.');
  });

  it('chooses by id, and choosing the chosen one again clears it', async () => {
    const view = await mount({ value: 'harbor' });
    assert.match(view.container.textContent!, /Building in Harbor\./);
    assert.equal(view.cards()[0]!.getAttribute('aria-pressed'), 'true');
    await act(async () => view.cards()[0]!.click());
    await act(async () => view.cards()[1]!.click());
    await act(async () => view.button('Clear')!.click());
    assert.deepEqual(view.changes, [null, 'nightshift', null]);
  });

  it('clears a saved style the gallery no longer has', async () => {
    const view = await mount({ value: 'removed-since' });
    assert.ok(view.changes.length > 0);
    assert.ok(view.changes.every((change) => change === null));
  });

  it('says so when this copy has no gallery', async () => {
    const view = await mount({ loader: loaded([]) });
    assert.match(view.container.textContent!, /has no style gallery/);
  });

  it('offers to try again after a failure', async () => {
    let calls = 0;
    const view = await mount({
      loader: async () =>
        (calls += 1) === 1
          ? { ok: false, message: 'Down.' }
          : { ok: true, cards: CARDS },
    });
    assert.equal(
      view.container.querySelector('[role="alert"]')!.textContent,
      'Down.',
    );
    await act(async () => view.button('Try again')!.click());
    assert.equal(view.cards().length, PAGE);
  });
});

describe('loading the cards', () => {
  const answer = (body: string, status = 200, type = 'application/json') =>
    (async () =>
      new Response(body, {
        status,
        headers: { 'content-type': type },
      })) as typeof fetch;

  it('asks with the session token and keeps only cards', async () => {
    let auth: string | null = null;
    const result = await loadStyleCards({
      getToken: async () => 'tok',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        auth = new Headers(init.headers).get('authorization');
        return new Response(JSON.stringify([CARDS[0], { id: 1 }]));
      }) as typeof fetch,
    });
    assert.equal(auth, 'Bearer tok');
    assert.deepEqual(result, { ok: true, cards: [CARDS[0]] });
  });

  it('is a failure, not a rejection, when the session token fails', async () => {
    const result = await loadStyleCards({
      getToken: async () => {
        throw new Error('refresh failed');
      },
      fetchImpl: answer('[]'),
    });
    assert.equal(result.ok, false);
  });

  it("passes on the Worker's refusal", async () => {
    const result = await loadStyleCards({
      getToken: async () => null,
      fetchImpl: answer(JSON.stringify({ error: 'Sign in first.' }), 401),
    });
    assert.deepEqual(result, { ok: false, message: 'Sign in first.' });
  });

  it('is a failure when the answer is not a list (no Worker)', async () => {
    const result = await loadStyleCards({
      getToken: async () => null,
      fetchImpl: answer('<!doctype html>', 200, 'text/html'),
    });
    assert.equal(result.ok, false);
  });
});

describe('/api/style-gallery', () => {
  const granted = async () =>
    ({ denied: null, principal: {} }) as unknown as PrincipalGranted;
  const assets = (files: Record<string, string>) => ({
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      const body = files[path];
      // A missing file is the app's shell, as `not_found_handling` serves it.
      return body === undefined
        ? new Response('<!doctype html>', {
            headers: { 'content-type': 'text/html' },
          })
        : new Response(body, {
            headers: { 'content-type': 'application/json' },
          });
    },
  });
  const get = new Request('https://vibld.test/api/style-gallery');

  it('answers the cards the build wrote, privately', async () => {
    const response = await handleStyleGallery(
      get,
      { ASSETS: assets({ '/_style-gallery/cards.json': '[{"id":"a"}]' }) },
      granted,
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('cache-control'),
      'private, max-age=3600',
    );
    assert.equal(response.headers.get('vary'), 'Authorization');
    assert.deepEqual(await response.json(), [{ id: 'a' }]);
  });

  it('is an empty gallery when the build wrote none', async () => {
    for (const env of [{ ASSETS: assets({}) }, {}]) {
      const response = await handleStyleGallery(get, env, granted);
      assert.deepEqual(await response.json(), []);
    }
  });

  it('turns away a caller the principal check refuses', async () => {
    const response = await handleStyleGallery(
      get,
      { ASSETS: assets({ '/_style-gallery/cards.json': '[]' }) },
      async () => ({ denied: new Response('no', { status: 401 }) }),
    );
    assert.equal(response.status, 401);
  });

  it('takes GET only', async () => {
    const response = await handleStyleGallery(
      new Request(get, { method: 'POST' }),
      {},
      granted,
    );
    assert.equal(response.status, 405);
  });

  it('reads one style, or nothing for a file that is not there', async () => {
    const env = {
      ASSETS: assets({ '/_style-gallery/styles/a.json': '{"id":"a"}' }),
    };
    const found = await readStyleGalleryAsset(env, get.url, 'styles/a.json');
    assert.deepEqual(await found!.json(), { id: 'a' });
    assert.equal(
      await readStyleGalleryAsset(env, get.url, 'styles/b.json'),
      null,
    );
  });

  it("reads a style's tokens file and guidance, or nothing for one this copy lacks (D145, D146)", async () => {
    const entry = {
      id: 'a',
      name: 'Alpha',
      kind: 'Quiet product site',
      signature: ['flat white surfaces'],
      design_tokens: {
        theme: 'light',
        colors: [{ token: '--color-canvas', role: 'canvas', hex: '#ffffff' }],
        fonts: { display: 'Inter', body: 'Inter' },
        type_scale: [
          {
            token: '--text-16',
            size: '16px',
            font: 'Inter',
            weight: 400,
            line_height: 1.5,
            tracking: '0',
          },
        ],
        spacing: { base_unit: '4px', density: 'comfortable', scale: [] },
        radius: { cards: '8px' },
      },
    };
    const env = {
      ASSETS: assets({
        '/_style-gallery/styles/a.json': JSON.stringify({
          ...entry,
          contrast_checks: [],
          build_prompt: '### Goal\nBuild it.',
        }),
        '/_style-gallery/baseline.json': JSON.stringify({
          baseline: '### Rules\nBe kind.',
        }),
      }),
    };
    const style = await readGalleryStyle(env, get.url, 'a');
    assert.ok(style?.ok);
    const { tokens, guidance } = style;
    assert.ok(
      guidance.indexOf('Be kind.') < guidance.indexOf('Build it.'),
      'the baseline, then the build prompt',
    );
    assert.match(tokens!, /@import '@fontsource\/inter\/400\.css';/);
    assert.match(tokens!, /--color-canvas: #ffffff;/);
    assert.match(tokens!, /--radius-cards: 8px;/);
    // The shorter direction a mockup run is drawn in (D146).
    assert.match(
      style!.direction,
      /^Draw it in one style from the style gallery/,
    );
    assert.match(style!.direction, /#ffffff/);
    assert.equal(await readGalleryStyle(env, get.url, 'b'), null);
    assert.equal(await readGalleryStyle(env, get.url, '../cards'), null);
  });

  it("answers one style's colors and pairs for the editor (D147)", async () => {
    const entry = {
      id: 'a',
      design_tokens: {
        colors: [{ token: '--color-canvas', role: 'canvas', hex: '#ffffff' }],
      },
      contrast_checks: [],
      build_prompt: 'not sent',
    };
    const env = {
      ASSETS: assets({
        '/_style-gallery/styles/a.json': JSON.stringify(entry),
      }),
    };
    const found = await handleStyleGallery(
      new Request('https://vibld.test/api/style-gallery?style=a'),
      env,
      granted,
    );
    assert.deepEqual(await found.json(), {
      id: 'a',
      design_tokens: entry.design_tokens,
      contrast_checks: [],
    });
    for (const style of ['b', '../cards']) {
      const missing = await handleStyleGallery(
        new Request(`https://vibld.test/api/style-gallery?style=${style}`),
        env,
        granted,
      );
      assert.equal(missing.status, 404);
    }
  });

  it("refuses color edits that fail the style's pairs (D147)", async () => {
    const entry = {
      id: 'a',
      name: 'Alpha',
      kind: 'Quiet product site',
      signature: ['flat white surfaces'],
      build_prompt: '### Goal',
      visual_style: { palette: [] },
      design_tokens: {
        theme: 'light',
        colors: [
          { token: '--color-canvas', role: 'canvas', hex: '#ffffff' },
          { token: '--color-text', role: 'text', hex: '#111111' },
        ],
        fonts: { display: 'Inter', body: 'Inter' },
        type_scale: [],
        spacing: { base_unit: '4px', density: 'comfortable', scale: [] },
        radius: {},
      },
      contrast_checks: [
        {
          use: 'body text on canvas',
          fg: '#111111',
          bg: '#ffffff',
          ratio: 18.88,
          target: 4.5,
        },
      ],
    };
    const env = {
      ASSETS: assets({
        '/_style-gallery/styles/a.json': JSON.stringify(entry),
      }),
    };
    const refused = await readGalleryStyle(env, get.url, 'a', {
      '--color-text': '#eeeeee',
    });
    assert.equal(refused?.ok, false);
    const kept = await readGalleryStyle(env, get.url, 'a', {
      '--color-text': '#000000',
    });
    assert.ok(kept?.ok);
    assert.match(kept.tokens, /--color-text: #000000;/);
    assert.match(kept.guidance, /--color-text #111111 is now #000000/);
  });

  it('marks the build files as never served as they are', () => {
    assert.equal(isStyleGalleryAssetPath('/_style-gallery/cards.json'), true);
    assert.equal(isStyleGalleryAssetPath('/assets/index.js'), false);
  });

  it('runs the Worker first for the build files', () => {
    const config = readFileSync(
      new URL('../wrangler.jsonc', import.meta.url),
      'utf8',
    );
    assert.match(
      config,
      /"run_worker_first":\s*\[[^\]]*"\/_style-gallery\/\*"/,
    );
  });
});

describe('writing the gallery into the build', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });
  const out = () => {
    const dir = mkdtempSync(join(tmpdir(), 'style-gallery-'));
    dirs.push(dir);
    return dir;
  };

  it('writes an empty gallery for a copy without the data', () => {
    const dir = out();
    assert.equal(writeStyleGalleryAssets(dir, join(dir, 'absent.json')), 0);
    assert.equal(
      readFileSync(join(dir, '_style-gallery/cards.json'), 'utf8'),
      '[]',
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(dir, '_style-gallery/baseline.json'), 'utf8'),
      ),
      { baseline: '' },
    );
  });

  let data: string | null = null;
  try {
    data = readFileSync(STYLE_GALLERY_DATA, 'utf8');
  } catch {
    data = null;
  }

  it(
    'writes every style, its card and the baseline',
    { skip: data === null && 'no style gallery data in this copy' },
    () => {
      const dir = out();
      const source = join(dir, 'source.json');
      writeFileSync(source, data!);
      const count = writeStyleGalleryAssets(dir, source);
      assert.equal(count, 1342);
      const root = join(dir, '_style-gallery');
      const cards = JSON.parse(readFileSync(join(root, 'cards.json'), 'utf8'));
      assert.equal(cards.length, count);
      assert.equal(readdirSync(join(root, 'styles')).length, count);
      const baseline = JSON.parse(
        readFileSync(join(root, 'baseline.json'), 'utf8'),
      );
      assert.ok(baseline.baseline.length > 0);
      const first = JSON.parse(
        readFileSync(join(root, 'styles', `${cards[0].id}.json`), 'utf8'),
      );
      assert.equal(first.id, cards[0].id);
      assert.ok(first.build_prompt);
    },
  );
});
