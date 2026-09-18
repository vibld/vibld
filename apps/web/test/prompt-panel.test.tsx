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
    // Explicitly null, not absent: the composer asks whether a project
    // exists, and `undefined` is not an answer to that question.
    acceptedSnapshot: null,
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
  const explored: {
    prompt: string;
    style: string | null;
    referenceUrl: string | null;
  }[] = [];
  const exploreCancels: number[] = [];
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
        onExplore={(prompt, style, referenceUrl) =>
          explored.push({ prompt, style, referenceUrl })
        }
        onReset={() => resets.push(1)}
        onCancel={() => cancels.push(1)}
        onCancelExplore={() => exploreCancels.push(1)}
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
    explored,
    exploreCancels,
    async render(next: BuilderState) {
      await act(async () => {
        root.render(
          <PromptPanel
            state={next}
            onSubmit={(prompt, mode, style, referenceUrl) => {
              sent.push({ prompt, mode, style, referenceUrl });
            }}
            onExplore={(prompt, style, referenceUrl) =>
              explored.push({ prompt, style, referenceUrl })
            }
            onReset={() => resets.push(1)}
            onCancel={() => cancels.push(1)}
            onCancelExplore={() => exploreCancels.push(1)}
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

  it('empties the composer for a run this form did not start', async () => {
    // Choosing a direction submits through the session, not through this
    // form, so its cleanup never ran (#189 review). The composer then asked
    // "What should change?" over the original build request and its
    // reference page, and submitting that repeated the build and refetched
    // the reference.
    const view = await mount(builder());
    await view.type('A landing page');
    await view.reference_('https://example.com');

    // No submit here: a run simply appears, the way it does when the
    // chooser starts one.
    await view.render(builder({ runId: 'run-1', running: true }));

    assert.equal(view.prompt().value, '');
    assert.equal(view.reference().value, '');
    view.unmount();
  });

  it('does not empty it again for the same run', async () => {
    // Otherwise a re-render during a run would wipe what somebody had
    // started typing for the turn after it.
    const view = await mount(builder({ runId: 'run-1', running: true }));
    await view.type('the next thing');
    await view.render(builder({ runId: 'run-1', running: false }));

    assert.equal(view.prompt().value, 'the next thing');
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

/**
 * Asking to look before building (#185).
 *
 * Offered only before there is a project: directions are for deciding what
 * to build, and once something exists the question is what to change about
 * it, which three fresh sketches do not answer.
 */
describe('asking for directions', () => {
  it('offers it on a first request', async () => {
    const view = await mount(builder());
    assert.ok(view.button(/Show me three directions/));
    view.unmount();
  });

  it('carries the prompt, style and reference the build would have used', async () => {
    // The reference page especially (#189 review): it was dropped on the
    // way to a mockup run while still sitting in the composer, looking for
    // all the world as though it had been used.
    const view = await mount(builder());
    await view.type('a bakery');
    await view.reference_('https://example.com/');
    await act(async () => view.button(/Show me three directions/)?.click());
    assert.deepEqual(view.explored, [
      { prompt: 'a bakery', style: null, referenceUrl: 'https://example.com/' },
    ]);
    view.unmount();
  });

  it('will not ask with nothing typed', async () => {
    const view = await mount(builder());
    assert.equal(view.button(/Show me three directions/)?.disabled, true);
    view.unmount();
  });

  it('stops offering it once there is a project to change', async () => {
    const view = await mount(
      builder({
        transcript: TURN,
        acceptedSnapshot: { revision: 'r1', files: [] },
      } as Partial<BuilderState>),
    );
    assert.equal(view.button(/Show me three directions/), undefined);
    view.unmount();
  });

  it('keeps offering it after a first attempt that built nothing', async () => {
    // A failed or cancelled build still appends a transcript turn (#189
    // review), so gating on "has anything been attempted" hid the feature
    // at exactly the moment it is for: no project, and a reader deciding
    // what to try next.
    const view = await mount(builder({ transcript: TURN }));
    assert.ok(
      view.button(/Show me three directions/),
      'a failed first build hid the way to ask for directions',
    );
    view.unmount();
  });

  it('offers a way to stop a look that is running', async () => {
    // A look is about a minute and is billed for (#189 review). Without
    // this the only way out was to leave the page, and it kept spending
    // either way.
    const view = await mount(builder({ exploring: true }));
    const cancel = view.button(/^Cancel$/);
    assert.ok(cancel, 'a running look offers no way to stop it');
    await act(async () => cancel.click());
    assert.deepEqual(view.exploreCancels, [1]);
    assert.deepEqual(view.cancels, [], 'stopping a look cancelled a build');
    view.unmount();
  });

  it('says it is working, and refuses a second ask while it is', async () => {
    const view = await mount(builder());
    await view.type('a bakery');
    await view.render(builder({ exploring: true }));
    const working = view.button(/Sketching/);
    assert.ok(working, 'the control does not say it is working');
    assert.equal(working.disabled, true);
    view.unmount();
  });
});
