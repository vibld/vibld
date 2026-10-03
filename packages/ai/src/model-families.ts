import type { ModelChoice } from './model-catalogue.ts';

/**
 * Models grouped the way people ask for them: "Opus", not
 * `claude-opus-5-5`.
 *
 * Every version a provider still sells is offered, so the picker would
 * otherwise be a list of near-identical names. Grouped by family, someone
 * chooses Opus and gets the version worth having, and anyone who wants a
 * particular version can still pick it.
 *
 * A family's default is its newest version. Among the models offered that
 * is also never the dearer choice: Opus 5.5 costs less than Opus 5 and the
 * 4.x Opuses, Sonnet 5.5 the same as Sonnet 5 and Sonnet 5 less than Sonnet 4.6, Fable 5.1 the same as Fable 5,
 * and each GPT-6 tier less than its GPT-5.6 namesake. `model-families.test.ts`
 * says so if a newer version ever costs more, because then "newest" and "best
 * value" have come apart and which one a family should open on is a decision
 * for a person, not a sort order.
 */

export interface ModelFamily {
  /** Stable key: `claude-opus`, `gpt-sol`, or the model id when ungrouped. */
  key: string;
  /** Shown in the picker: "Claude Opus", "GPT Sol". */
  label: string;
  /** Numeric version, newest compares greatest. Empty when ungrouped. */
  version: readonly number[];
  /** The version as people write it: "5.5", "6". */
  versionLabel: string;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Which family a model belongs to, from its id.
 *
 * Claude ids are `claude-<tier>-<major>[-<minor>]`, and OpenAI's are
 * `gpt-<version>-<tier>`: the tier is the family in both, the way Opus is
 * the family and 5.5 the version. Anything else is a family of one, which
 * the picker shows as a plain choice.
 */
export function familyOf(
  model: Pick<ModelChoice, 'id' | 'label'>,
): ModelFamily {
  const claude = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(model.id);
  if (claude) {
    const version = claude[2]!.split('-').map(Number);
    return {
      key: `claude-${claude[1]}`,
      label: `Claude ${titleCase(claude[1]!)}`,
      version,
      versionLabel: version.join('.'),
    };
  }
  const gpt = /^gpt-(\d+(?:\.\d+)*)-([a-z]+)$/.exec(model.id);
  if (gpt) {
    const version = gpt[1]!.split('.').map(Number);
    return {
      key: `gpt-${gpt[2]}`,
      label: `GPT ${titleCase(gpt[2]!)}`,
      version,
      versionLabel: version.join('.'),
    };
  }
  return { key: model.id, label: model.label, version: [], versionLabel: '' };
}

/** Newer first. Missing components count as zero: 5 is 5.0. */
export function compareVersions(
  a: readonly number[],
  b: readonly number[],
): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (b[i] ?? 0) - (a[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface FamilyGroup<T> {
  family: ModelFamily;
  /** Newest first. */
  members: T[];
  /** The id a family opens on. */
  defaultId: string;
}

/**
 * The offered models, grouped into families in the order each family first
 * appears, members newest first, with each family's default.
 */
export function groupByFamily<T extends Pick<ModelChoice, 'id' | 'label'>>(
  models: readonly T[],
): FamilyGroup<T>[] {
  const groups = new Map<string, { family: ModelFamily; members: T[] }>();
  for (const model of models) {
    const family = familyOf(model);
    const group = groups.get(family.key);
    if (group) group.members.push(model);
    else groups.set(family.key, { family, members: [model] });
  }
  return [...groups.values()].map(({ family, members }) => {
    const sorted = [...members].sort((a, b) =>
      compareVersions(familyOf(a).version, familyOf(b).version),
    );
    return { family, members: sorted, defaultId: sorted[0]!.id };
  });
}

/** The id a model's family opens on, among `models`. */
export function familyDefaultFor<T extends Pick<ModelChoice, 'id' | 'label'>>(
  id: string,
  models: readonly T[],
): string | null {
  const model = models.find((candidate) => candidate.id === id);
  if (!model) return null;
  const key = familyOf(model).key;
  return (
    groupByFamily(models).find((group) => group.family.key === key)
      ?.defaultId ?? null
  );
}
