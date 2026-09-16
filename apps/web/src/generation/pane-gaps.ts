/**
 * Where the builder's own panes stop short of what the sandbox does, named
 * once.
 *
 * Two surfaces state each of these: the pane that has the gap, and the
 * footer, which is the only place it reaches somebody who never opens that
 * pane. They drifted three times. The footer denied sandbox execution, real
 * providers, Git export and deployment for weeks after all four shipped.
 * When the console note was corrected, the Problems note four lines below it
 * was missed. When that was corrected, the footer was missed again, and
 * merged still reading as though Problems were fully wired.
 *
 * A sentence kept in two files drifts in two files, so both are built from
 * here. Correcting a gap now corrects every surface that states it, and the
 * tests assert each surface renders what this module produces rather than a
 * copy of it.
 *
 * What this does not catch: a gap dropped from this record disappears from
 * the pane and the footer together. The failure being fixed is drift between
 * surfaces, not omission.
 */
export interface PaneGap {
  /** That pane's own note: what it shows, then what it does not. */
  readonly note: string;
  /** The same gap for the footer, for somebody who never opens the pane. */
  readonly footerSentence: string;
}

export const PANE_GAPS = {
  console: {
    note: 'Generation lifecycle events. Sandbox execution exists; its process output is not piped here yet.',
    footerSentence:
      'The console shows generation events, not output from a sandbox run.',
  },
  problems: {
    note: 'Validation findings for the staged project. Sandbox execution exists; its install, build and type errors are not reported here yet.',
    footerSentence:
      'Problems shows validation findings for the staged project, not the install, build and type errors from a sandbox run.',
  },
} as const satisfies Record<string, PaneGap>;

export type PaneWithGap = keyof typeof PANE_GAPS;

/**
 * The preview gap is a different shape: its pane says at length what the mock
 * is and is not, with markup, so it is not assembled here. The footer still
 * leads with it, because a mock read as the project is the misreading the
 * rest of this exists to prevent.
 */
export const PREVIEW_SENTENCE =
  'Preview shows a local mock until you run the project in the sandbox.';

/** The note that pane renders above its own contents. */
export function noteFor(pane: PaneWithGap): string {
  return PANE_GAPS[pane].note;
}

/** Every gap above, as the footer states them, in one line. */
export function footerNote(): string {
  return [
    PREVIEW_SENTENCE,
    ...Object.values(PANE_GAPS).map((gap) => gap.footerSentence),
  ].join(' ');
}
