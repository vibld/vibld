/**
 * The model somebody picked, remembered between visits.
 *
 * `localStorage`, like the standing instructions beside it
 * (`knowledge-store.ts`): which model someone prefers is a preference of
 * their browser, not something an account has to hold. It is only ever a
 * preference. The deployment still decides what this person may use, on
 * every request (`model-access.ts`), and a stored id the deployment no
 * longer offers is ignored in favour of its default (`chooseModel`).
 *
 * Every access is guarded, for the same reason as there: a browser that
 * blocks storage makes these throw, and forgetting a choice is a smaller
 * failure than a builder that will not start.
 */

export const MODEL_CHOICE_KEY = 'vibld.model.v1';

export interface ModelChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): ModelChoiceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadModelChoice(
  storage: ModelChoiceStorage | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(MODEL_CHOICE_KEY);
    return typeof stored === 'string' && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function saveModelChoice(
  model: string | null,
  storage: ModelChoiceStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (model === null) storage.removeItem(MODEL_CHOICE_KEY);
    else storage.setItem(MODEL_CHOICE_KEY, model);
  } catch {
    // A full or blocked store is not worth failing anything over.
  }
}

/**
 * The model the picker should show once the deployment has answered: the
 * one this person chose, if the deployment still offers it to them, and
 * the deployment's default otherwise.
 */
export function chooseModel(
  preferred: string | null,
  offered: readonly { id: string }[],
  deploymentDefault: string | null,
): string | null {
  if (preferred !== null && offered.some((model) => model.id === preferred)) {
    return preferred;
  }
  return deploymentDefault;
}
