import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { BuilderState } from '../generation/session.ts';
import type { PlanMode } from '../generation/plan-builder.ts';

const EXAMPLES = [
  'A landing page for a cybersecurity SaaS with pricing, FAQ and a contact form',
  'A marketing site for an indie coffee roaster with features and testimonials',
];

export interface PromptPanelProps {
  state: BuilderState;
  onSubmit: (prompt: string, mode: PlanMode) => void;
  onReset: () => void;
  onCancel: () => void;
}

export function PromptPanel({
  state,
  onSubmit,
  onReset,
  onCancel,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [failNext, setFailNext] = useState(false);
  const promptId = useId();
  const failId = useId();
  const disabled = state.running;
  // Once there is a conversation, the examples are noise: what to type next
  // comes from what was just built, not from a generic starting point.
  const started = state.transcript.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || prompt.trim().length === 0) return;
    onSubmit(prompt, failNext ? 'fail-validation' : 'succeed');
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
