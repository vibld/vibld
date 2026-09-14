import type { GitHubStatus } from './github-client.ts';
import type { PushConflict, PushedSnapshot } from './github-client.ts';

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
   * Apart from `problem` precisely because it records no destination. Every
   * other phase belongs to the place it was aimed at and is withheld once
   * that is no longer the place on screen; this one is about the aim having
   * been wrong, so it belongs to whatever the connection turns out to be.
   * Folded into `problem` it would be hidden by the very refresh it causes,
   * and somebody would have clicked Push, had nothing pushed, and been told
   * nothing at all.
   */
  | { at: 'moved'; error: string }
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
    };

const HIDDEN: PushView = { show: false };

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
    phase.at === 'moved' ||
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

  if (phase.at === 'done') {
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
