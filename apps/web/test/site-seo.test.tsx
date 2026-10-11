import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SiteSeo } from '../src/components/SiteSeo.tsx';

/**
 * The owner's SEO fields in the Ship menu (D194, D202): what is saved is
 * what was typed, cleared fields go as null, and the answer is what the
 * form shows afterwards.
 */

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mount(seo?: Parameters<typeof SiteSeo>[0]['seo']) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<SiteSeo projectId="p1" seo={seo} />);
  });
  const save = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save',
    )!;
  return {
    container,
    save,
    async type(index: number, value: string) {
      const input = container.querySelectorAll('input')[index]!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async toggle() {
      const box = container.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      )!;
      await act(async () => box.click());
    },
  };
}

describe('SiteSeo', () => {
  it('saves what was typed and shows what was saved', async () => {
    const sent: unknown[] = [];
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      return reply({
        project: {
          id: 'p1',
          name: 'Acme',
          archived: false,
          archivedAt: null,
          createdAt: '2026-10-01T00:00:00.000Z',
          editedAt: '2026-10-01T00:00:00.000Z',
          lastOpenedAt: '2026-10-01T00:00:00.000Z',
          hasCode: true,
          turns: 0,
          settings: {
            style: null,
            referenceUrl: null,
            model: null,
            knowledge: null,
            styleDna: null,
          },
          seo: { ...body.seo, image: '/og.png' },
        },
      });
    }) as typeof fetch;
    const view = await mount({
      title: null,
      description: null,
      image: '/old.png',
      indexing: true,
    });
    assert.equal(view.save().disabled, true, 'nothing changed yet');
    await view.type(0, '  Acme Bakery ');
    await view.type(1, '');
    await view.toggle();
    assert.equal(view.save().disabled, false);
    await act(async () => view.save().click());
    assert.deepEqual(sent, [
      {
        // Only what changed: the description was not touched.
        seo: {
          title: 'Acme Bakery',
          image: null,
          indexing: false,
        },
      },
    ]);
    assert.match(view.container.textContent ?? '', /Saved\./);
    assert.equal(
      view.container.querySelectorAll('input')[1]!.value,
      '/og.png',
      'the form shows the answer',
    );
  });

  it('holds the fields while a save is in flight', async () => {
    let answer!: (response: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      })) as typeof fetch;
    const view = await mount();
    await view.type(0, 'Acme');
    await act(async () => view.save().click());
    const fields = view.container.querySelector('fieldset')!;
    assert.equal(fields.disabled, true);
    await act(async () => answer(new Response('{}', { status: 500 })));
    assert.equal(fields.disabled, false);
  });

  it("says why a save was refused, in the Worker's words", async () => {
    globalThis.fetch = (async () =>
      reply(
        { error: '"seo.image" must be an https:// address.' },
        400,
      )) as typeof fetch;
    const view = await mount();
    await view.type(1, 'http://x.test/a.png');
    await act(async () => view.save().click());
    assert.match(
      view.container.querySelector('[role="alert"]')?.textContent ?? '',
      /must be an https:\/\/ address/,
    );
  });
});
