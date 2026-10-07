import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { BuilderState } from '../src/generation/session.ts';
import type { PlanMode } from '../src/generation/plan-builder.ts';
import { PromptPanel } from '../src/components/PromptPanel.tsx';
import { DEFAULT_LIMITS } from '../worker/request-guard.ts';

/**
 * The composer, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on internal PR 124 this component was typechecked and nothing more.
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
    // A deployment with a real model, which is the ordinary case. The
    // composer only offers directions where there is a model to ask
    // (internal PR 189 review), so leaving this absent hid the button from every
    // test that expected it.
    generation: 'model',
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
    // Offered only against the deterministic provider: against a real
    // model it would spend a run on a checkpoint designed to be rejected.
    const view = await mount(builder({ generation: 'fake' }));
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

  it('empties the message but keeps the reference, which the project remembers', async () => {
    // D93 (Chris, 2026-09-30): every build reads the reference page until
    // it is cleared, so sending a message does not clear it.
    const view = await mount(builder());
    await view.type('A landing page');
    await view.reference_('https://example.com');
    await view.send();

    assert.equal(view.prompt().value, '');
    assert.equal(view.reference().value, 'https://example.com');
    view.unmount();
  });

  it('empties the composer for a run this form did not start', async () => {
    // Choosing a direction submits through the session, not through this
    // form, so its cleanup never ran (internal PR 189 review). The composer then asked
    // "What should change?" over the original build request, and submitting
    // that repeated the build.
    const view = await mount(builder());
    await view.type('A landing page');
    await view.reference_('https://example.com');

    // No submit here: a run simply appears, the way it does when the
    // chooser starts one.
    await view.render(builder({ runId: 'run-1', running: true }));

    assert.equal(view.prompt().value, '');
    // The reference stays: the project remembers it (D93).
    assert.equal(view.reference().value, 'https://example.com');
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
    const example = view.button(/Cybersecurity SaaS landing page/);
    assert.ok(example, 'no example offered');
    await view.press(/Cybersecurity SaaS landing page/);
    assert.match(view.prompt().value, /cybersecurity SaaS/);
    view.unmount();

    const started = await mount(builder({ transcript: TURN }));
    assert.equal(started.button(/Cybersecurity/), undefined);
    started.unmount();
  });

  it('asks a different question once something has been built', async () => {
    const fresh = await mount(builder());
    assert.match(fresh.text(), /Describe your application/);
    assert.ok(fresh.button(/Generate/));
    fresh.unmount();

    const started = await mount(builder({ transcript: TURN }));
    assert.match(started.text(), /Message vibld/);
    assert.ok(started.button(/Send/));
    started.unmount();
  });

  it('offers Start over only once there is something to start over from', async () => {
    const fresh = await mount(builder());
    assert.equal(fresh.button(/Start over/), undefined);
    fresh.unmount();

    const started = await mount(builder({ transcript: TURN }));
    await started.press(/Start over/);
    assert.equal(started.resets.length, 1);
    started.unmount();
  });
});

/**
 * Asking to look before building (internal issue 185).
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
    // The reference page especially (internal PR 189 review): it was dropped on the
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

  it('refuses to spend on a look with a malformed reference', async () => {
    // The button is a `button`, so it skips the native validation the
    // submit path gets for free (internal PR 189 review). Without this the look is
    // paid for, the bad value is kept in the mockup context, and the build
    // that choosing a direction submits is refused on a field the reader
    // could have been told about before spending.
    const view = await mount(builder());
    await view.type('a bakery');
    await view.reference_('not a url');
    await act(async () => view.button(/Show me three directions/)?.click());

    assert.deepEqual(view.explored, [], 'a malformed reference started a run');
    view.unmount();
  });

  it('bounds the reference field at what the guard will accept', async () => {
    // The other half of the same finding (internal PR 189 review), which
    // `reportValidity` does not cover: a 3,000-character address is a
    // perfectly valid `type="url"` value, so the browser's own check passes
    // it, the look is paid for, and the guard refuses it on the build that
    // choosing a direction submits. Declared in the markup, the value
    // cannot be typed or pasted in at all -- on this button and on
    // `Generate` alike, which is the sibling the button-only fix missed.
    const view = await mount(builder());
    assert.equal(
      view.reference().maxLength,
      DEFAULT_LIMITS.maxReferenceUrlChars,
      'the field does not carry the bound the request guard enforces',
    );
    view.unmount();
  });

  it('asks once the reference is valid again', async () => {
    // The refusal must not be a dead end: correcting the field is enough.
    const view = await mount(builder());
    await view.type('a bakery');
    await view.reference_('not a url');
    await act(async () => view.button(/Show me three directions/)?.click());
    await view.reference_('https://example.com/');
    await act(async () => view.button(/Show me three directions/)?.click());

    assert.equal(view.explored.length, 1);
    assert.equal(view.explored[0]?.referenceUrl, 'https://example.com/');
    view.unmount();
  });

  it('does not offer it where there is no model to ask', async () => {
    // `explore` always calls the real `/api/mockups`, while a build in
    // `fake` mode is served by `FakeModelProvider` (internal PR 189 review). Offering
    // the action there offered something that could only fail, in exactly
    // the modes the fake exists to keep usable.
    //
    // Hidden rather than faked: three invented pages would be the promise
    // the generator has not made that rendered-not-drawn exists to avoid.
    const view = await mount(builder({ generation: 'fake' }));
    assert.equal(view.button(/Show me three directions/), undefined);
    view.unmount();
  });

  it('does not offer it before the probe has answered', async () => {
    // Null is "nobody has said yet", and a paid action must not be offered
    // on a guess. It appears when the answer arrives.
    const view = await mount(builder({ generation: null }));
    assert.equal(view.button(/Show me three directions/), undefined);
    await view.render(builder({ generation: 'model' }));
    assert.ok(view.button(/Show me three directions/));
    view.unmount();
  });

  it('keeps offering it after a first attempt that built nothing', async () => {
    // A failed or cancelled build still appends a transcript turn (internal PR 189
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
    // A look is about a minute and is billed for (internal PR 189 review). Without
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

/**
 * The composer's options row (D6, 2026-09-28): each option a button that
 * opens its panel in place, one at a time, and says on its face when it is
 * set, so nothing shapes a build out of sight.
 */
