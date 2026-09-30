/**
 * The SaaS screen patterns as a brief composes them (docs/decisions.md,
 * D110): for each screen, what it is for, its patterns, layout, components,
 * data, states and guardrails, without its own stack or design system,
 * because a composed screen is built in the design it joins.
 *
 * The data is `../data/screen-patterns.ts`, generated with the catalog by
 * `bin/import-design-catalog.ts`. It is its own subpath,
 * `@vibld/ai/screen-patterns`, a fraction of the catalog's size, so the
 * builder can load it when its screen picker opens.
 */
import data from '../data/screen-patterns.ts';

export interface ScreenPattern {
  id: string;
  name: string;
  /** One line: what it is. */
  summary: string;
  /** The kind of screen the catalog files it under: dashboard, settings... */
  category: string;
  /** Every kind of screen it is. */
  screenTypes: readonly string[];
  /** The markdown a brief composes it as. */
  section: string;
}

interface ScreenFile {
  /** The catalog's baseline for every SaaS screen. */
  baseline: string;
  screens: ScreenPattern[];
}

const file = data as unknown as ScreenFile;

export const SCREEN_BASELINE: string = file.baseline;

export const SCREENS: readonly ScreenPattern[] = file.screens;

/** The most screens a brief composes: each adds about 3,000 characters. */
export const MAX_COMPOSED_SCREENS = 6;

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function findScreen(id: string): ScreenPattern | undefined {
  return BY_ID.get(id);
}

const HEADING = [
  '## Screens to add',
  "Build each screen below inside this project, in its design system above: its colors, typefaces, spacing, radius and components. A screen names its own product and sample data; use this project's instead. Keep the app shell the same on every screen.",
];

/**
 * The screens of `ids` a brief composes: known ones, each once, in the order
 * given, no more than `MAX_COMPOSED_SCREENS`, and only as many as fit in
 * `maxChars` of text. The rest are left out.
 */
export function composedScreens(
  ids: readonly string[],
  maxChars = Number.POSITIVE_INFINITY,
): ScreenPattern[] {
  const known = [...new Set(ids)]
    .map((id) => BY_ID.get(id))
    .filter((s): s is ScreenPattern => s !== undefined)
    .slice(0, MAX_COMPOSED_SCREENS);
  const kept: ScreenPattern[] = [];
  let length = [...HEADING, SCREEN_BASELINE].join('\n\n').length + 1;
  for (const screen of known) {
    const next = length + 2 + screen.section.length;
    if (next > maxChars) break;
    kept.push(screen);
    length = next;
  }
  return kept;
}

/**
 * The part of a brief that adds `ids` to a project: a heading, how to build
 * them, the catalog's screen baseline, then each screen `composedScreens`
 * keeps. Never longer than `maxChars`; empty when no screen is kept.
 */
export function screenSections(
  ids: readonly string[],
  maxChars = Number.POSITIVE_INFINITY,
): string {
  const screens = composedScreens(ids, maxChars);
  if (screens.length === 0) return '';
  return (
    [...HEADING, SCREEN_BASELINE, ...screens.map((s) => s.section)].join(
      '\n\n',
    ) + '\n'
  );
}
