import { useId, useState } from 'react';
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
  onReset: () => void;
  onCancel: () => void;
  onModelChange: (model: string | null) => void;
}

export function PromptPanel({
  state,
  onSubmit,
  onReset,
  onCancel,
  onModelChange,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [style, setStyle] = useState<StylePresetId | null>(null);
  const [referenceUrl, setReferenceUrl] = useState('');
  const promptId = useId();
  const failId = useId();
  const referenceId = useId();
  const disabled = state.running;
  // Once there is a conversation, the examples are noise: what to type next
  // comes from what was just built, not from a generic starting point.
  const started = state.transcript.length > 0;

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
    // Clear the box. It is a composer now, not a form field that holds the
    // last thing submitted: leaving the sent message in it means the next
    // turn starts by editing the previous one, which is not what anyone
    // means by "what should change?".
    setPrompt('');
    // The reference URL is scoped to the request it was submitted with, not
    // a standing preference the way `knowledge` is -- clearing it means a
    // later, unrelated turn never re-fetches a page nobody meant it for.
    setReferenceUrl('');
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
        placeholder="https://example.com — a page to copy from or emulate"
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
