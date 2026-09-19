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

import type { GenerationProgress, GenerationStage } from './session.ts';

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

/**
 * What a run is called when the Worker has no honest word for its state.
 *
 * One constant and not two matching strings, because the on-screen sentence
 * and the spoken one had already drifted once: `d11a8a4` gave the live
 * region "Still working", an active-work label for a run that may be paused
 * or asleep between retries, while the visible line beside it claimed
 * nothing of the kind (#188 review). Sharing the words is what stops the
 * two disagreeing again.
 *
 * "Going" and not "working": what is known is that the run has not
 * finished. Nothing here claims anything is happening this second.
 */
const STILL_GOING = 'Still going';

/**
 * What each stage is called on screen. Plain words, not internal states.
 *
 * "Building" rather than "Writing" (#188 review). The Worker can see that a
 * run is under way; it cannot see which of the Workflow's three steps it is
 * in, and the writing is only the first of them. A word naming the writing
 * kept claiming it through settlement and the trace write, which is a
 * confident wrong answer where a broader true one was available.
 */
const STAGE_WORDS: Record<GenerationStage, string> = {
  queued: 'Waiting for a slot',
  running: 'Building your project',
  // Not a Workflow state: it is what the progress channel reports when a
  // reasoning model has streamed thinking and none of the answer
  // (`run-stage.ts`). Worth its own word because it is most of the wait on
  // the production provider, and because it is the honest explanation for a
  // character count that is not moving.
  thinking: 'Thinking it through',
};

/**
 * The one-line summary shown beside the meter.
 *
 * Built from whichever facts are actually known, rather than a fixed shape
 * with holes in it. The character count is live again (#183), but it is
 * still often absent: before the first report, on a provider that streams
 * nothing, and for as long as a reasoning model is thinking rather than
 * writing. Printing "0 characters written" for a run that is working
 * perfectly well would be worse than the frozen line this replaced -- a
 * number both wrong and reassuringly precise -- so an absent count
 * contributes nothing and the clock carries the line on its own.
 */
export function describeProgress(progress: GenerationProgress): string {
  const parts: string[] = [];
  if (progress.stage) parts.push(STAGE_WORDS[progress.stage]);
  if (typeof progress.characters === 'number' && progress.characters > 0) {
    parts.push(`${formatCharacters(progress.characters)} characters written`);
  }
  parts.push(formatElapsed(progress.elapsedMs));
  return parts.join(' · ');
}

/**
 * Says why the wait is long, but only once it is long. Showing this from the
 * first second would train people to ignore it.
 */
export function reassurance(progress: GenerationProgress): string | null {
  if (progress.elapsedMs < REASSURE_AFTER_MS) return null;
  if (progress.stage === 'queued') {
    // A different worry from a slow run, and a different answer. Saying
    // "building takes several minutes" while nothing has started yet would
    // explain the wrong thing.
    return 'Your project is queued behind other builds. It will start shortly, and you can cancel at any time.';
  }
  if (progress.stage === 'thinking') {
    // A different worry again, and the one most likely to read as a hang:
    // nothing is being written, so nothing on screen is counting up. Saying
    // that a project is being built would explain the wrong thing, and
    // saying it takes several minutes without saying why would leave the
    // stillness unexplained.
    return 'The model is working the design out before it writes any code. Nothing is stuck, and you can cancel at any time.';
  }
  if (progress.stage === undefined) {
    // No stage means the Workflow is in a state the Worker has no honest
    // word for (`run-stage.ts`). Removing the stage word and then
    // explaining the wait in terms of the work being done would put the
    // same claim back a line lower (#188 review). All that is known here is
    // that the run has not finished, so that is all this says.
    return `${STILL_GOING}. It can take several minutes, and you can cancel at any time.`;
  }
  return 'Building a whole project takes several minutes. You can cancel at any time.';
}

/** How each stage opens the spoken announcement. */
const STAGE_ANNOUNCEMENTS: Record<GenerationStage, string> = {
  queued: 'Still waiting for a slot',
  running: 'Still building your project',
  thinking: 'Still thinking it through',
};

/**
 * Text for the polite live region, or null before the first boundary.
 *
 * Stage-aware, like the visible line and for the same reason (#188 review).
 * This said "Still generating" whatever the run was doing, so somebody
 * using a screen reader heard a claim that the run was under way while it
 * sat in a queue, and heard it again for a state the Worker had
 * deliberately declined to name. A meter that is careful on screen and
 * careless out loud is not careful.
 *
 * Bucketed to `ANNOUNCE_INTERVAL_MS` so the string is stable between
 * announcements -- see the constant. A change of stage does change the
 * string mid-bucket, which is the one interruption worth making: it is
 * news, not a counter ticking.
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
  const lead = progress.stage
    ? STAGE_ANNOUNCEMENTS[progress.stage]
    : STILL_GOING;
  return `${lead}, ${formatElapsed(buckets * ANNOUNCE_INTERVAL_MS)} elapsed.`;
}
