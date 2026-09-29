import { Show } from '@clerk/react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  claimHandoff,
  completeClaimedConnect,
  holdHandoff,
} from '../github/github-client.ts';
import type {
  ConnectOffer,
  RepositoryChoice,
} from '../github/github-client.ts';
import { decidePanel } from '../github/panel-view.ts';
import type { PanelPhase } from '../github/panel-view.ts';
import { githubStatus } from '../github/github-status.ts';
import { connectFlow } from '../github/connect-flow.ts';
import type { ConnectFlowState } from '../github/connect-flow.ts';
import {
  chooseRepository,
  disconnectEverything,
  disconnectProject,
  receiveCompletion,
  startConnect,
  startInstall,
} from '../github/connect-actions.ts';
import { repositoryNameFor } from '../github/repo-name.ts';
import { useProjectStatus } from '../github/use-project-status.ts';
import { clerkConfigured } from '../auth/clerk-token.ts';

/**
 * Connecting a repository, and the receiving half of the callback handoff
 * (internal issues 13 and 121).
 *
 * The worker's `/api/github/callback` cannot be authenticated, because
 * GitHub returns through a top-level navigation that carries no bearer
 * token. It therefore does no work: it puts the code and state in the
 * fragment and redirects here, and this panel completes the exchange with a
 * request that can be authenticated. Without this half the flow has no
 * receiver at all.
 *
 * `github-client.ts` holds the part of that with teeth: the browser
 * remembers the state it was issued and refuses one it was not, which is
 * what stops a crafted link completing somebody else's authorization inside
 * this session.
 *
 * Per project since D72: the panel is about the open project's repository,
 * with the account's own connection named beside it. What the controls do
 * lives in `connect-actions.ts`, shared with the Ship menu, which offers the
 * same "create or pick" on a project's first push.
 *
 * Mounted inside `Show when="signed-in"` like `BillingStatusWidget`, so a
 * fresh mount is always a fresh fetch and there is no sign-in re-fetch to
 * keep in step.
 */
export function GitHubPanel({
  projectId = null,
  projectName = '',
}: {
  projectId?: string | null;
  projectName?: string;
}) {
  if (!clerkConfigured) return null;
  return (
    <Show when="signed-in">
      <GitHubConnection projectId={projectId} projectName={projectName} />
    </Show>
  );
}

/**
 * The signed-in half, exported so it can be mounted on its own.
 *
 * `GitHubPanel` is a Clerk gate and nothing else. Reaching what is below it
 * through `Show` would mean standing up a provider and a session to test a
 * status fetch, so a test mounts this directly and the gate above stays
 * what it looks like: two lines with nothing in them to get wrong.
 */
