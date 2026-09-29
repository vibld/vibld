import { LIFECYCLE_ORDER, lifecycleStatus } from '../generation/run-phase.ts';
import type { RunPhase } from '../generation/run-phase.ts';
import type { BuilderStatus } from '../generation/session.ts';

const STEPS: { status: BuilderStatus; label: string }[] = [
  { status: 'planning', label: 'Plan' },
  { status: 'staging', label: 'Write' },
  { status: 'validating', label: 'Check' },
  { status: 'accepted', label: 'Done' },
];

function stepState(
  step: BuilderStatus,
  status: BuilderStatus,
): 'done' | 'active' | 'todo' {
  // Neither a failure nor a cancellation leaves the lifecycle part-finished:
  // no checkpoint was produced, so no step claims to be complete.
  if (status === 'failed' || status === 'cancelled') return 'todo';
  // 'accepted' is terminal: every step of the lifecycle is complete.
  if (status === 'accepted') return 'done';
  const current = LIFECYCLE_ORDER.indexOf(status);
  const index = LIFECYCLE_ORDER.indexOf(step);
  if (current > index) return 'done';
  if (current === index) return 'active';
  return 'todo';
}

/**
 * `phase` is where the Worker says a build has got to (`run-phase.ts`): the
 * builder's own status stays `planning` until the Workflow is done, so
 * without it the bar says "Plan" while the files are being written.
 */
export function LifecycleBar({
  status: own,
  phase,
}: {
  status: BuilderStatus;
  phase?: RunPhase | undefined;
}) {
  const status = lifecycleStatus(own, phase);
  return (
    <ol className="lifecycle" aria-label="Generation lifecycle">
      {STEPS.map((step) => {
        const state = stepState(step.status, status);
        return (
          <li
            key={step.status}
            className={`lifecycle__step lifecycle__step--${state}`}
          >
            <span className="lifecycle__dot" aria-hidden="true" />
            <span className="lifecycle__label">{step.label}</span>
            {state === 'active' ? (
              <span className="visually-hidden"> (in progress)</span>
            ) : null}
            {state === 'done' ? (
              <span className="visually-hidden"> (complete)</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
