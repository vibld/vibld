import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';
import { designBrief } from '@vibld/ai/design-templates';
import { STYLE_GALLERY_INDEX } from '@vibld/ai/style-gallery-index';

import { TemplatePicker } from '../src/components/TemplatePicker.tsx';
import { loadTemplateBrief } from '../src/templates/template-brief-client.ts';
import type { TemplateBriefResult } from '../src/templates/template-brief-client.ts';
import { writeTemplateAssets } from '../scripts/template-assets.ts';
import { GATED_PATHS } from '../worker/access-gate.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { handleTemplateBrief } from '../worker/template-briefs.ts';

/**
 * A design template as inspiration in the builder (docs/decisions.md,
 * D148): the catalog listed and searched in the composer, and a chosen
 * template's brief added to the message as text.
 */

const listed = DESIGN_TEMPLATE_INDEX.filter((t) => !t.mergedInto);
const first = listed[0]!;
// The style gallery is listed beside the designs, every style a website
// (D162).
const styles = STYLE_GALLERY_INDEX;
const stylesIn = (...groups: string[]) =>
  styles.filter((s) => groups.includes(s.group)).length;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function click(element: Element | null | undefined) {
  assert.ok(element, 'no such element');
  act(() => {
    (element as HTMLElement).click();
  });
}

function type(element: Element | null | undefined, value: string) {
  assert.ok(element, 'no such element');
  const select = element.tagName === 'SELECT';
  const proto = select
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(select ? 'change' : 'input', { bubbles: true }),
    );
  });
}

async function mount(props: {
  active: boolean;
  room?: number;
  message?: string;
  loader?: (id: string) => Promise<TemplateBriefResult>;
  withStyles?: boolean;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const added: string[] = [];
  const asked: string[] = [];
  const loader =
    props.loader ??
    (async (id: string): Promise<TemplateBriefResult> => {
      asked.push(id);
      return { ok: true, brief: `Brief for ${id}` };
    });
  const root = createRoot(container);
  let message = props.message ?? '';
  let shown = props.active;
  const render = (active: boolean) =>
    root.render(
      <TemplatePicker
        active={(shown = active)}
        disabled={false}
        message={message}
        room={props.room ?? 40_000}
        onAdd={(text) => added.push(text)}
        loader={loader}
        withStyles={props.withStyles ?? true}
      />,
    );
  await act(async () => render(props.active));
  await settle();
  return {
    container,
    added,
    asked,
    open: async () => {
      await act(async () => render(true));
      await settle();
    },
    setMessage: async (next: string) => {
      message = next;
      await act(async () => render(shown));
    },
    /** The cards drawn, as they are. */
    drawn: () => [...container.querySelectorAll('.gallery__card')],
    /** Every card the filters pass, after "Show more" until there is none. */
    cards: () => {
      for (let more = showMore(container); more; more = showMore(container)) {
        click(more);
      }
      return [...container.querySelectorAll('.gallery__card')];
    },
  };
}

const showMore = (container: Element) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Show more',
  );

const addButton = (container: Element) =>
  [...container.querySelectorAll('button')].find((b) =>
    /Add to the message/.test(b.textContent ?? ''),
  );

