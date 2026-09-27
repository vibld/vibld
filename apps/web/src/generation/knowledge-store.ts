/**
 * Where standing instructions live between visits.
 *
 * `localStorage`, deliberately: this is a preference about how someone wants
 * their own projects built, it belongs to their browser, and sending it to a
 * server would mean building an account system to hold two sentences.
 *
 * Every access is guarded. Private windows, cleared site data and browsers
 * configured to block storage all make these throw rather than return
 * nothing, and a builder that will not start because it could not read a
 * preference is worse than one that forgets it.
 */

import { MAX_KNOWLEDGE_CHARS } from '@vibld/ai/limits';

export const KNOWLEDGE_KEY = 'vibld.knowledge.v1';

export interface KnowledgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KnowledgeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadKnowledge(
  storage: KnowledgeStorage | null = defaultStorage(),
): string {
  if (!storage) return '';
  try {
    const stored = storage.getItem(KNOWLEDGE_KEY);
    // Truncated rather than discarded: a stored value over the cap can only
    // come from an older, larger limit, and losing someone's instructions
    // entirely is a worse answer than keeping what still fits.
    return typeof stored === 'string'
      ? stored.slice(0, MAX_KNOWLEDGE_CHARS)
      : '';
  } catch {
    return '';
  }
}

export function saveKnowledge(
  knowledge: string,
  storage: KnowledgeStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (knowledge.trim().length === 0) storage.removeItem(KNOWLEDGE_KEY);
    else
      storage.setItem(KNOWLEDGE_KEY, knowledge.slice(0, MAX_KNOWLEDGE_CHARS));
  } catch {
    // A full or blocked store is not worth failing a generation over.
  }
}
