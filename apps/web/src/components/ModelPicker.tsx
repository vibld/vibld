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
 * Grouped by family. Every version a provider still sells is offered, so a
 * flat list reads as a column of near-identical names. The first control
 * chooses the family (Claude Opus, GPT Sol) and lands on its newest
 * version; the second, shown only where a family has more than one, picks
 * a particular version for anyone who wants it.
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
  const familyId = useId();
  const versionId = useId();
  if (models.length < 2) return null;

  const groups = groupByFamily(models);
  const selected = models.find((model) => model.id === value) ?? models[0]!;
  const current =
    groups.find((group) =>
      group.members.some((member) => member.id === selected.id),
    ) ?? groups[0]!;

  return (
    <div className="models">
      <label className="models__label" htmlFor={familyId}>
        Model
      </label>
      <select
        id={familyId}
        className="models__select"
        value={current.family.key}
        disabled={disabled}
        onChange={(event) => {
          const group = groups.find(
            (candidate) => candidate.family.key === event.target.value,
          );
          if (group) onChange(group.defaultId);
        }}
      >
        {groups.map((group) => (
          <option key={group.family.key} value={group.family.key}>
            {group.members.length > 1
              ? group.family.label
              : group.members[0]!.label}
          </option>
        ))}
      </select>
      {current.members.length > 1 ? (
        <>
          <label className="models__label" htmlFor={versionId}>
            Version
          </label>
          <select
            id={versionId}
            className="models__select"
            value={selected.id}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            {current.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.id === current.defaultId
                  ? `${member.label} (newest)`
                  : member.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {/* The trade is the reason to switch, so it is on screen rather than
          hidden in a tooltip: quality against cost is the whole decision. */}
      <p className="models__note">{selected.note}</p>
    </div>
  );
}
