import {
  beginConnect,
  beginInstall,
  bindRepository,
  disconnectAccount,
  disconnectRepository,
  noteConnectionChanged,
} from './github-client.ts';
import type {
  CompleteResult,
  ConnectIntent,
  RepositoryChoice,
} from './github-client.ts';
import { connectFlow } from './connect-flow.ts';
import type { ConnectFlowState } from './connect-flow.ts';
import { githubStatus } from './github-status.ts';
import type { PanelPhase } from './panel-view.ts';

/**
 * What the GitHub controls do, apart from how they are drawn (D72).
 *
 * These used to be methods inside the settings panel. The Ship menu offers
 * the same choice on a project's first push, so they are here, where both
 * call the same code and write the same shared state (`connect-flow.ts`),
 * and where a test can run them without mounting either surface.
 *
 * Every write names the project it is for. A repository is per project now,
 * and an action that took "whatever is open" when it finished, rather than
 * the project it was started for, would bind or disconnect the wrong one if
 * the person switched project while it ran.
 */

type From = ConnectFlowState['from'];

/** Where the browser goes; replaced in tests, which have nowhere to go. */
export type Navigate = (url: string) => void;

const assign: Navigate = (url) => globalThis.location.assign(url);

function set(phase: PanelPhase, projectId: string | null, from: From): void {
  connectFlow.set({ phase, projectId, ...(from ? { from } : {}) });
}

/**
 * Go to GitHub to choose or create a repository for a project.
 *
 * With `intent.create`, GitHub is asked to create it when the browser comes
 * back, because the user token that can create one exists only during that
 * return. Without it, the return offers the existing repositories.
 */
export async function startConnect(
  intent: ConnectIntent,
  navigate: Navigate = assign,
): Promise<void> {
  set(
    { at: 'working', note: 'Sending you to GitHub…' },
    intent.projectId,
    intent.from,
  );
  const started = await beginConnect(undefined, undefined, undefined, intent);
  if (!started.ok) {
    set({ at: 'problem', error: started.error }, intent.projectId, intent.from);
    return;
  }
  navigate(started.url);
}

/**
 * Go and install the App, carrying a state that comes back.
 *
 * Not an anchor. A plain link to the installation page returns with an
 * `installation_id` and no `state`, which the callback reports as
 * incomplete and the app discards, so the installation happens and nothing
 * hears about it.
 */
export async function startInstall(
  intent: ConnectIntent,
  navigate: Navigate = assign,
): Promise<void> {
  set(
    { at: 'working', note: 'Sending you to GitHub…' },
    intent.projectId,
    intent.from,
  );
  const started = await beginInstall(undefined, undefined, undefined, intent);
  if (!started.ok) {
    set({ at: 'problem', error: started.error }, intent.projectId, intent.from);
    return;
  }
  navigate(started.url);
}

/** Make the chosen repository this project's. */
export async function chooseRepository(
  choice: RepositoryChoice,
  ticket: string,
  projectId: string,
  from?: From,
): Promise<void> {
  set(
    { at: 'working', note: `Connecting ${choice.owner}/${choice.repo}…` },
    projectId,
    from,
  );
  const bound = await bindRepository(ticket, { ...choice, projectId });
  if (!bound.ok) {
    set({ at: 'problem', error: bound.error }, projectId, from);
    return;
  }
  // Built from the reply rather than from a refresh, and only when the
  // project it was bound to is the one the status describes. The write has
  // already landed, so a status request that fails here must not leave
  // somebody staring at nothing, unable to tell whether their repository
  // connected; and a bind for a project that is no longer open must not
  // paint its repository under the one that is.
  //
  // `amend` supersedes, so a probe started before this write cannot land
  // afterwards and put `connected: false` back. What the reply does not
  // say, it does not say: `canPush` stays undefined when nothing has
  // reported it, and `decidePanel` keeps that as unknown.
  if (githubStatus.project() === projectId) {
    githubStatus.amend((previous) => ({
      configured: true,
      canPush: previous?.canPush,
      canConnect: previous?.canConnect,
      ...(previous?.account ? { account: previous.account } : {}),
      projectId,
      connected: true,
      owner: bound.bound.owner,
      repo: bound.bound.repo,
      defaultBranch: bound.bound.defaultBranch,
      ...(bound.bound.expiresAt ? { expiresAt: bound.bound.expiresAt } : {}),
    }));
  }
  set({ at: 'idle' }, projectId, from);
  await githubStatus.refresh();
}

