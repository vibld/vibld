import { useId } from 'react';
import { MAX_KNOWLEDGE_CHARS } from '@vibld/ai/limits';

/**
 * Standing instructions: the things a person should only have to say once.
 *
 * Shown inside the composer's options row rather than as its own panel
 * above it (2026-09-28): this is a preference someone sets and then forgets
 * about, so it should not take space from the conversation on every turn.
 * The option's button says when it is set, because instructions you cannot
 * see silently shaping every result would be worse than not having them.
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
  const fieldId = useId();
  const remaining = MAX_KNOWLEDGE_CHARS - knowledge.length;

  return (
    <div className="knowledge">
      <label className="option-panel__label" htmlFor={fieldId}>
        Project instructions
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
    </div>
  );
}
