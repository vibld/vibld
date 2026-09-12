import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import type { StylePreset, StylePresetId } from '@vibld/ai/style-presets';

/**
 * A visual direction to start from.
 *
 * The set is closed and lives in `@vibld/ai` beside the prompt it shapes --
 * these chips send an id, never text, and the Worker checks the id against
 * the same list.
 *
 * Two groups, because the presets are two different things and a single row
 * of twenty-three chips hid that. A treatment ("Frosted glass") is a surface
 * finish any palette can wear; a complete system ("Warm terminal") brings its
 * own colours and fonts and replaces the product-type palette entirely.
 * Someone picking between them should be able to see which they are choosing.
 */
const TREATMENTS = STYLE_PRESETS.filter((preset) => !preset.tokens);
const SYSTEMS = STYLE_PRESETS.filter((preset) => preset.tokens);

export function StylePicker({
  value,
  onChange,
  disabled,
}: {
  value: StylePresetId | null;
  onChange: (value: StylePresetId | null) => void;
  disabled: boolean;
}) {
  const row = (label: string, presets: readonly StylePreset[]) => (
    <>
      <span className="styles__group" aria-hidden="true">
        {label}
      </span>
      <div className="styles__row" role="group" aria-label={label}>
        {presets.map((preset) => {
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
    </>
  );

  return (
    <fieldset className="styles" disabled={disabled}>
      <legend className="styles__legend">Style</legend>
      {row('Treatment', TREATMENTS)}
      {row('Complete system', SYSTEMS)}
    </fieldset>
  );
}
