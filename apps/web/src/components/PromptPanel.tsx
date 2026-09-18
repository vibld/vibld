import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { BuilderState } from '../generation/session.ts';
import type { PlanMode } from '../generation/plan-builder.ts';
import { ModelPicker } from './ModelPicker.tsx';
import { StylePicker } from './StylePicker.tsx';

const EXAMPLES = [
  'A landing page for a cybersecurity SaaS with pricing, FAQ and a contact form',
  'A marketing site for an indie coffee roaster with features and testimonials',
];

export interface PromptPanelProps {
  state: BuilderState;
  onSubmit: (
    prompt: string,
    mode: PlanMode,
    style: StylePresetId | null,
    referenceUrl: string | null,
  ) => void;
  /**
   * Ask for three directions instead of building (#185). Carries the same
   * prompt and style the build would have used, because it is the same
   * request asked a smaller way.
   */
  onExplore: (
    prompt: string,
    style: StylePresetId | null,
    referenceUrl: string | null,
  ) => void;
  onReset: () => void;
  onCancel: () => void;
  /**
   * Stop a look that is running (#189 review). Its own handler, because it
   * stops a different run from `onCancel` and leaves the build untouched.
   */
  onCancelExplore: () => void;
  onModelChange: (model: string | null) => void;
}

