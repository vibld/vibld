import { useId } from 'react';
import type { ModelOption } from '../generation/remote-provider.ts';

/**
 * Which model answers this run.
 *
 * The list comes from the deployment rather than from a constant: it only
 * offers models whose provider this deployment holds a key for, because
 * offering one it cannot serve produces a run that fails after the user has
 * already waited for it.
 *
 * Renders nothing when there is no choice to make -- one model, or none,
 * which is what `pnpm dev` and the static-only deploy report.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelOption[];
  value: string | null;
  onChange: (model: string | null) => void;
  disabled: boolean;
}) {
  const fieldId = useId();
  if (models.length < 2) return null;

  const selected = models.find((model) => model.id === value) ?? models[0]!;

  return (
    <div className="models">
      <label className="models__label" htmlFor={fieldId}>
        Model
      </label>
      <select
        id={fieldId}
        className="models__select"
        value={selected.id}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
      {/* The trade is the reason to switch, so it is on screen rather than
          hidden in a tooltip: quality against cost is the whole decision. */}
      <p className="models__note">{selected.note}</p>
    </div>
  );
}
