/**
 * The check a build's code goes through after it is shown (D69, "show
 * early, badge it").
 *
 * A build's revision is promoted as soon as its files are put together,
 * and only then built in a clean container and held to its own spec
 * (`verifyAndRepair` in `worker/generation-run.ts`), with one repair when
 * that finds a problem. That used to happen before the builder saw
 * anything, which added 40 to 90 seconds to every build and 100 to 250
 * when a repair ran. Now the builder shows the promoted revision straight
 * away with a badge saying it is being checked, and the badge goes when
 * the check passes, says so when a repair is running, and stays, saying so
 * plainly, when the code the build ended at does not build.
 *
 * Framework-free, and it imports nothing, so the Worker names a verdict
 * with the same list the builder reads it with (as `run-phase.ts` does for
 * phases).
 */

/** What a build's check found, once the build has ended. */
export type CheckVerdict = 'passed' | 'failed' | 'unchecked';

const VERDICTS: ReadonlySet<string> = new Set<CheckVerdict>([
  'passed',
  'failed',
  'unchecked',
]);

export function isCheckVerdict(value: unknown): value is CheckVerdict {
  return typeof value === 'string' && VERDICTS.has(value);
}

/**
 * What the builder says about the revision on screen:
 *
 *   checking    shown before its check has finished
 *   repairing   the check found a problem, and a repair is being made
 *   failed      the build ended, and this revision does not build
 *   unchecked   the build ended, and nothing could say whether it builds
 *
 * A revision that passed has nothing said about it: the badge goes.
 */
export type BuildCheckState = 'checking' | 'repairing' | 'failed' | 'unchecked';

export interface BuildCheck {
  state: BuildCheckState;
  /** The revision this is about. */
  revision: string;
}

/**
 * What an ended build leaves on screen: nothing for one that passed, and
 * the verdict otherwise.
 */
export function checkAfter(
  verdict: CheckVerdict | undefined,
  revision: string | null | undefined,
): BuildCheck | null {
  if (!verdict || verdict === 'passed' || !revision) return null;
  return { state: verdict, revision };
}

/**
 * The line an accepted turn carries when its code did not pass, so the
 * conversation says so after the badge has gone and after a reload.
 */
export const CHECK_FAILED =
  'The build check failed: this version does not build. It is still your current version, so you can ask for a fix.';

export const CHECK_UNFINISHED =
  'The build check did not finish, so this version has not been checked.';

/**
 * Said after a failed check when the build ran on a model on the copy's own
 * machine (D124), the same advice @vibld/ai's `LOCAL_MODEL_ADVICE` gives
 * when such a model cannot finish at all. A small local model writes code
 * that does not build far more often than a hosted one, and asking it for
 * a fix is rarely what helps.
 */
export const LOCAL_CHECK_ADVICE =
  'It was written by a model running on this copy’s own machine, and a larger model usually writes code that builds. README.md, "Local models", says what to try.';

export function checkProblem(
  verdict: CheckVerdict | undefined,
  /** The model the build ran on, where known. */
  model?: string | null,
): string | undefined {
  if (verdict === 'failed') {
    return model === 'local'
      ? `${CHECK_FAILED} ${LOCAL_CHECK_ADVICE}`
      : CHECK_FAILED;
  }
  if (verdict === 'unchecked') return CHECK_UNFINISHED;
  return undefined;
}

/** The badge's words: a short label and one sentence under it. */
export function checkWords(check: BuildCheck): {
  label: string;
  detail: string;
} {
  switch (check.state) {
    case 'checking':
      return {
        label: 'Checking the build',
        detail:
          'This is the new version. vibld is building it to make sure it works, and it may still change.',
      };
    case 'repairing':
      return {
        label: 'Fixing a problem',
        detail:
          'The check found a problem with this version. vibld is fixing it, and the fixed version will replace this one.',
      };
    case 'failed':
      return { label: 'Does not build', detail: CHECK_FAILED };
    case 'unchecked':
      return { label: 'Not checked', detail: CHECK_UNFINISHED };
  }
}
