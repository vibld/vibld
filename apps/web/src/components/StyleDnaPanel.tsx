import { useId } from 'react';
import { STYLE_DIMENSIONS } from '@vibld/ai/style-dna';
import type { StyleDna, StyleDimensionId } from '@vibld/ai/style-dna';

/**
 * Standing visual preferences, as a row of small closed-set selects. Shown
 * inside the composer's options row as "Look" (2026-09-28).
 *
 * These sit beside the free-text project instructions rather than inside
 * them, and the difference is the point. Prose drifts: "keep it minimal"
 * means something slightly different to the model every turn, and someone
 * re-reading their own instruction three turns later cannot tell whether it
 * is still being honoured. A fixed vocabulary does not drift, and it does not
 * compete with the user's own words for the instruction budget.
 *
 * Every value crosses the network as an id from a closed set, exactly as a
 * style preset does, and the Worker sanitizes against the same catalogue.
 */
export function StyleDnaPanel({
  styleDna,
  onChange,
  disabled,
}: {
  styleDna: StyleDna;
  onChange: (value: StyleDna) => void;
  disabled: boolean;
}) {
  const groupId = useId();
  const count = Object.keys(styleDna).length;

  const set = (id: StyleDimensionId, value: string) => {
    const next = { ...styleDna };
    // The empty option is how a dimension is unset. Without it a preference
    // set once could never be taken back, only changed to something else.
    if (value === '') delete next[id];
    else next[id] = value;
    onChange(next);
  };

  return (
    <div className="dna-panel">
      <p className="option-panel__label">Look</p>
      <div className="dna">
        {STYLE_DIMENSIONS.map((dimension) => {
          const fieldId = `${groupId}-${dimension.id}`;
          return (
            <div className="dna__field" key={dimension.id}>
              <label className="dna__label" htmlFor={fieldId}>
                {dimension.label}
              </label>
              <select
                id={fieldId}
                className="dna__select"
                value={styleDna[dimension.id] ?? ''}
                disabled={disabled}
                onChange={(event) => set(dimension.id, event.target.value)}
              >
                <option value="">Any</option>
                {dimension.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {count > 0 ? (
        <button
          type="button"
          className="linkbutton"
          disabled={disabled}
          onClick={() => onChange({})}
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
