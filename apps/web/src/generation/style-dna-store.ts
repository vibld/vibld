/**
 * Where standing visual preferences live between visits.
 *
 * Same reasoning and the same guards as `knowledge-store.ts`: this is a
 * preference about how someone wants their own projects built, it belongs to
 * their browser, and every access is wrapped because a private window or
 * blocked site data makes these throw rather than return nothing.
 *
 * What is stored is the selection, never the guidance text it produces. The
 * catalogue can then gain a dimension, reword a direction or rename a value
 * without a stale sentence surviving in someone's browser: `sanitizeStyleDna`
 * drops anything the catalogue no longer recognises on the way back in.
 */

import { sanitizeStyleDna } from '@vibld/ai/style-dna';
import type { StyleDna } from '@vibld/ai/style-dna';
import type { KnowledgeStorage } from './knowledge-store.ts';

export const STYLE_DNA_KEY = 'vibld.styleDna.v1';

function defaultStorage(): KnowledgeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadStyleDna(
  storage: KnowledgeStorage | null = defaultStorage(),
): StyleDna {
  if (!storage) return {};
  try {
    const stored = storage.getItem(STYLE_DNA_KEY);
    if (typeof stored !== 'string') return {};
    return sanitizeStyleDna(JSON.parse(stored));
  } catch {
    // Unreadable storage or a value that is no longer JSON. Either way the
    // answer is "no preferences set", not a builder that will not start.
    return {};
  }
}

export function saveStyleDna(
  styleDna: StyleDna,
  storage: KnowledgeStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const clean = sanitizeStyleDna(styleDna);
    if (Object.keys(clean).length === 0) storage.removeItem(STYLE_DNA_KEY);
    else storage.setItem(STYLE_DNA_KEY, JSON.stringify(clean));
  } catch {
    // A full or blocked store is not worth failing a generation over.
  }
}
