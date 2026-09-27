import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { MODEL_CATALOGUE } from '@vibld/ai';
import { ModelPicker } from '../src/components/ModelPicker.tsx';
import type { ModelOption } from '../src/generation/remote-provider.ts';

/**
 * The picker groups every offered version into families and opens each on
 * its newest version, so choosing "Claude Opus" means Opus 5.5 unless
 * someone asks for another.
 */

const MODELS: ModelOption[] = MODEL_CATALOGUE.map(
  ({ id, label, note, provider }) => ({ id, label, note, provider }),
);

function mount(value: string | null, models = MODELS) {
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
      />,
    );
  });
  const selects = [...container.querySelectorAll('select')];
  return {
    container,
    chosen,
    family: selects[0]!,
    version: selects[1] as HTMLSelectElement | undefined,
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
  it('offers each family once, not each version', () => {
    const view = mount('claude-opus-5-5');
    const labels = [...view.family.options].map((option) => option.text);
    assert.equal(labels.filter((label) => label === 'Claude Opus').length, 1);
    assert.ok(!labels.includes('Claude Opus 4.8'));
    view.unmount();
  });

  it('lands on Opus 5.5 when someone chooses Opus', () => {
    const view = mount('deepseek-flash');
    choose(view.family, 'claude-opus');
    assert.deepEqual(view.chosen, ['claude-opus-5-5']);
    view.unmount();
  });

  it('still lets someone choose an older version by name', () => {
    const view = mount('claude-opus-5-5');
    assert.ok(view.version, 'no version control for a family of several');
    const versions = [...view.version.options].map((option) => option.value);
    assert.deepEqual(versions, [
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
    ]);
    choose(view.version, 'claude-opus-4-8');
    assert.deepEqual(view.chosen, ['claude-opus-4-8']);
    view.unmount();
  });

  it('shows an older version as selected when that is what was chosen', () => {
    const view = mount('claude-opus-4-8');
    assert.equal(view.family.value, 'claude-opus');
    assert.equal(view.version?.value, 'claude-opus-4-8');
    view.unmount();
  });

  it('asks for no version where a family has only one', () => {
    const view = mount('deepseek-flash');
    assert.equal(view.version, undefined);
    view.unmount();
  });

  it('opens on the newest version granted, not the newest that exists', () => {
    const granted = MODELS.filter((model) => model.id !== 'claude-opus-5-5');
    const view = mount('deepseek-flash', granted);
    choose(view.family, 'claude-opus');
    assert.deepEqual(view.chosen, ['claude-opus-5']);
    view.unmount();
  });
});
