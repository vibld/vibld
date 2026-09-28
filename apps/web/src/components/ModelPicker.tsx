import { useId } from 'react';
import { groupByFamily } from '@vibld/ai/model-families';
import type { ModelOption } from '../generation/remote-provider.ts';

/**
 * Which model answers this run.
 *
 * The list comes from the deployment rather than from a constant: it only
 * offers models whose provider this deployment holds a key for, because
 * offering one it cannot serve produces a run that fails after the user has
 * already waited for it.
 *
 * One dropdown, grouped by family, newest version first in each. It used to
 * be two dropdowns (family, then version) with a sentence under them about
 * price, and Chris asked for a plain dropdown with no prose (2026-09-28):
 * the builder's composer had become a form to fill in rather than a place
 * to talk. `optgroup` keeps a list of eighteen names scannable without a
 * second control.
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
  const id = useId();
  if (models.length < 2) return null;

  const groups = groupByFamily(models);
  const selected = models.find((model) => model.id === value) ?? models[0]!;

  return (
    <div className="models">
      <label className="visually-hidden" htmlFor={id}>
        Model
      </label>
      <select
        id={id}
        className="models__select"
        value={selected.id}
        disabled={disabled}
        title="Model"
        onChange={(event) => onChange(event.target.value)}
      >
        {groups.map((group) =>
          group.members.length > 1 ? (
            <optgroup key={group.family.key} label={group.family.label}>
              {group.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={group.family.key} value={group.members[0]!.id}>
              {group.members[0]!.label}
            </option>
          ),
        )}
      </select>
    </div>
  );
}
