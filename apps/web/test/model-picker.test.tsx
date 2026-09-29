import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { MODEL_CATALOGUE } from '@vibld/ai';
import { ModelPicker } from '../src/components/ModelPicker.tsx';
import type { ModelOption } from '../src/generation/remote-provider.ts';

/**
 * One dropdown, every offered version grouped under its family, newest
 * first, and nothing else: Chris asked for a plain dropdown without the
 * sentence of pricing that used to sit under it (2026-09-28).
 */

const MODELS: ModelOption[] = MODEL_CATALOGUE.map(
  ({ id, label, note, provider }) => ({ id, label, note, provider }),
);

function mount(
  value: string | null,
  models = MODELS,
  note: string | null = null,
) {
  const chosen: (string | null)[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <ModelPicker
        models={models}
        value={value}
        onChange={(model) => chosen.push(model)}
        disabled={false}
        note={note}
      />,
    );
  });
  const selects = [...container.querySelectorAll('select')];
  return {
    container,
    chosen,
    selects,
    select: selects[0]!,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('ModelPicker', () => {
  it('is one dropdown, with no prose beside it', () => {
    const view = mount('claude-opus-5-5');
    assert.equal(view.selects.length, 1);
    for (const model of MODELS) {
      assert.ok(
        !(view.container.textContent ?? '').includes(model.note),
        `the note for ${model.id} is on screen`,
      );
    }
    view.unmount();
  });

  it('groups a family of several under its name, newest first', () => {
    const view = mount('claude-opus-5-5');
    const group = [...view.select.querySelectorAll('optgroup')].find(
      (element) => element.label === 'Claude Opus',
    );
    assert.ok(group, 'no Claude Opus group');
    assert.deepEqual(
      [...group.querySelectorAll('option')].map((option) => option.value),
      [
        'claude-opus-5-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-opus-4-6',
      ],
    );
    view.unmount();
  });

  it('lists a family of one as a plain choice, not a group of one', () => {
    const view = mount('claude-opus-5-5');
    const flash = view.select.querySelector('option[value="deepseek-flash"]');
    assert.ok(flash, 'deepseek-flash is not offered');
    assert.equal(flash.parentElement, view.select);
    view.unmount();
  });

  it('sends the version chosen, older ones included', () => {
    const view = mount('claude-opus-5-5');
    choose(view.select, 'claude-opus-4-8');
    assert.deepEqual(view.chosen, ['claude-opus-4-8']);
    view.unmount();
  });

  it('shows what was chosen as selected', () => {
    const view = mount('claude-opus-4-8');
    assert.equal(view.select.value, 'claude-opus-4-8');
    view.unmount();
  });

  it('offers only what is granted', () => {
    const granted = MODELS.filter((model) => model.id !== 'claude-opus-5-5');
    const view = mount('deepseek-flash', granted);
    assert.equal(
      view.select.querySelector('option[value="claude-opus-5-5"]'),
      null,
    );
    view.unmount();
  });

  it('renders nothing when there is no choice to make', () => {
    const view = mount(null, MODELS.slice(0, 1));
    assert.equal(view.selects.length, 0);
    assert.equal(view.container.textContent, '');
    view.unmount();
  });

  it('says why when the plan leaves one model (D66)', () => {
    const luna = MODELS.filter((model) => model.id === 'gpt-6-luna');
    const note =
      'Free builds use GPT-6 Luna. Paid plans unlock the other models.';
    const view = mount('gpt-6-luna', luna, note);
    assert.equal(view.selects.length, 0);
    assert.equal(view.container.textContent, note);
    view.unmount();
  });
});
