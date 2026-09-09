import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import type { StylePresetId } from '@vibld/ai/style-presets';

/**
 * A visual direction to start from.
 *
 * The set is closed and lives in `@vibld/ai` beside the prompt it shapes --
 * these chips send an id, never text, and the Worker checks the id against
 * the same list.
 */
export function StylePicker({
  value,
  onChange,
  disabled,
}: {
  value: StylePresetId | null;
  onChange: (value: StylePresetId | null) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="styles" disabled={disabled}>
      <legend className="styles__legend">Style</legend>
      <div className="styles__row">
        {STYLE_PRESETS.map((preset) => {
          const selected = preset.id === value;
          return (
            <button
              key={preset.id}
              type="button"
              // Selecting the chosen chip again clears it: a starting point
              // you cannot put back is a trap, and there is no "none" chip.
              onClick={() => onChange(selected ? null : preset.id)}
              className={`chip chip--style${selected ? ' chip--on' : ''}`}
              aria-pressed={selected}
              title={preset.description}
            >
              {preset.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