describe('the template picker', () => {
  it('loads nothing until its panel opens, then lists every template and style', async () => {
    const view = await mount({ active: false });
    assert.match(view.container.textContent ?? '', /Loading templates/);
    await view.open();
    assert.equal(view.cards().length, listed.length + styles.length);
    assert.ok(
      DESIGN_TEMPLATE_INDEX.some((t) => t.mergedInto),
      'the catalog has merged entries, which are not listed',
    );
  });

  it('draws the cards a page at a time, from the top again when the filters change', async () => {
    const view = await mount({ active: true });
    assert.equal(view.drawn().length, 60);
    click(showMore(view.container));
    assert.equal(view.drawn().length, 120);
    type(view.container.querySelector('select'), 'websites');
    assert.equal(view.drawn().length, 60);
  });

  it('lists no styles in a copy built without their briefs', async () => {
    const view = await mount({ active: true, withStyles: false });
    assert.equal(view.cards().length, listed.length);
  });

  it('filters by category and subcategory (D161), and searches name and summary', async () => {
    const view = await mount({ active: true });
    const [category] = [...view.container.querySelectorAll('select')];
    type(category, 'apps');
    assert.equal(
      view.cards().length,
      listed.filter((t) => t.kind === 'app' && t.format !== 'screen').length,
    );
    type(category, 'websites/ecommerce');
    assert.equal(
      view.cards().length,
      listed.filter((t) => t.kind === 'site' && t.category === 'ecommerce')
        .length + stylesIn('ecommerce'),
    );
    type(category, 'websites/portfolio');
    assert.equal(
      view.cards().length,
      listed.filter((t) => t.kind === 'site' && t.category === 'portfolio')
        .length + stylesIn('agency-portfolio'),
    );
    type(category, 'websites/shopify');
    assert.deepEqual(
      view.cards().map((c) => c.querySelector('.gallery__name')?.textContent),
      ['Hardline Depot', 'Plain Matter'],
    );
    type(category, 'screens');
    assert.equal(
      view.cards().length,
      listed.filter((t) => t.format === 'screen').length,
    );
    type(category, '');
    type(view.container.querySelector('input[type="search"]'), styles[0]!.name);
    assert.ok(
      view.cards().some((c) => c.textContent?.includes(styles[0]!.name)),
    );
    type(view.container.querySelector('input[type="search"]'), first.name);
    assert.ok(view.cards().some((c) => c.textContent?.includes(first.summary)));
    type(view.container.querySelector('input[type="search"]'), 'zzzzqqq');
    assert.equal(view.cards().length, 0);
    assert.match(view.container.textContent ?? '', /No template matches/);
  });

  it("adds the chosen template's brief to the message", async () => {
    const view = await mount({ active: true });
    assert.equal(addButton(view.container)?.hasAttribute('disabled'), true);
    click(view.cards()[0]);
    click(addButton(view.container));
    await settle();
    assert.deepEqual(view.asked, [first.id]);
    assert.deepEqual(view.added, [`Brief for ${first.id}`]);
  });

  it('refuses a brief longer than the message has left', async () => {
    const view = await mount({ active: true, room: 10 });
    click(view.cards()[0]);
    click(addButton(view.container));
    await settle();
    assert.deepEqual(view.added, []);
    assert.match(
      view.container.querySelector('[role="alert"]')?.textContent ?? '',
      /longer than what the message has left/,
    );
  });

  it('drops a brief when the message changed while it loaded', async () => {
    let finish = (_: TemplateBriefResult) => {};
    const view = await mount({
      active: true,
      message: 'A bakery site.',
      loader: () =>
        new Promise<TemplateBriefResult>((resolve) => {
          finish = resolve;
        }),
    });
    click(view.cards()[0]);
    click(addButton(view.container));
    // Sent while the brief loaded: the composer is empty again.
    await view.setMessage('');
    await act(async () => finish({ ok: true, brief: 'Late brief' }));
    await settle();
    assert.deepEqual(view.added, []);
    assert.match(
      view.container.querySelector('[role="alert"]')?.textContent ?? '',
      /message changed while the template loaded/,
    );
  });

  it('holds the choice while its brief loads', async () => {
    let finish = (_: TemplateBriefResult) => {};
    const view = await mount({
      active: true,
      loader: () =>
        new Promise<TemplateBriefResult>((resolve) => {
          finish = resolve;
        }),
    });
    click(view.cards()[0]);
    click(addButton(view.container));
    assert.ok(view.cards().every((card) => card.hasAttribute('disabled')));
    await act(async () => finish({ ok: true, brief: 'Brief A' }));
    await settle();
    assert.deepEqual(view.added, ['Brief A']);
    assert.ok(view.cards().every((card) => !card.hasAttribute('disabled')));
  });

  it('adds nothing the filters hide', async () => {
    const view = await mount({ active: true });
    click(view.cards()[0]);
    assert.equal(addButton(view.container)?.hasAttribute('disabled'), false);
    type(view.container.querySelector('input[type="search"]'), 'zzzzqqq');
    assert.equal(addButton(view.container)?.hasAttribute('disabled'), true);
    type(view.container.querySelector('input[type="search"]'), '');
    assert.equal(addButton(view.container)?.hasAttribute('disabled'), false);
  });

  it('says so when a brief cannot be loaded', async () => {
    const view = await mount({
      active: true,
      loader: async () => ({ ok: false, message: 'Unknown template.' }),
    });
    click(view.cards()[0]);
    click(addButton(view.container));
    await settle();
    assert.deepEqual(view.added, []);
    assert.equal(
      view.container.querySelector('[role="alert"]')?.textContent,
      'Unknown template.',
    );
  });
});

