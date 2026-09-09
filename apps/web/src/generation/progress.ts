/**
 * Presentation of an in-flight generation.
 *
 * Writing a whole project takes minutes -- one measured run took 496 seconds.
 * For that entire time the shell used to show a single frozen line, which is
 * indistinguishable from a hang; that is what made a working build look
 * broken. These helpers turn the raw counters the Worker streams into
 * something a person can read, and they live apart from the component so the
 * wording and the arithmetic can be tested without a DOM.
 */

import type { GenerationProgress } from './session.ts';

/**
 * How often assistive technology hears about a run that is still going.
 *
 * The counters change several times a second. Announcing every change would
 * make the page unusable with a screen reader, so the announcement text is
 * derived from a coarse bucket: it is identical between boundaries, the DOM
 * text does not change, and the live region stays silent.
 */
export const ANNOUNCE_INTERVAL_MS = 30_000;

/** Past this, a run is long enough that a person deserves an explanation. */
export const REASSURE_AFTER_MS = 45_000;

/** `m:ss`, or `h:mm:ss` once a run passes an hour. Never negative. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

/** Grouped digits. Characters, not tokens: no tokenizer runs in the browser. */
export function formatCharacters(characters: number): string {
  const safe =
    Number.isFinite(characters) && characters > 0 ? Math.floor(characters) : 0;
  return safe.toLocaleString('en-US');
}

/** The one-line summary shown beside the meter. */
export function describeProgress(progress: GenerationProgress): string {
  return `${formatCharacters(progress.characters)} characters written · ${formatElapsed(progress.elapsedMs)}`;
}

/**
 * Says why the wait is long, but only once it is long. Showing this from the
 * first second would train people to ignore it.
 */
export function reassurance(progress: GenerationProgress): string | null {
  if (progress.elapsedMs < REASSURE_AFTER_MS) return null;
  return 'Writing a whole project takes several minutes. You can cancel at any time.';
}

/**
 * Text for the polite live region, or null before the first boundary.
 *
 * Bucketed to `ANNOUNCE_INTERVAL_MS` so the string is stable between
 * announcements -- see the constant.
 */
export function progressAnnouncement(
  progress: GenerationProgress | null,
): string | null {
  if (progress === null) return null;
  const elapsed =
    Number.isFinite(progress.elapsedMs) && progress.elapsedMs > 0
      ? progress.elapsedMs
      : 0;
  const buckets = Math.floor(elapsed / ANNOUNCE_INTERVAL_MS);
  if (buckets < 1) return null;
  return `Still generating, ${formatElapsed(buckets * ANNOUNCE_INTERVAL_MS)} elapsed.`;
}
