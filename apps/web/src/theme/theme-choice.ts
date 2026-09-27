/**
 * Which theme the builder is showing, and how a person changes it.
 *
 * Three states, not two. "System" is a real choice and the default one: it
 * follows the reader's OS and keeps following it, which is what somebody who
 * has never touched the control wants. Light and dark are explicit, and they
 * win over the OS in both directions -- the stylesheet's
 * `:not([data-theme='light'])` guard is the half of that which lets an
 * explicit light choice beat a dark system.
 *
 * JSX-free and storage-guarded, for the two reasons this directory keeps
 * repeating: the test runner errors on JSX, and `localStorage` throws in a
 * private window rather than returning null. A theme that cannot be
 * remembered is a small loss; a builder that will not render because reading
 * a preference threw is not.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'vibld.theme';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** What was chosen last, or "system" when nothing was or it cannot be read. */
export function readThemeChoice(
  storage: Storage | null = safeStorage(),
): ThemeChoice {
  try {
    const stored = storage?.getItem(KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemeChoice(
  choice: ThemeChoice,
  storage: Storage | null = safeStorage(),
): void {
  try {
    if (choice === 'system') storage?.removeItem(KEY);
    else storage?.setItem(KEY, choice);
  } catch {
    // A preference that cannot be remembered is not a reason to fail.
  }
}

interface Root {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Put the choice on the document, which is what the stylesheet reads.
 *
 * "System" removes the attribute rather than setting a value, because the
 * absence is what the media query keys on. Setting `data-theme="system"`
 * would match neither selector and leave the page on whichever tokens the
 * bare `:root` happens to define.
 */
export function applyThemeChoice(choice: ThemeChoice, root: Root | null): void {
  if (!root) return;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/**
 * The next choice when somebody presses the toggle.
 *
 * Two visible states rather than a three-way cycle: a control showing a sun
 * and a moon that sometimes lands on a third thing is a control nobody can
 * predict. Pressing it from "system" takes the opposite of what is on screen,
 * which is what somebody pressing it is asking for.
 */
export function nextChoice(
  current: ThemeChoice,
  systemPrefersDark: boolean,
): ThemeChoice {
  if (current === 'system') return systemPrefersDark ? 'light' : 'dark';
  return current === 'dark' ? 'light' : 'dark';
}

/** Whether what is on screen right now is the dark theme. */
export function showingDark(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): boolean {
  if (choice === 'system') return systemPrefersDark;
  return choice === 'dark';
}
