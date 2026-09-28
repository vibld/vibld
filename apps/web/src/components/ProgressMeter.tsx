import type { GenerationProgress } from '../generation/session.ts';
import {
  describeProgress,
  progressAnnouncement,
  reassurance,
} from '../generation/progress.ts';

/**
 * Evidence that a long run is still running.
 *
 * There is no total to divide by -- the model does not say how long a plan
 * will be -- so this deliberately does not fake a percentage. It shows the
 * two things that are true and moving: characters written and time elapsed.
 */
export function ProgressMeter({
  progress,
  announce = true,
}: {
  progress: GenerationProgress | null;
  /**
   * Whether this copy speaks to a screen reader. The draft preview shows a
   * second meter over its sketch while the conversation shows the first,
   * and two live regions saying the same thing would say it twice.
   */
  announce?: boolean;
}) {
  if (progress === null) return null;
  const note = reassurance(progress);
  const announcement = progressAnnouncement(progress);

  return (
    <div className="progress">
      <div className="progress__track" aria-hidden="true">
        <span className="progress__bar" />
      </div>
      {/* The counters change several times a second; announcing each change
          would flood a screen reader, so they are hidden from it and the
          coarse announcement below carries the same news. */}
      <p className="progress__line" aria-hidden="true">
        {describeProgress(progress)}
      </p>
      {/* Unlike the counters this appears once and never changes, so it is
          left readable: it is the part that answers "is this stuck?". */}
      {note ? <p className="progress__note">{note}</p> : null}
      {announce ? (
        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement ?? ''}
        </p>
      ) : null}
    </div>
  );
}