describe('the template briefs the build writes', () => {
  it('writes one file per template and per style, each its brief', () => {
    const dir = mkdtempSync(join(tmpdir(), 'templates-'));
    try {
      const count = writeTemplateAssets(dir);
      const files = readdirSync(join(dir, '_templates', 'briefs'));
      assert.equal(files.length, count);
      for (const template of listed) {
        assert.ok(files.includes(`${template.id}.json`), template.id);
      }
      const written = JSON.parse(
        readFileSync(
          join(dir, '_templates', 'briefs', `${first.id}.json`),
          'utf8',
        ),
      );
      assert.deepEqual(written, { brief: designBrief(first.id) });
      for (const style of styles) {
        assert.ok(files.includes(`${style.id}.json`), style.id);
      }
      assert.equal(
        files.length,
        listed.length +
          styles.length +
          DESIGN_TEMPLATE_INDEX.filter((t) => t.mergedInto).length,
      );
      const style = JSON.parse(
        readFileSync(
          join(dir, '_templates', 'briefs', `${styles[0]!.id}.json`),
          'utf8',
        ),
      );
      assert.match(
        style.brief,
        new RegExp(`\\n## ${styles[0]!.name}\\n\\n### Goal`),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('/api/templates/brief', () => {
  const granted = async () =>
    ({ denied: null, principal: {} }) as unknown as PrincipalGranted;
  const assets = (files: Record<string, string>) => ({
    async fetch(request: Request) {
      const body = files[new URL(request.url).pathname];
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
  const env = {
    ASSETS: assets({ '/_templates/briefs/a.json': '{"brief":"Make it"}' }),
  };
  const get = (id: string) =>
    new Request(`https://vibld.test/api/templates/brief?id=${id}`);

  it('answers the brief the build wrote, privately', async () => {
    const response = await handleTemplateBrief(get('a'), env, granted);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('cache-control'),
      'private, max-age=3600',
    );
    assert.equal(response.headers.get('vary'), 'Authorization');
    assert.deepEqual(await response.json(), { brief: 'Make it' });
  });

  it('is a 404 for a template with no file, or an id that is not one', async () => {
    for (const id of ['b', '..%2Fx', 'A']) {
      const response = await handleTemplateBrief(get(id), env, granted);
      assert.equal(response.status, 404, id);
    }
    const none = await handleTemplateBrief(get('a'), {}, granted);
    assert.equal(none.status, 404);
  });

  it('turns away a caller the principal check refuses, and takes GET only', async () => {
    const denied = await handleTemplateBrief(get('a'), env, async () => ({
      denied: new Response('no', { status: 401 }),
    }));
    assert.equal(denied.status, 401);
    const post = await handleTemplateBrief(
      new Request(get('a'), { method: 'POST' }),
      env,
      granted,
    );
    assert.equal(post.status, 405);
  });

  it('is behind the invite gate', () => {
    assert.ok(GATED_PATHS.includes('/api/templates/brief'));
  });
});

describe('loadTemplateBrief', () => {
  const getToken = async () => 'token';

  it('asks for one template with the bearer token', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const result = await loadTemplateBrief('a b', {
      getToken,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({
          url,
          auth: new Headers(init.headers).get('Authorization'),
        });
        return new Response('{"brief":"Make it"}');
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(result, { ok: true, brief: 'Make it' });
    assert.deepEqual(seen, [
      { url: '/api/templates/brief?id=a%20b', auth: 'Bearer token' },
    ]);
  });

  it("passes on the Worker's refusal, and fails without a brief", async () => {
    const refused = await loadTemplateBrief('a', {
      getToken,
      fetchImpl: (async () =>
        new Response('{"error":"Unknown template."}', {
          status: 404,
        })) as unknown as typeof fetch,
    });
    assert.deepEqual(refused, { ok: false, message: 'Unknown template.' });
    const empty = await loadTemplateBrief('a', {
      getToken,
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    assert.equal(empty.ok, false);
    const offline = await loadTemplateBrief('a', {
      getToken,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    assert.equal(offline.ok, false);
    const noToken = await loadTemplateBrief('a', {
      getToken: async () => {
        throw new Error('refresh failed');
      },
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    assert.equal(noToken.ok, false);
  });
});