export function PromptPanel({
  state,
  onSubmit,
  onExplore,
  onReset,
  onCancel,
  onCancelExplore,
  onModelChange,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [style, setStyle] = useState<StylePresetId | null>(null);
  const [referenceUrl, setReferenceUrl] = useState('');
  const promptId = useId();
  const failId = useId();
  const referenceId = useId();
  const disabled = state.running || state.exploring;
  // Once there is a conversation, the examples are noise: what to type next
  // comes from what was just built, not from a generic starting point.
  const started = state.transcript.length > 0;

  /**
   * Everything that belonged to the request that just started.
   *
   * One function because the rule is one rule, and it was written for one
   * path (#189 review). Choosing a direction submits through the session
   * rather than through this form, so the composer still held the original
   * request and its reference page while the label above it asked "What
   * should change?" -- and submitting that repeated the build and refetched
   * the reference.
   *
   * - The prompt, because this is a composer, not a field that holds the
   *   last thing submitted: leaving the sent message in it means the next
   *   turn starts by editing the previous one.
   * - The reference URL, which is scoped to the request it went with rather
   *   than being a standing preference the way `knowledge` is, so a later
   *   unrelated turn never refetches a page nobody meant it for.
   * - "Force a validation failure", which costs the most: left ticked it
   *   quietly spends every later run on a checkpoint designed to be
   *   rejected, and the box is far enough up the form to be out of sight by
   *   the time the failure arrives.
   */
  function clearPerRequestFields() {
    setPrompt('');
    setReferenceUrl('');
    setFailNext(false);
  }

  // Fires for a run this form did not start, which is the case that was
  // missing: `chooseMockup` goes straight to the session. Keyed on the run
  // id rather than on `running`, so a run that finishes before this renders
  // still clears, and so a re-render during a run does not wipe what
  // somebody has begun typing for the turn after it.
  //
  // That last part is the dependency array's job and nothing else's. The
  // first version also kept a ref of the last id it had cleared for, and a
  // mutation showed the ref was unobservable: React re-runs this only when
  // the id changes, run ids are monotonic, so there is no second path for
  // the same id to arrive by. A guard no test can distinguish is a guard
  // that is not carrying its weight, so it is gone.
  useEffect(() => {
    if (state.runId === null) return;
    clearPerRequestFields();
    // `clearPerRequestFields` only calls setters, which React guarantees are
    // stable; listing it would mean re-running on every render rather than
    // on every run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.runId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || prompt.trim().length === 0) return;
    const trimmedReference = referenceUrl.trim();
    onSubmit(
      prompt,
      failNext ? 'fail-validation' : 'succeed',
      style,
      trimmedReference.length > 0 ? trimmedReference : null,
    );
    // Here as well as in the effect above, deliberately: the effect cannot
    // run until the session has reported a new run, and a composer that
    // still showed the sent message for that round trip would read as a
    // click that did nothing.
    clearPerRequestFields();
  }

  return (
    <form className="prompt" onSubmit={handleSubmit}>
      <label className="prompt__label" htmlFor={promptId}>
        {started ? 'What should change?' : 'Describe your application'}
      </label>
      <textarea
        id={promptId}
        className="prompt__input"
        value={prompt}
        rows={started ? 2 : 4}
        placeholder={started ? 'Make the hero navy…' : 'A landing page for…'}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={disabled}
      />

      {started ? null : (
        <div className="prompt__examples">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              onClick={() => setPrompt(example)}
              disabled={disabled}
            >
              {example.slice(0, 38)}…
            </button>
          ))}
        </div>
      )}

      <label className="prompt__label" htmlFor={referenceId}>
        Reference URL (optional)
      </label>
      <input
        id={referenceId}
        type="url"
        className="prompt__input"
        value={referenceUrl}
        placeholder="https://example.com -- a page to copy from or emulate"
        onChange={(event) => setReferenceUrl(event.target.value)}
        disabled={disabled}
      />

      <ModelPicker
        models={state.models}
        value={state.model}
        onChange={onModelChange}
        disabled={disabled}
      />

      <StylePicker value={style} onChange={setStyle} disabled={disabled} />

      <div className="prompt__row">
        <input
          id={failId}
          type="checkbox"
          checked={failNext}
          onChange={(event) => setFailNext(event.target.checked)}
          disabled={disabled}
        />
        <label htmlFor={failId} className="prompt__checkbox-label">
          Force a validation failure (staged file escapes the project root)
        </label>
      </div>

      <div className="prompt__actions">
        <button
          type="submit"
          className="button button--primary"
          disabled={disabled || prompt.trim().length === 0}
        >
          {state.running ? 'Generating…' : started ? 'Send' : 'Generate'}
        </button>
        {/*
          Offered until a project exists (#185), which is not the same as
          until an attempt was made (#189 review), and only where there is
          a model to ask. `explore` always calls the real `/api/mockups`,
          while a build in `fake` mode is served by `FakeModelProvider`, so
          this was offering something that could only fail in exactly the
          modes the fake exists to keep usable. Hidden rather than faked:
          three invented pages would be the promise the generator has not
          made that rendered-not-drawn exists to avoid. A failed or cancelled
          first build still appends a transcript turn, so `started` was
          true with nothing built -- and the feature meant for exactly that
          moment had already hidden itself. `acceptedSnapshot` is the thing
          that answers "is there a project", so it is the thing to ask.
        */}
        {state.acceptedSnapshot === null && state.generation === 'model' ? (
          <button
            type="button"
            className="button"
            onClick={() =>
              onExplore(
                prompt,
                style,
                referenceUrl.trim().length > 0 ? referenceUrl.trim() : null,
              )
            }
            disabled={disabled || prompt.trim().length === 0}
            title="Three quick sketches to choose from, for about a tenth of a build"
          >
            {state.exploring ? 'Sketching…' : 'Show me three directions'}
          </button>
        ) : null}
        {/*
          A generation can run for a minute or more. Without this the only way
          out is to close the tab, and the run keeps spending either way --
          cancelling drops the connection, which is what tells the endpoint to
          stop its own model call.
        */}
        {state.running ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {/*
          A look is about a minute and is billed for (#189 review). Without
          this the only way out of one was to leave the page, and it kept
          spending either way.
        */}
        {state.exploring ? (
          <button type="button" className="button" onClick={onCancelExplore}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="button"
          onClick={onReset}
          disabled={!started && !state.running}
        >
          Start over
        </button>
      </div>
    </form>
  );
}