describe('the options row', () => {
  const panel = (view: Awaited<ReturnType<typeof mount>>, label: string) =>
    view.container.querySelector<HTMLElement>(
      `.option-panel[aria-label="${label}"]`,
    );

  it('keeps every panel closed until it is asked for', async () => {
    const view = await mount(builder());
    for (const element of view.container.querySelectorAll('.option-panel')) {
      assert.equal((element as HTMLElement).hidden, true);
    }
    view.unmount();
  });

  it('opens one panel at a time, and closes it again', async () => {
    const view = await mount(builder());
    await view.press(/^Style/);
    assert.equal(panel(view, 'Style')?.hidden, false);
    await view.press(/^Reference/);
    assert.equal(panel(view, 'Style')?.hidden, true);
    assert.equal(panel(view, 'Reference')?.hidden, false);
    await view.press(/^Reference/);
    assert.equal(panel(view, 'Reference')?.hidden, true);
    view.unmount();
  });

  it('says what each option changes about the result', async () => {
    const view = await mount(builder());
    for (const element of view.container.querySelectorAll('.option-panel')) {
      const about = element.querySelector('.option-panel__about');
      assert.ok(
        (about?.textContent ?? '').length > 20,
        `${element.getAttribute('aria-label')} has no explanation`,
      );
    }
    view.unmount();
  });

  it('shows a set option on its button', async () => {
    const view = await mount(builder());
    await view.reference_('https://example.com/about');
    const button = view.button(/^Reference/);
    assert.match(button?.textContent ?? '', /example\.com/);
    view.unmount();
  });

  it('opens the reference panel when the browser refuses its value', async () => {
    const view = await mount(builder());
    await act(async () => {
      view.reference().dispatchEvent(new Event('invalid'));
    });
    assert.equal(panel(view, 'Reference')?.hidden, false);
    view.unmount();
  });

  it('offers standing preferences only where they can be kept', async () => {
    const view = await mount(builder());
    assert.equal(view.button(/^Preferences/), undefined);
    view.unmount();
  });

  it('does not offer a forced failure against a real model', async () => {
    const view = await mount(builder());
    assert.equal(view.failNext(), null);
    view.unmount();
  });
});

describe('sending from the keyboard', () => {
  async function key(
    view: Awaited<ReturnType<typeof mount>>,
    init: KeyboardEventInit,
  ) {
    await act(async () => {
      view.prompt().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  }

  it('sends on Enter', async () => {
    const view = await mount(builder());
    await view.type('A landing page');
    await key(view, {});
    assert.equal(view.sent[0]?.prompt, 'A landing page');
    view.unmount();
  });

  it('keeps Shift+Enter for a new line', async () => {
    const view = await mount(builder());
    await view.type('A landing page');
    await key(view, { shiftKey: true });
    assert.deepEqual(view.sent, []);
    view.unmount();
  });
});

describe('what a build is expected to cost (Chris, 2026-10-05)', () => {
  const models = [
    {
      id: 'luna',
      label: 'Luna',
      note: '',
      provider: 'openai',
      buildEstimate: {
        microUsd: 120_000,
        basis: 'history' as const,
        draftMicroUsd: 10_000,
      },
    },
    {
      id: 'sol',
      label: 'Sol',
      note: '',
      provider: 'openai',
      buildEstimate: {
        microUsd: 2_000_000,
        basis: 'ceiling' as const,
        draftMicroUsd: 50_000,
      },
    },
  ];

  it("says the chosen model's figure beside Send, with the first build's draft", async () => {
    const view = await mount(builder({ models, model: 'sol' }));
    assert.match(view.text(), /Up to \$2\.05 a build/);
    await view.render(builder({ models, model: 'luna' }));
    assert.match(view.text(), /About \$0\.13 a build/);
    view.unmount();
  });

  it('leaves the draft out once the project exists', async () => {
    const view = await mount(
      builder({
        models,
        model: 'luna',
        acceptedSnapshot: {} as BuilderState['acceptedSnapshot'],
        transcript: TURN,
      }),
    );
    assert.match(view.text(), /About \$0\.12 a build/);
    view.unmount();
  });

  it('says nothing without an estimate, or where no model answers', async () => {
    const bare = models.map(({ buildEstimate: _, ...model }) => model);
    const view = await mount(builder({ models: bare, model: 'luna' }));
    assert.doesNotMatch(view.text(), /a build/);
    await view.render(builder({ models, model: 'luna', generation: 'fake' }));
    assert.doesNotMatch(view.text(), /a build/);
    view.unmount();
  });
});
