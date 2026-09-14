import type { ConnectOffer, GitHubStatus } from './github-client.ts';

/**
 * What the GitHub panel shows, decided apart from how it is drawn.
 *
 * Four findings on this feature were in `GitHubPanel.tsx` and none of them
 * could be caught by the suite: the runner strips TypeScript types and errors
 * on JSX, so a component is typechecked and never exercised. Every one of the
 * four was a decision rather than a rendering problem, so the decisions live
 * here, where they can be run, and the panel is left with nothing to decide.
 */

export type PanelPhase =
  | { at: 'loading' }
  | { at: 'idle' }
  | { at: 'working'; note: string }
  | { at: 'choosing'; offer: ConnectOffer }
  | { at: 'problem'; error: string; install?: boolean };

export interface PanelProblem {
  error: string;
  install: boolean;
  retry: boolean;
}

/**
 * Whether pushing works, kept at three values rather than two.
 *
 * Two states is what the earlier bug was made of. A bind whose status probe
 * and post-bind refresh both failed is shown from the write's own reply,
 * which says what was bound and nothing about the deployment, and reading
 * that silence as `false` printed "Pushing is not configured on this
 * deployment" on a deployment that pushes fine. Only one of the three says
 * anything worth printing, so all three have to survive to here.
 */
export type Pushing = 'yes' | 'no' | 'unknown';

export type PanelSummary =
  | {
      connected: true;
      owner?: string;
      repo?: string;
      defaultBranch?: string;
      pushing: Pushing;
    }
  | { connected: false; canConnect: boolean };

export type PanelView =
  | { show: false }
  | {
      show: true;
      working?: string;
      problem?: PanelProblem;
      picker?: ConnectOffer;
      summary?: PanelSummary;
    };

const HIDDEN: PanelView = { show: false };

/**
 * What a successful exchange that found nothing says.
 *
 * Here rather than in the JSX because it comes with an action: the signed
 * ticket lists no repositories and cannot acquire one, so granting access on
 * GitHub and then connecting again is the only route forward, and a message
 * without that route is a dead end.
 */
export const NOTHING_PUSHABLE =
  'None of the repositories Vibld can reach are ones you can push to. ' +
  'Check the app’s repository access on GitHub, then connect again.';

export function decidePanel(
  phase: PanelPhase,
  status: GitHubStatus | null,
): PanelView {
  if (phase.at === 'loading') return HIDDEN;

  // A connection in flight outranks the status probe. `/api/github/status` is
  // only how the panel decides what to offer; it is not what makes the panel
  // meaningful. If it failed transiently while the exchange succeeded, hiding
  // everything strands somebody whose code and state are already spent,
  // holding a ticket they cannot see and cannot use before it expires.
  const busy =
    phase.at === 'working' || phase.at === 'problem' || phase.at === 'choosing';

  // An offer with nothing in it is not a choice. Treating it as one left the
  // alert standing alone: the picker draws no buttons, and the summary that
  // carries the Connect button is suppressed while choosing, so the only way
  // on was a page reload somebody had to think of. The ticket is signed and
  // empty, so it cannot pick up access granted afterwards either. It is a
  // failure with a remedy, and it is shaped like one here.
  const choosing =
    phase.at === 'choosing' && phase.offer.repositories.length > 0;

  // Otherwise: nothing to offer on a deployment without GitHub configured,
  // the same silence `BillingStatusWidget` keeps when billing is not.
  if (!busy && !status?.configured) return HIDDEN;

  const view: PanelView = { show: true };

  if (phase.at === 'working') view.working = phase.note;

  if (phase.at === 'choosing' && !choosing) {
    view.problem = {
      error: NOTHING_PUSHABLE,
      // The remedy is on GitHub, so the link to it belongs here.
      install: true,
      retry: status?.canConnect !== false,
    };
  }

  if (phase.at === 'problem') {
    view.problem = {
      error: phase.error,
      install: phase.install === true,
      // Offered without waiting on a status. By the time a completion has
      // failed the code is spent, so "try again" means starting a fresh
      // authorization, and gating that on a status request that may itself
      // have failed leaves a page reload as the only route out. Withheld only
      // when the deployment has said outright that it cannot connect.
      retry: status?.canConnect !== false,
    };
  }

  if (choosing && phase.at === 'choosing') view.picker = phase.offer;

  // Beside a failure, so a failed disconnect still shows what is connected,
  // but not beside a choice or a step in progress, which are about to replace
  // whatever it would say.
  if (status?.configured && !choosing && phase.at !== 'working') {
    view.summary = status.connected
      ? {
          connected: true,
          // `canPush` rather than `connected` alone. A deployment with the
          // OAuth half and no App key lets a repository be connected and
          // answers every push with a 503, so saying "pushing to" it would be
          // describing something that cannot happen. Silence is its own
          // answer and is kept as one.
          pushing:
            status.canPush === undefined
              ? 'unknown'
              : status.canPush
                ? 'yes'
                : 'no',
          ...(status.owner === undefined ? {} : { owner: status.owner }),
          ...(status.repo === undefined ? {} : { repo: status.repo }),
          ...(status.defaultBranch === undefined
            ? {}
            : { defaultBranch: status.defaultBranch }),
        }
      : {
          connected: false,
          // Unknown goes the other way here than it does for pushing. An
          // offered button that turns out not to work answers with the
          // reason; a withheld one leaves no route anywhere. The same rule
          // the retry above uses, for the same reason.
          canConnect: status.canConnect !== false,
        };
  }

  return view;
}

/**
 * Which answer about the connection is allowed to win.
 *
 * The status probe starts alongside the callback exchange rather than in
 * front of it, which is what stops a slow probe throwing away a good
 * callback. The cost of that is a probe still in flight when a repository is
 * bound: it lands afterwards carrying what it read before the write, and an
 * unconditional update then replaces a confirmed repository with
 * `connected: false`, making a write that landed look like one that never
 * happened.

 * So a write supersedes every read started before it, and a read may only
 * commit if nothing has been written since it began. Counted rather than
 * flagged, because the first write's own refresh has to be allowed through
 * while a second write still overtakes it.
 */
export interface StatusGate {
  /** A write landed: every read already in flight is now out of date. */
  supersede(): void;
  /** Begin a read, and get back whether its result may still be committed. */
  begin(): () => boolean;
}

export function createStatusGate(): StatusGate {
  let generation = 0;
  return {
    supersede() {
      generation += 1;
    },
    begin() {
      const at = generation;
      return () => at === generation;
    },
  };
}
