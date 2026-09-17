import type { GitHubStatus } from './github-client.ts';
import type {
  PushConflict,
  PushPreview,
  PushedSnapshot,
} from './github-client.ts';

/**
 * Whether to offer a push, and what to say about one that happened.
 *
 * Separate from the button that draws it, for the reason four findings on
 * #122 established: the test runner strips TypeScript types and errors on
 * JSX, so a decision written inside a component is typechecked and never
 * run. Every rule here is a decision rather than a rendering choice.
 */

/** Somewhere a push went, or is going. */
export interface Destination {
  owner: string;
  repo: string;
}

/**
 * Every phase but idle records where it was aimed.
 *
 * The connection can change under a push: another builder binds a different
 * repository, or the panel in the header rebinds while a request is in the
 * air. The button's destination follows the connection, and a result kept
 * from before it moved would be drawn beside the new name -- a pull request
 * link into the repository it did go to, under a button offering to push
 * somewhere else.
 *
 * Recorded here rather than only guarded in the component, because a
 * component is where this feature's races have twice been found by reading
 * rather than by the suite: the runner errors on JSX. Where the push went is
 * a fact the caller has in hand at the moment it sends it, and carrying it
 * makes "never describe a push as going somewhere it did not" a rule with a
 * test rather than a sequence somebody has to trace.
 */
export type PushPhase =
  | { at: 'idle' }
  /**
   * The push was refused because this browser's idea of the destination had
   * moved on, and nothing was written.
   *
   * Apart from `problem` because it survives the refresh it causes, where a
   * result of a push does not: folded in, it would be cleared by the very
   * connection change it is reporting, and somebody would have clicked
   * Push, had nothing pushed, and been told nothing at all.
   *
   * Its `to` is not where the push was aimed. It is where the route said
   * the connection points, which is what the sentence beside it names. So
   * it is subject to the same rule as every other phase rather than exempt
   * from it: if the connection has moved again since, this sentence is
   * about neither the destination on screen nor the one that was aimed at,
   * and drawing it would be the thing that rule exists to prevent.
   */
  | { at: 'moved'; to: Destination; error: string }
  | { at: 'pushing'; to: Destination }
  | { at: 'done'; to: Destination; pushed: PushedSnapshot }
  | {
      at: 'problem';
      to: Destination;
      error: string;
      reconnect?: boolean;
      conflict?: PushConflict;
    };

export interface PushOutcome {
  branch: string;
  /**
   * False when the branch was already there carrying this tree.
   *
   * Worth a different sentence rather than a cheerful "pushed". It is what a
   * retry looks like when the first reply was lost, and telling somebody
   * their work was pushed again when nothing moved invites them to go
   * looking for a commit that is not there.
   */
  created: boolean;
  pullRequestUrl?: string;
}

export type PushView =
  | { show: false }
  | {
      show: true;
      /** Where it would go, so the button never pushes somewhere unnamed. */
      destination: Destination;
      busy: boolean;
      problem?: {
        error: string;
        reconnect: boolean;
        /**
         * Kept beside the sentence rather than folded into it, the same way
         * `reconnect` is and for the same reason: it is the one failure the
         * plan promises to report with both shas, and the sentence carries
         * neither.
         */
        conflict?: PushConflict;
      };
      outcome?: PushOutcome;
      /**
       * A pull request from a previous session, and what became of it.
       *
       * Only when this button has nothing of its own to say: a result from
       * the push just made is fresher than anything the status was carrying
       * when it was last read, and two pull request lines under one button
       * is two answers to one question.
       */
      lastPullRequest?: {
        url: string;
        branch: string;
        state: 'open' | 'closed' | 'merged' | null;
      };
    };

const HIDDEN: PushView = { show: false };

/**
 * What is left of a phase once the connection has changed under it.
 *
 * A result belongs to the push that produced it, and the connection moving
 * is exactly the case where showing one again would attribute it to
 * somewhere it did not go. So results are dropped.
 *
 * A refusal that says the destination moved is not a result: it is the
 * explanation for this very change. Dropping it would clear the only thing
 * that tells somebody why the push they asked for did not happen, and it is
 * `decidePush` that decides whether it is still worth drawing, by the same
 * destination rule everything else goes through.
 */
