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

export type PanelSummary =
  | {
      connected: true;
      owner?: string;
      repo?: string;
      defaultBranch?: string;
      canPush: boolean;
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

  // Otherwise: nothing to offer on a deployment without GitHub configured,
  // the same silence `BillingStatusWidget` keeps when billing is not.
  if (!busy && !status?.configured) return HIDDEN;

  const view: PanelView = { show: true };

  if (phase.at === 'working') view.working = phase.note;

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

  if (phase.at === 'choosing') view.picker = phase.offer;

  // Beside a failure, so a failed disconnect still shows what is connected,
  // but not beside a choice or a step in progress, which are about to replace
  // whatever it would say.
  if (status?.configured && phase.at !== 'choosing' && phase.at !== 'working') {
    view.summary = status.connected
      ? {
          connected: true,
          // `canPush` rather than `connected` alone. A deployment with the
          // OAuth half and no App key lets a repository be connected and
          // answers every push with a 503, so saying "pushing to" it would be
          // describing something that cannot happen.
          canPush: status.canPush === true,
          ...(status.owner === undefined ? {} : { owner: status.owner }),
          ...(status.repo === undefined ? {} : { repo: status.repo }),
          ...(status.defaultBranch === undefined
            ? {}
            : { defaultBranch: status.defaultBranch }),
        }
      : { connected: false, canConnect: status.canConnect === true };
  }

  return view;
}
