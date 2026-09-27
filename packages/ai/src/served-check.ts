import type { ModelChoice } from './model-catalogue.ts';
import { compareVersions, familyOf } from './model-families.ts';
import type { ProviderName } from './select-client.ts';

/**
 * Whether each provider still serves what the catalogue offers, at the
 * limits the catalogue says, and whether it now serves a newer version of a
 * family offered here.
 *
 * Every model in the catalogue is a promise that a run asking for it gets
 * an answer. A provider that retires an id turns that promise into a 404
 * that reads like an outage, and nothing here finds out until someone picks
 * it. A provider that raises a limit leaves the catalogue sizing runs to the
 * old one, and one that lowers it truncates every run that relied on it.
 * A new version, left out, is a choice nobody made.
 *
 * Each provider's models endpoint lists ids. Anthropic's also gives each
 * model's context window, output ceiling and whether it accepts `effort`,
 * so those are compared too. Prices are not served by any of them and are
 * `price-check.ts`'s business.
 *
 * Pure, so every rule is tested against the documented response shapes.
 * `apps/web/scripts/check-model-catalogue.ts` fetches.
 */

/** What a provider says about one model it serves. */
export interface ServedModel {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsEffort?: boolean;
}

export type ServedFinding =
  | {
      /** Offered here, and the provider no longer lists it. */
      kind: 'not-served';
      provider: ProviderName;
      model: string;
    }
  | {
      /** Served with a different limit than the catalogue records. */
      kind: 'limit-differs';
      provider: ProviderName;
      model: string;
      field: 'contextWindow' | 'maxOutputTokens' | 'supportsEffort';
      catalogue: number | boolean;
      served: number | boolean;
    }
  | {
      /** A version of a family offered here, newer than any offered. */
      kind: 'newer-version';
      provider: ProviderName;
      model: string;
      /** The newest version of that family the catalogue offers. */
      newestOffered: string;
    };

/**
 * The ids in a models list: `{ data: [{ id }] }`, the shape all three
 * providers answer with.
 */
export function listedModels(body: unknown): ServedModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error('the models list has no data array');
  }
  return data.map((item) => {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id === '') {
      throw new Error('a listed model has no id');
    }
    return { id };
  });
}

/**
 * One model from Anthropic's models API, with the limits it serves:
 * `max_input_tokens`, `max_tokens` and `capabilities.effort.supported`.
 * A field that is absent is left out rather than guessed.
 */
export function anthropicServedModel(item: unknown): ServedModel {
  const model = item as {
    id?: unknown;
    max_input_tokens?: unknown;
    max_tokens?: unknown;
    capabilities?: { effort?: { supported?: unknown } };
  } | null;
  if (typeof model?.id !== 'string' || model.id === '') {
    throw new Error('a listed model has no id');
  }
  const served: ServedModel = { id: model.id };
  if (typeof model.max_input_tokens === 'number') {
    served.contextWindow = model.max_input_tokens;
  }
  if (typeof model.max_tokens === 'number') {
    served.maxOutputTokens = model.max_tokens;
  }
  const effort = model.capabilities?.effort?.supported;
  if (typeof effort === 'boolean') served.supportsEffort = effort;
  return served;
}

/**
 * A dated snapshot names the model its alias does: Anthropic lists
 * `claude-haiku-4-5-20251001` for the `claude-haiku-4-5` a request may use.
 */
function withoutSnapshot(id: string): string {
  return id.replace(/-\d{8}$/, '');
}

const LIMITS = ['contextWindow', 'maxOutputTokens', 'supportsEffort'] as const;

/**
 * The catalogue against what each provider serves.
 *
 * `served` names the providers whose lists were actually read, and only
 * their models can be `not-served`: a provider nobody asked has not stopped
 * serving anything.
 */
export function compareServed(
  served: Partial<Record<ProviderName, readonly ServedModel[]>>,
  catalogue: readonly ModelChoice[],
): ServedFinding[] {
  const findings: ServedFinding[] = [];
  for (const [provider, list] of Object.entries(served) as [
    ProviderName,
    readonly ServedModel[],
  ][]) {
    const offered = catalogue.filter((model) => model.provider === provider);
    for (const model of offered) {
      const match = list.find((item) => withoutSnapshot(item.id) === model.id);
      if (!match) {
        findings.push({ kind: 'not-served', provider, model: model.id });
        continue;
      }
      for (const field of LIMITS) {
        const value = match[field];
        if (value !== undefined && value !== model[field]) {
          findings.push({
            kind: 'limit-differs',
            provider,
            model: model.id,
            field,
            catalogue: model[field],
            served: value,
          });
        }
      }
    }

    // Only versions of a family offered here: a provider's list also holds
    // embeddings, audio and image models, and models this catalogue has
    // never offered, and whether to offer any of those is not a finding.
    const newest = new Map<string, { id: string; version: number[] }>();
    for (const model of offered) {
      const family = familyOf(model);
      if (family.version.length === 0) continue;
      const known = newest.get(family.key);
      if (!known || compareVersions(family.version, known.version) < 0) {
        newest.set(family.key, { id: model.id, version: [...family.version] });
      }
    }
    const reported = new Set<string>();
    for (const item of list) {
      const id = withoutSnapshot(item.id);
      if (reported.has(id) || offered.some((model) => model.id === id)) {
        continue;
      }
      const family = familyOf({ id, label: id });
      const known = newest.get(family.key);
      if (known && compareVersions(family.version, known.version) < 0) {
        reported.add(id);
        findings.push({
          kind: 'newer-version',
          provider,
          model: id,
          newestOffered: known.id,
        });
      }
    }
  }
  return findings;
}
