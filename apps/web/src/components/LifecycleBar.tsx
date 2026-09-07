import type { BuilderStatus } from '../generation/session.ts';

const STEPS: { status: BuilderStatus; label: string }[] = [
  { status: 'planning', label: 'Plan' },
  { status: 'staging', label: 'Stage' },
  { status: 'validating', label: 'Validate' },
  { status: 'accepted', label: 'Accept' },
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
  if (status === 'failed') return 'todo';
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
