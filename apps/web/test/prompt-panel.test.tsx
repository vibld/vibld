import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { BuilderState } from '../src/generation/session.ts';
import type { PlanMode } from '../src/generation/plan-builder.ts';
import { PromptPanel } from '../src/components/PromptPanel.tsx';

/**
 * The composer, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 */

interface Sent {
  prompt: string;
  mode: PlanMode;
  style: StylePresetId | null;
  referenceUrl: string | null;
}

function builder(overrides: Partial<BuilderState> = {}): BuilderState {
  return {
    running: false,
    transcript: [],
    models: [],
    model: null,
    ...overrides,
  } as BuilderState;
}

/** One turn is all `started` reads, so its shape past that does not matter. */
const TURN = [
  { runId: 'run-1', prompt: 'hello' },
] as BuilderState['transcript'];

async function mount(state: BuilderState) {
  const sent: Sent[] = [];
  const resets: number[] = [];
  const cancels: number[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <PromptPanel
        state={state}
        onSubmit={(prompt, mode, style, referenceUrl) => {
          sent.push({ prompt, mode, style, referenceUrl });
        }}
        onReset={() => resets.push(1)}
        onCancel={() => cancels.push(1)}
        onModelChange={() => {}}
      />,
    );
  });
  const button = (label: RegExp): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((element) =>
      label.test(element.textContent ?? ''),
    );
  async function set(element: HTMLElement, value: string) {
    const prototype =
      element instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    await act(async () => {
      // What React listens for: setting `.value` alone does not notify it.
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const prompt = () =>
    container.querySelector('textarea') as HTMLTextAreaElement;
  const reference = () =>
    container.querySelector('input[type="url"]') as HTMLInputElement;
  const failNext = () =>
    container.querySelector('input[type="checkbox"]') as HTMLInputElement;
  return {
    container,
    sent,
    resets,
    cancels,
    async render(next: BuilderState) {
      await act(async () => {
        root.render(
          <PromptPanel
            state={next}
            onSubmit={(prompt, mode, style, referenceUrl) => {
              sent.push({ prompt, mode, style, referenceUrl });
            }}
            onReset={() => resets.push(1)}
            onCancel={() => cancels.push(1)}
            onModelChange={() => {}}
          />,
        );
      });
    },
    button,
    prompt,
    reference,
    failNext,
    text: () => container.textContent ?? '',
    type: (value: string) => set(prompt(), value),
    reference_: (value: string) => set(reference(), value),
    async tickFailNext() {
      await act(async () => {
        failNext().click();
      });
    },
    async send() {
      const form = container.querySelector('form');
      assert.ok(form, 'no form');
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      });
    },
    async press(label: RegExp) {
      const found = button(label);
      assert.ok(found, `no ${String(label)} button`);
      await act(async () => {
        found.click();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the composer, as it is actually wired', () => {
  it('sends what was typed, with the mode and the reference it was typed with', async () => {
    const view = await mount(builder());
    await view.type('A landing page');
    await view.reference_('https://example.com');
    await view.send();

    assert.deepEqual(view.sent, [
      {
        prompt: 'A landing page',
        mode: 'succeed',
        style: null,
        referenceUrl: 'https://example.com',
      },
    ]);
    view.unmount();
  });

  it('forgets a forced failure once it has been used', async () => {
    // Per-request, not a setting. Left ticked it quietly spends every later
    // run on a checkpoint designed to be rejected, and the box is far enough
    // up the form to be out of sight by the time the failure arrives.
    const view = await mount(builder());
    await view.type('A landing page');
    await view.tickFailNext();
    await view.send();
    assert.equal(view.sent[0]?.mode, 'fail-validation');

    await view.type('Something else');
    await view.send();

    assert.equal(
      view.sent[1]?.mode,
      'succeed',
      'it failed a run nobody asked to fail',
    );
    assert.equal(view.failNext().checked, false);
    view.unmount();
  });

  it('empties the composer and the reference, so the next turn starts clean', async () => {
    const view = await mount(builder());
    await view.type('A landing page');
    await view.reference_('https://example.com');
    await view.send();

    assert.equal(view.prompt().value, '');
    assert.equal(view.reference().value, '');
    view.unmount();
  });

  it('sends nothing for a prompt that is only whitespace', async () => {
    const view = await mount(builder());
    await view.type('   ');
    await view.send();

    assert.deepEqual(view.sent, []);
    assert.equal(view.button(/Generate/)?.disabled, true);
    view.unmount();
  });

  it('sends nothing while a run is already going', async () => {
    // With a prompt in the box, so this reaches the rule about running
    // rather than stopping at the one about an empty prompt.
    const view = await mount(builder());
    await view.type('A landing page');
    await view.render(builder({ running: true }));
    await view.send();

    assert.deepEqual(view.sent, []);
    assert.match(view.text(), /Generating/);
    view.unmount();
  });

  it('offers a way out of a run that is going, and only then', async () => {
    // A generation can run for a minute or more, and it spends either way.
    const idle = await mount(builder());
    assert.equal(idle.button(/Cancel/), undefined);
    idle.unmount();

    const running = await mount(builder({ running: true }));
    await running.press(/Cancel/);
    assert.equal(running.cancels.length, 1);
    running.unmount();
  });

  it('offers examples until there is a conversation, and fills the box with one', async () => {
    const view = await mount(builder());
    const example = view.button(/landing page for a cybersecurity/);
    assert.ok(example, 'no example offered');
    await view.press(/landing page for a cybersecurity/);
    assert.match(view.prompt().value, /cybersecurity SaaS/);
    view.unmount();

    const started = await mount(builder({ transcript: TURN }));
    assert.equal(started.button(/cybersecurity/), undefined);
    started.unmount();
  });

  it('asks a different question once something has been built', async () => {
    const fresh = await mount(builder());
    assert.match(fresh.text(), /Describe your application/);
    assert.ok(fresh.button(/Generate/));
    fresh.unmount();

    const started = await mount(builder({ transcript: TURN }));
    assert.match(started.text(), /What should change\?/);
    assert.ok(started.button(/Send/));
    started.unmount();
  });

  it('offers Start over only once there is something to start over from', async () => {
    const fresh = await mount(builder());
    assert.equal(fresh.button(/Start over/)?.disabled, true);
    fresh.unmount();

    const started = await mount(builder({ transcript: TURN }));
    await started.press(/Start over/);
    assert.equal(started.resets.length, 1);
    started.unmount();
  });
});
