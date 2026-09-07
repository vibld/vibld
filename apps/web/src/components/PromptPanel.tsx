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
}

export function PromptPanel({ state, onSubmit, onReset }: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [failNext, setFailNext] = useState(false);
  const promptId = useId();
  const failId = useId();
  const disabled = state.running;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || prompt.trim().length === 0) return;
    onSubmit(prompt, failNext ? 'fail-validation' : 'succeed');
  }

  return (
    <form className="prompt" onSubmit={handleSubmit}>
      <label className="prompt__label" htmlFor={promptId}>
        Describe your application
      </label>
      <textarea
        id={promptId}
        className="prompt__input"
        value={prompt}
        rows={4}
        placeholder="A landing page for…"
        onChange={(event) => setPrompt(event.target.value)}
        disabled={disabled}
      />

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
          {state.running
            ? 'Generating…'
            : state.runCount > 0
              ? 'Generate again'
              : 'Generate'}
        </button>
        <button
          type="button"
          className="button"
          onClick={onReset}
          disabled={state.runCount === 0 && !state.running}
        >
          Start over
        </button>
      </div>

      {state.planSummary ? (
        <section className="plan" aria-label="Plan">
          <h2 className="plan__title">Plan</h2>
          <p className="plan__summary">{state.planSummary}</p>
        </section>
      ) : null}
    </form>
  );
}
