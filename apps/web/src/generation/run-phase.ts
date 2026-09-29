import type { BuilderStatus } from './session.ts';

/**
 * Which part of its work a build on the Worker is doing, as the Workflow
 * itself reports it (`worker/run-progress.ts`):
 *
 *   outline      the model is planning the project: the spec and the files
 *   writing      the model is writing a group of files
 *   assembling   the files are put together, checked, staged and promoted
 *   validating   the project is built, to see that it builds
 *   repairing    a repair turn is being asked for and built
 *
 * The builder's own status says `planning` for all of it, because the page
 * only learns the plan when the Workflow is done with every step, so the
 * lifecycle bar said "Plan" while files were being written. This is what
 * it goes by instead, where the Worker says. The code itself arrives
 * earlier now, once it is promoted and while `validating` and `repairing`
 * check it (D69, `build-check.ts`), but the run is not over until they
 * are, and the bar stays on "Check" until then.
 *
 * Framework-free, and it imports nothing but a type, so the Worker checks a
 * phase with the same list the builder reads it with.
 */
export type RunPhase =
  'outline' | 'writing' | 'assembling' | 'validating' | 'repairing';

const PHASES: ReadonlySet<string> = new Set<RunPhase>([
  'outline',
  'writing',
  'assembling',
  'validating',
  'repairing',
]);

export function isRunPhase(value: unknown): value is RunPhase {
  return typeof value === 'string' && PHASES.has(value);
}

/** The lifecycle bar's step each phase belongs to. */
const PHASE_STATUS: Record<RunPhase, BuilderStatus> = {
  outline: 'planning',
  writing: 'staging',
  assembling: 'validating',
  validating: 'validating',
  repairing: 'validating',
};

/** The lifecycle bar's steps, in the order a run goes through them. */
export const LIFECYCLE_ORDER: readonly BuilderStatus[] = [
  'idle',
  'planning',
  'staging',
  'validating',
  'accepted',
];

/**
 * The status the lifecycle bar shows: the builder's own, moved on to where
 * the Worker says the build has got to.
 *
 * Only ever forward, and only while a run is in its middle steps. The
 * builder goes through staging and validating again, quickly and on its
 * own copy, once the Workflow's result arrives, and a bar that went back
 * from "Check" to "Write" for that moment would be telling somebody the
 * build had gone backwards. A run that has ended, however it ended, shows
 * the builder's own status.
 */
export function lifecycleStatus(
  status: BuilderStatus,
  phase?: RunPhase,
): BuilderStatus {
  if (!phase) return status;
  if (
    status !== 'planning' &&
    status !== 'staging' &&
    status !== 'validating'
  ) {
    return status;
  }
  const reported = PHASE_STATUS[phase];
  return LIFECYCLE_ORDER.indexOf(reported) > LIFECYCLE_ORDER.indexOf(status)
    ? reported
    : status;
}
