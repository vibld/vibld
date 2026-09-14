import type { GitHubStatus } from './github-client.ts';
import type { PushedSnapshot } from './github-client.ts';

/**
 * Whether to offer a push, and what to say about one that happened.
 *
 * Separate from the button that draws it, for the reason four findings on
 * #122 established: the test runner strips TypeScript types and errors on
 * JSX, so a decision written inside a component is typechecked and never
 * run. Every rule here is a decision rather than a rendering choice.
 */

export type PushPhase =
  | { at: 'idle' }
  | { at: 'pushing' }
  | { at: 'done'; pushed: PushedSnapshot }
  | { at: 'problem'; error: string; reconnect?: boolean };

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
      destination: { owner: string; repo: string };
      busy: boolean;
      problem?: { error: string; reconnect: boolean };
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

  const view: PushView = {
    show: true,
    destination: { owner: status.owner, repo: status.repo },
    busy: phase.at === 'pushing',
  };

  if (phase.at === 'problem') {
    view.problem = { error: phase.error, reconnect: phase.reconnect === true };
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