export function afterConnectionChanged(phase: PushPhase): PushPhase {
  return phase.at === 'moved' ? phase : { at: 'idle' };
}

export function decidePush(
  phase: PushPhase,
  status: GitHubStatus | null,
): PushView {
  // No destination, nothing to offer. Unlike the connect panel's retry,
  // there is no useful action here without a repository to name: a push
  // button with nowhere to push is not a route out of anything.
  if (!status?.configured || status.connected !== true) return HIDDEN;
  if (!status.owner || !status.repo) return HIDDEN;

  // `!== false`, the same rule the connect retry uses. A deployment that has
  // said outright it cannot push gets no button, because the answer is a 503
  // and the panel already explains it. A status that simply did not say is
  // not that, and withholding the button there would hide the feature over a
  // missing field.
  if (status.canPush === false) return HIDDEN;

  const destination: Destination = { owner: status.owner, repo: status.repo };

  // Anything said about a push is said about this destination or not at all.
  // A push still in flight to somewhere else is not this button's push
  // either: it is not what a click here would start, and leaving the button
  // disabled on its account would withhold a push nothing is doing.
  const here =
    phase.at === 'idle' ||
    (phase.to.owner === destination.owner &&
      phase.to.repo === destination.repo);

  const view: PushView = {
    show: true,
    destination,
    busy: here && phase.at === 'pushing',
  };

  if (!here) return view;

  // No `reconnect`: the connection is not the thing that is wrong.
  if (phase.at === 'moved')
    view.problem = { error: phase.error, reconnect: false };

  if (phase.at === 'problem') {
    view.problem = {
      error: phase.error,
      reconnect: phase.reconnect === true,
      ...(phase.conflict ? { conflict: phase.conflict } : {}),
    };
  }

  // Before the outcome, so the outcome can take its place.
  if (status.pullRequest) view.lastPullRequest = status.pullRequest;

  if (phase.at === 'done') {
    delete view.lastPullRequest;
    view.outcome = {
      branch: phase.pushed.branch,
      created: phase.pushed.created,
      ...(phase.pushed.pullRequestUrl
        ? { pullRequestUrl: phase.pushed.pullRequestUrl }
        : {}),
    };
  }

  return view;
}

/**
 * Whether the push preview on screen is still about what the button would do.
 *
 * Its own decision rather than a field on `PushView`, because it answers a
 * question the push phase does not: a preview describes a destination *and*
 * a set of files, and either can move out from under it. The destination
 * rule is the one this file already applies everywhere. The revision rule is
 * the same failure wearing different clothes: a diff computed for the
 * checkpoint before last, drawn beside a button that would push the current
 * one, is a list of deletions about files that are no longer the ones going.
 *
 * Both are dropped rather than redrawn with a caveat. A stale preview of an
 * irreversible action is worse than none: somebody reads "removes nothing"
 * and presses a button that removes four files.
 */
export type PreviewPhase =
  | { at: 'none' }
  | { at: 'loading'; to: Destination; revision: string }
  | {
      at: 'ready';
      to: Destination;
      revision: string;
      preview: PushPreview;
    }
  | { at: 'problem'; to: Destination; revision: string; error: string };

export type PreviewView =
  | { show: false }
  | {
      show: true;
      busy: boolean;
      preview?: PushPreview;
      error?: string;
    };

export function decidePreview(
  phase: PreviewPhase,
  destination: Destination | null,
  revision: string | null,
): PreviewView {
  if (phase.at === 'none' || !destination || !revision) return { show: false };

  const sameDestination =
    phase.to.owner === destination.owner && phase.to.repo === destination.repo;
  if (!sameDestination || phase.revision !== revision) return { show: false };

  if (phase.at === 'loading') return { show: true, busy: true };
  if (phase.at === 'problem') {
    return { show: true, busy: false, error: phase.error };
  }
  return { show: true, busy: false, preview: phase.preview };
}

/**
 * What a preview says, in one line, when there is nothing to list.
 *
 * "Nothing to change" is a real and useful answer: it means the branch would
 * carry exactly what the repository already has, and a push would be a
 * no-op. Saying it is better than drawing three empty lists.
 */
export function previewIsEmpty(preview: PushPreview): boolean {
  return (
    preview.added.length === 0 &&
    preview.changed.length === 0 &&
    preview.removed.length === 0
  );
}