/** Stop this project pushing to its repository, and no other project. */
export async function disconnectProject(
  to: { projectId: string; owner: string; repo: string },
  from?: From,
): Promise<void> {
  set({ at: 'working', note: 'Disconnecting…' }, to.projectId, from);
  const done = await disconnectRepository(to);
  if (!done.ok) {
    set(
      {
        at: 'problem',
        error: done.error,
        // What the sentence is about, so it stops being drawn once the
        // connection is known to be somewhere else again.
        ...(done.movedTo ? { about: done.movedTo } : {}),
      },
      to.projectId,
      from,
    );
    // The route is the only thing that can tell this browser its idea of
    // the connection is out of date, so a refusal about the destination
    // sends it back to read one. Forgotten before it is read again, and not
    // left to the refresh to replace: `refresh` only commits a status it
    // actually got, so a probe that fails would leave the panel naming the
    // repository the server has just contradicted, still offering to
    // disconnect it.
    if (done.movedTo) {
      githubStatus.forget();
      noteConnectionChanged();
    }
    return;
  }
  // Same rule as binding: the write landed, so say so without depending on
  // a second request succeeding, and supersede any read still in flight so
  // it cannot put the disconnected repository back.
  if (githubStatus.project() === to.projectId) {
    githubStatus.amend((previous) =>
      previous
        ? { ...previous, connected: false, reason: 'revoked' }
        : previous,
    );
  }
  set({ at: 'idle' }, to.projectId, from);
  await githubStatus.refresh();
}

/** Disconnect GitHub from the account, which unbinds every project. */
export async function disconnectEverything(
  projectId: string | null,
  from?: From,
): Promise<void> {
  set({ at: 'working', note: 'Disconnecting GitHub…' }, projectId, from);
  const done = await disconnectAccount();
  if (!done.ok) {
    set({ at: 'problem', error: done.error }, projectId, from);
    return;
  }
  githubStatus.amend((previous) =>
    previous
      ? {
          ...previous,
          account: { connected: false },
          connected: false,
          reason: 'revoked',
        }
      : previous,
  );
  set({ at: 'idle' }, projectId, from);
  await githubStatus.refresh();
}

/**
 * What to do with a finished return from GitHub.
 *
 * A repository that "Create a new repository" made is bound straight away,
 * to the project the trip was for: it was created for that project and for
 * nothing else, and asking the person to pick the thing they just named
 * would be a step with only one answer. Anything else becomes the picker,
 * or the failure, for that project.
 *
 * `fallbackProject` is the open project, used only when this browser did
 * not remember what the trip was for (storage refused, or a return from a
 * build older than this).
 */
export async function receiveCompletion(
  finished: CompleteResult,
  fallbackProject: string | null,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const intent = finished.intent ?? null;
  const projectId = intent?.projectId ?? fallbackProject;
  const from = intent?.from;
  if (cancelled()) return;
  if (!finished.ok) {
    set(
      {
        at: 'problem',
        error: finished.error,
        ...(finished.install ? { install: true } : {}),
      },
      projectId,
      from,
    );
    return;
  }
  const created = finished.offer.created;
  if (created && projectId) {
    await chooseRepository(created, finished.offer.ticket, projectId, from);
    return;
  }
  set({ at: 'choosing', offer: finished.offer }, projectId, from);
}
