import type { BuilderStatus } from '../generation/session.ts';

const STEPS: { status: BuilderStatus; label: string }[] = [
  { status: 'planning', label: 'Plan' },
  { status: 'staging', label: 'Write' },
  { status: 'validating', label: 'Check' },
  { status: 'accepted', label: 'Done' },
];

const ORDER: BuilderStatus[] = [
  'idle',
  'planning',
  'staging',
  'validating',
  'accepted',
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
  const current = ORDER.indexOf(status);
  const index = ORDER.indexOf(step);
  if (current > index) return 'done';
  if (current === index) return 'active';
  return 'todo';
}

export function LifecycleBar({ status }: { status: BuilderStatus }) {
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
