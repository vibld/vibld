import { useMemo, useState } from 'react';

import {
  PRESET_MOODS,
  STYLE_MOODS,
  STYLE_PRESETS,
  suggestStyles,
} from '@vibld/ai/style-presets';
import type {
  StyleMood,
  StylePreset,
  StylePresetId,
} from '@vibld/ai/style-presets';

/**
 * A visual direction to start from.
 *
 * The set is closed and lives in `@vibld/ai` beside the prompt it shapes --
 * these chips send an id, never text, and the Worker checks the id against
 * the same list.
 *
 * Two groups, because the presets are two different things and a single row
 * of twenty-three chips hid that. A treatment ("Glassmorphism") is a surface
 * finish any palette can wear; a complete system ("Warm terminal") brings its
 * own colours and fonts and replaces the product-type palette entirely.
 * Someone picking between them should be able to see which they are choosing.
 *
 * The names are still only names, which is the gap internal issue 186 names: a chip
 * reading "Brutalist" tells somebody who has not seen one nothing at all,
 * and the cheapest way to find out is currently to spend a run. So the
 * legend carries a link to vibld.com/styles, which is generated from this
 * same `STYLE_PRESETS` list and therefore cannot drift from what these
 * chips send.
 *
 * Moods (D76): a row of six narrows both groups to the styles that carry
 * one, and the styles whose moods the request names ("calm", "premium")
 * are marked as suggestions. A suggestion is only a mark: nothing is picked
 * for the person, and a build with no style chosen is unchanged.
 */
const TREATMENTS = STYLE_PRESETS.filter((preset) => !preset.tokens);
const SYSTEMS = STYLE_PRESETS.filter((preset) => preset.tokens);

export function StylePicker({
  value,
  onChange,
  disabled,
  prompt = '',
}: {
  value: StylePresetId | null;
  onChange: (value: StylePresetId | null) => void;
  disabled: boolean;
  /** The request as typed, which the suggestions are read from. */
  prompt?: string;
}) {
  const [mood, setMood] = useState<StyleMood | null>(null);
  const suggested = useMemo(() => new Set(suggestStyles(prompt)), [prompt]);
  const chosen = STYLE_PRESETS.find((preset) => preset.id === value) ?? null;
  // The chosen style stays visible under any mood, so it can be cleared.
  const shown = (preset: StylePreset) =>
    mood === null ||
    preset.id === value ||
    PRESET_MOODS[preset.id].includes(mood);
  const row = (label: string, presets: readonly StylePreset[]) => {
    const visible = presets.filter(shown);
    if (visible.length === 0) return null;
    return (
      <>
        <span className="styles__group" aria-hidden="true">
          {label}
        </span>
        <div className="styles__row" role="group" aria-label={label}>
          {visible.map((preset) => {
            const selected = preset.id === value;
            const isSuggested = suggested.has(preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                // Selecting the chosen chip again clears it: a starting point
                // you cannot put back is a trap, and there is no "none" chip.
                onClick={() => onChange(selected ? null : preset.id)}
                className={`chip chip--style${selected ? ' chip--on' : ''}${
                  isSuggested ? ' chip--suggested' : ''
                }`}
                aria-pressed={selected}
                title={preset.description}
                data-suggested={isSuggested ? 'true' : undefined}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </>
    );
  };
  const suggestedNames = STYLE_PRESETS.filter((preset) =>
    suggested.has(preset.id),
  ).map((preset) => preset.name);

  return (
    <fieldset className="styles" disabled={disabled}>
      <legend className="styles__legend">
        Style
        {/*
          Outside the fieldset's disabled reach in spirit, though not in
          markup: `disabled` greys the chips while a run is going, and a
          link is not a control that could disturb the run. Somebody
          watching a build is exactly who wants to read about the
          directions for the next one.
        */}
        <a
          className="styles__catalogue"
          href="https://vibld.com/styles"
          target="_blank"
          rel="noopener noreferrer"
        >
          See them all
        </a>
      </legend>
      <div className="styles__moods" role="group" aria-label="Mood">
        {STYLE_MOODS.map((entry) => {
          const on = entry.id === mood;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setMood(on ? null : entry.id)}
              className={`chip chip--mood${on ? ' chip--on' : ''}`}
              aria-pressed={on}
            >
              {entry.name}
            </button>
          );
        })}
      </div>
      {row('Treatment', TREATMENTS)}
      {row('Complete system', SYSTEMS)}
      {!chosen && suggestedNames.length > 0 ? (
        <p className="styles__suggested" aria-live="polite">
          Suggested for your request: {suggestedNames.join(', ')}
        </p>
      ) : null}
      {/*
        What the chosen one will do, in the preset's own words. The chip
        names alone ("Claymorphism") told somebody who had not seen one
        nothing (internal issue 186), and a tooltip is invisible on a phone.
      */}
      {chosen ? (
        <p className="styles__chosen" aria-live="polite">
          <strong>{chosen.name}:</strong> {chosen.description}
        </p>
      ) : null}
    </fieldset>
  );
}
