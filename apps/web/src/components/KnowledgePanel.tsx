import { useId, useState } from 'react';
import { MAX_KNOWLEDGE_CHARS } from '@vibld/ai/limits';

/**
 * Standing instructions: the things a person should only have to say once.
 *
 * Collapsed by default. This is a preference someone sets and then forgets
 * about, so it should not take space from the composer on every turn -- but
 * the summary says when it is set, because instructions you cannot see
 * silently shaping every result would be worse than not having them.
 */
export function KnowledgePanel({
  knowledge,
  onChange,
  disabled,
}: {
  knowledge: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const set = knowledge.trim().length > 0;
  const remaining = MAX_KNOWLEDGE_CHARS - knowledge.length;

  return (
    <details
      className="knowledge"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="knowledge__summary">
        Project instructions
        {set ? (
          <span className="pill pill--on">on</span>
        ) : (
          <span className="knowledge__hint">not set</span>
        )}
      </summary>
      <label className="knowledge__label" htmlFor={fieldId}>
        Applied to every request, so you do not have to repeat yourself.
      </label>
      <textarea
        id={fieldId}
        className="prompt__input"
        rows={3}
        value={knowledge}
        disabled={disabled}
        maxLength={MAX_KNOWLEDGE_CHARS}
        placeholder="Keep it dark. No rounded corners. Always include a privacy link."
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="knowledge__count">
        {remaining < 200
          ? `${remaining} characters left`
          : `Up to ${MAX_KNOWLEDGE_CHARS} characters`}
      </p>
    </details>
  );
}
