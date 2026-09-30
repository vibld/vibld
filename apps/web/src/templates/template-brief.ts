/**
 * "Start from this template" (docs/decisions.md, D106): vibld.com links to
 * the builder with a design's brief in the address's fragment,
 *
 *   https://app.vibld.com/#template=<id>&brief=<the brief, encoded>
 *     [&screens=<screen id>,<screen id>]
 *
 * and the composer opens with that brief in it, ready to send or edit, and
 * with the text of each chosen screen pattern after it (D110).
 *
 * The fragment, because it is never sent to a server: the brief is several
 * kilobytes, and none of it is the Worker's business until somebody sends
 * it. It is read once, on the first load, before the sign-in screen can
 * change the address, and kept in `localStorage` (as a referral code is, for
 * the same reason: signing up can finish in another tab) until the composer
 * takes it. The fragment is then removed, so a reload does not bring the
 * brief back after it was sent.
 */
import { MAX_PROMPT_CHARS } from '@vibld/ai/limits';

export const TEMPLATE_BRIEF_KEY = 'vibld.template-brief';

/**
 * The longest message the Worker accepts (D111), so a brief the composer is
 * filled with can always be sent.
 */
export const MAX_BRIEF_CHARS = MAX_PROMPT_CHARS;

export interface TemplateBrief {
  template: string;
  brief: string;
  /** Screen pattern ids to add to the brief (D110), in the order chosen. */
  screens: string[];
}

const ID = /^[a-z0-9-]{1,80}$/;

/** The most screen ids a link may carry: `MAX_COMPOSED_SCREENS`. */
const MAX_LINK_SCREENS = 6;

function screensOf(value: unknown): string[] {
  const list =
    typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value)
        ? value
        : [];
  return [
    ...new Set(
      list.filter((id): id is string => typeof id === 'string' && ID.test(id)),
    ),
  ].slice(0, MAX_LINK_SCREENS);
}

export type BriefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function briefStorage(): BriefStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The brief a fragment carries, or null when it carries none worth using. */
export function readTemplateBrief(hash: string): TemplateBrief | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const template = params.get('template') ?? '';
  const brief = (params.get('brief') ?? '').trim();
  if (!ID.test(template)) return null;
  if (brief.length === 0 || brief.length > MAX_BRIEF_CHARS) return null;
  return { template, brief, screens: screensOf(params.get('screens') ?? '') };
}

/**
 * Keep the brief the address arrived with, and take it out of the address.
 * Returns what was kept.
 */
export function captureTemplateBrief(
  location: { hash: string; pathname: string; search: string },
  history: Pick<History, 'replaceState'> | null,
  storage: BriefStorage | null,
): TemplateBrief | null {
  const found = readTemplateBrief(location.hash);
  if (found === null) return null;
  try {
    storage?.setItem(TEMPLATE_BRIEF_KEY, JSON.stringify(found));
  } catch {
    // A refused store: the link still opened the builder, without the brief.
  }
  history?.replaceState(null, '', `${location.pathname}${location.search}`);
  return found;
}

/** The kept brief, removed as it is taken, so the composer fills once. */
export function takeTemplateBrief(
  storage: BriefStorage | null,
): TemplateBrief | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(TEMPLATE_BRIEF_KEY);
    storage.removeItem(TEMPLATE_BRIEF_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<TemplateBrief>;
    return typeof parsed.template === 'string' &&
      typeof parsed.brief === 'string' &&
      parsed.brief.length <= MAX_BRIEF_CHARS
      ? {
          template: parsed.template,
          brief: parsed.brief,
          screens: screensOf(parsed.screens),
        }
      : null;
  } catch {
    return null;
  }
}