export function GitHubConnection({
  projectId = null,
  projectName = '',
}: {
  projectId?: string | null;
  projectName?: string;
}) {
  useProjectStatus(projectId);
  // Read inside the effect below, which runs once per mount: a completion
  // that arrives after the open project changed still needs somewhere to
  // go when the browser did not remember which project it was for.
  const openProject = useRef(projectId);
  openProject.current = projectId;

  // Finishing a return from GitHub, if that is what this page load is.
  useEffect(() => {
    let cancelled = false;

    // Held for the life of this mount, and let go when it ends. The claim
    // below is a module-level cache, so without this it outlives the panel:
    // signing out unmounts, signing in mounts again with no page load
    // between, and the next person is handed the previous one's handoff and
    // their completed offer. Releasing is deferred inside `holdHandoff`, so
    // the StrictMode replay below still finds it.
    const release = holdHandoff();

    // Claimed rather than read: StrictMode runs this effect twice in
    // development, and a plain read would have the first pass clear the
    // fragment and the replay find nothing. The claim also takes it off the
    // URL, because a single-use code in the address bar invites a reload
    // that can only fail.
    const handoff = claimHandoff(globalThis.location?.hash ?? '');

    // Started before anything is awaited, and deliberately not after the
    // status probe. The fragment is claimed and cleared by now and the signed
    // state expires in ten minutes, so letting a slow or hanging
    // `/api/github/status` sit in front of the exchange means a perfectly
    // good callback can be thrown away by a request that has nothing to do
    // with it. Shared between both StrictMode passes: completing twice would
    // spend the stored state on the first and fail the second's own check.
    const completing = handoff ? completeClaimedConnect(handoff) : null;
    if (handoff) {
      connectFlow.set({
        phase: { at: 'working', note: 'Finishing the GitHub connection…' },
        projectId: openProject.current,
      });
    } else if (connectFlow.read().phase.at === 'loading') {
      connectFlow.set({ phase: { at: 'idle' }, projectId: null });
    }

    void (async () => {
      if (!completing) return;
      const finished = await completing;
      if (cancelled) return;
      await receiveCompletion(finished, openProject.current, () => cancelled);
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, []);

  return (
    <section className="github-panel">
      <h3>GitHub</h3>
      <ProjectRepository
        projectId={projectId}
        projectName={projectName}
        from="settings"
        showAccount
      />
    </section>
  );
}

/**
 * The flow's phase, as it applies to this project.
 *
 * A picker or a failure belongs to the project the trip was for. Shown
 * under another project's name it would bind that project's repository to
 * this one at a click, so another project's flow reads as idle here.
 */
function phaseFor(
  flow: ConnectFlowState,
  projectId: string | null,
  loadingIsIdle: boolean,
): PanelPhase {
  if (flow.projectId !== null && flow.projectId !== projectId) {
    return { at: 'idle' };
  }
  if (loadingIsIdle && flow.phase.at === 'loading') return { at: 'idle' };
  return flow.phase;
}

/**
 * One project's repository: what it pushes to, or how to give it one.
 *
 * Drawn in the settings panel and in the Ship menu, from the same shared
 * state, so the two cannot disagree. `showSummary` is off in the Ship menu,
 * where the push button beside it already names the repository.
 */
export function ProjectRepository({
  projectId,
  projectName,
  from,
  showAccount = false,
  showSummary = true,
}: {
  projectId: string | null;
  projectName: string;
  from: 'ship' | 'settings';
  showAccount?: boolean;
  showSummary?: boolean;
}) {
  const status = useSyncExternalStore(
    githubStatus.subscribe,
    githubStatus.read,
  );
  const flow = useSyncExternalStore(connectFlow.subscribe, connectFlow.read);
  // Only the settings panel waits for the handoff check before drawing;
  // it is the one that runs it. The Ship menu has nothing to wait for.
  const phase = phaseFor(flow, projectId, from === 'ship');
  const target = flow.projectId ?? projectId;

  // Every decision about what appears lives in `decidePanel`, which is a
  // plain function with tests. Below this line nothing reads `phase` or
  // `status`, only the view.
  const view = decidePanel(phase, status);
  if (!view.show) return null;
  // Held in consts so the callbacks below close over definite values rather
  // than fields TypeScript can no longer prove are there when they run.
  const summaryDisconnect =
    view.summary?.connected === true ? view.summary.disconnect : undefined;
  const picker = view.picker;

  return (
    <div className="github-project">
      {view.working && <p role="status">{view.working}</p>}

      {view.problem && (
        <>
          <p role="alert" className="github-panel__problem">
            {view.problem.error}
            {view.problem.install && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => void startInstall({ projectId, from })}
                >
                  Install the vibld app
                </button>
              </>
            )}
          </p>
          {view.problem.retry && (
            <p>
              <button
                type="button"
                onClick={() => void startConnect({ projectId, from })}
              >
                Try connecting again
              </button>
            </p>
          )}
        </>
      )}

      {picker && target && (
        <RepositoryPicker
          offer={picker}
          onChoose={(choice) =>
            void chooseRepository(choice, picker.ticket, target, from)
          }
        />
      )}

      {view.omitted && (
        <p className="github-panel__omitted">
          vibld did not read {view.omitted.length}{' '}
          {view.omitted.length === 1 ? 'account' : 'accounts'}:{' '}
          <strong>{view.omitted.join(', ')}</strong>. To connect a repository on
          one of those,{' '}
          <button
            type="button"
            onClick={() => void startInstall({ projectId, from })}
          >
            install the vibld app on that account
          </button>
          .
        </p>
      )}

      {view.truncated && (
        <p className="github-panel__truncated">
          GitHub has more accounts or repositories than vibld reads in one go,
          so this list may be short. Installing again does not help here: the
          same limit applies on the next read.
        </p>
      )}

      {showSummary && view.summary?.connected === true && (
        <p>
          {view.summary.pushing === 'yes' ? 'Pushing to ' : 'Connected to '}
          <strong>
            {view.summary.owner}/{view.summary.repo}
          </strong>{' '}
          on <code>{view.summary.defaultBranch}</code>.
          {view.summary.pushing === 'no' &&
            ' Pushing is not configured on this deployment.'}{' '}
          {summaryDisconnect && projectId && (
            <button
              type="button"
              title="Stop this project pushing there. Other projects keep their repositories."
              onClick={() =>
                void disconnectProject(
                  { projectId, ...summaryDisconnect },
                  from,
                )
              }
            >
              Disconnect
            </button>
          )}
        </p>
      )}

      {view.summary?.connected === false &&
        view.chooser === undefined &&
        (view.summary.canConnect ? null : (
          // Said rather than shown as a button that cannot work: pushing
          // and connecting are configured separately.
          <p>
            No repository connected.{' '}
            <span>Connecting is not configured on this deployment.</span>
          </p>
        ))}

      {view.chooser &&
        (projectId ? (
          <RepositoryChooser
            // Keyed by the suggested name, so a new suggestion replaces what
            // is in the field rather than being ignored by state that was
            // initialised from the last one.
            key={`${projectId}:${view.chooser.name ?? ''}`}
            projectId={projectId}
            projectName={projectName}
            suggested={view.chooser.name}
            from={from}
          />
        ) : (
          <p>Open a project to choose the repository it pushes to.</p>
        ))}

      {showAccount && view.account && (
        <AccountLine login={view.account.login} projectId={projectId} />
      )}
    </div>
  );
}

/**
 * The two ways a project gets a repository (D72): create one, named from
 * the project and private unless unticked, or use one that exists.
 *
 * Both go to GitHub and back, because the user token that can create a
 * repository or list the ones this person may push to exists only during
 * that return. For somebody who has already authorised the App, GitHub
 * sends them straight back.
 */
function RepositoryChooser({
  projectId,
  projectName,
  suggested,
  from,
}: {
  projectId: string;
  projectName: string;
  suggested?: string;
  from: 'ship' | 'settings';
}) {
  const [name, setName] = useState(
    () => suggested ?? repositoryNameFor(projectName),
  );
  const [hidden, setHidden] = useState(true);
  const nameId = useId();
  const privateId = useId();
  const trimmed = name.trim();

  return (
    <fieldset className="github-chooser">
      <legend>This project has no GitHub repository yet.</legend>
      <div className="github-chooser__create">
        <label htmlFor={nameId}>New repository name</label>
        <input
          id={nameId}
          className="github-chooser__name"
          value={name}
          maxLength={100}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor={privateId} className="github-chooser__private">
          <input
            id={privateId}
            type="checkbox"
            checked={hidden}
            onChange={(event) => setHidden(event.target.checked)}
          />{' '}
          Private
        </label>
        <button
          type="button"
          disabled={trimmed.length === 0}
          onClick={() =>
            void startConnect({
              projectId,
              create: { name: trimmed, private: hidden },
              from,
            })
          }
        >
          Create a new repository
        </button>
      </div>
      <p className="github-chooser__existing">
        <button
          type="button"
          onClick={() => void startConnect({ projectId, from })}
        >
          Use an existing repository
        </button>
      </p>
    </fieldset>
  );
}

/**
 * The account's own connection, and the one control that ends all of it.
 *
 * Asked twice. Disconnecting GitHub unbinds every project at once (D72),
 * and each one then goes back to GitHub to choose its repository again, so
 * a single stray click is worth one more.
 */
function AccountLine({
  login,
  projectId,
}: {
  login?: string;
  projectId: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <p className="github-panel__account">
      {login ? (
        <>
          Signed in to GitHub as <strong>{login}</strong>.
        </>
      ) : (
        'Signed in to GitHub.'
      )}{' '}
      {confirming ? (
        <>
          Every project stops pushing, and each chooses its repository again.{' '}
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              void disconnectEverything(projectId, 'settings');
            }}
          >
            Disconnect every project
          </button>{' '}
          <button type="button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Disconnect GitHub
        </button>
      )}
    </p>
  );
}

// Only ever given a non-empty offer: `decidePanel` turns an empty one into a
// problem with a remedy, because an alert with no action is a dead end.
function RepositoryPicker({
  offer,
  onChoose,
}: {
  offer: ConnectOffer;
  onChoose: (choice: RepositoryChoice) => void;
}) {
  return (
    <div>
      <p>Choose a repository to push to:</p>
      <ul className="github-panel__choices">
        {offer.repositories.map((choice) => (
          <li key={`${choice.installationId}:${choice.owner}/${choice.repo}`}>
            <button type="button" onClick={() => onChoose(choice)}>
              {choice.owner}/{choice.repo}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
