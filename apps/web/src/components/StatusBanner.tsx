import type { BuilderState, BuilderStatus } from '../generation/session.ts';

const MESSAGES: Record<BuilderStatus, string> = {
  idle: 'Describe the application you want and Vibld will plan, stage and validate it.',
  planning: 'Planning the change…',
  staging: 'Staging generated files…',
  validating: 'Validating the staged project…',
  accepted: 'Checkpoint accepted.',
  failed: 'This run failed. Your last accepted checkpoint is unchanged.',
  cancelled: 'Run cancelled. Your last accepted checkpoint is unchanged.',
};

export function StatusBanner({ state }: { state: BuilderState }) {
  // A cancellation is a choice the user made, not a fault: it reads as
  // neutral rather than as an error they have to interpret.
  const tone =
    state.status === 'failed'
      ? 'error'
      : state.status === 'accepted'
        ? 'success'
        : 'info';
  const revision = state.acceptedSnapshot?.revision;

  return (
    <div className={`banner banner--${tone}`} role="status" aria-live="polite">
      <p className="banner__message">{MESSAGES[state.status]}</p>
      {state.status === 'accepted' && revision ? (
        <p className="banner__detail">
          Revision <code>{revision}</code> ·{' '}
          {state.acceptedSnapshot?.files.length} files
        </p>
      ) : null}
      {state.status === 'failed' && state.problems.length > 0 ? (
        <p className="banner__detail">{state.problems[0]}</p>
      ) : null}
    </div>
  );
}
