import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BuilderSession } from './generation/session.ts';
import type { BuilderState } from './generation/session.ts';
import { loadKnowledge } from './generation/knowledge-store.ts';
import { loadStyleDna } from './generation/style-dna-store.ts';
import {
  chooseModel,
  loadModelChoice,
} from './generation/model-choice-store.ts';
import {
  detectDeploymentConfig,
  resetGenerationModeProbe,
} from './generation/remote-provider.ts';
import type { DeploymentConfig } from './generation/remote-provider.ts';
import { onClerkSessionChange } from './auth/clerk-token.ts';

/** The part of a session this file sets from the deployment probe. */
export interface ConfigurableSession {
  setModels(
    models: DeploymentConfig['models'],
    modelsNote?: DeploymentConfig['modelsNote'],
  ): void;
  setModel(model: string | null): void;
  setIsAdmin(isAdmin: boolean | null): void;
  setGeneration(generation: DeploymentConfig['generation'] | null): void;
}

/**
 * Ask the deployment what it can serve, and settle the session either way.
 *
 * One function rather than the same four lines at both call sites, which is
 * how the two came to differ in the first place, and the reason the bug
 * below could exist in one place and not obviously in the other.
 *
 * A rejected probe still has to settle `isAdmin` (internal PR 188 review). It reads
 * `null` for "nobody has answered yet", and the admin page renders that as
 * a wait. `detectDeploymentConfig` rejects when the endpoint answers 401 or
 * the Clerk token cannot be had, and both call sites used to swallow that,
 * so `null` became permanent and the page checked access forever, offering
 * neither the refusal nor the link back out of it.
 *
 * `false` and not a fourth state: the shell genuinely cannot offer admin
 * tools after a probe it could not complete, and `/api/admin/*` is the
 * authority regardless (ADR-0006). What the page owes the reader is a way
 * onward, which the refusal has and the wait does not.
 *
 * The model list is left alone on rejection. An empty picker is already
 * what "no answer" looks like there, and there is nothing to correct.
 */
export async function applyDeploymentConfig(
  session: ConfigurableSession,
  probe: () => Promise<DeploymentConfig> = () => detectDeploymentConfig(),
  preferred: () => string | null = () => loadModelChoice(),
): Promise<void> {
  try {
    const config = await probe();
    session.setModels(config.models, config.modelsNote);
    // The person's own choice survives a re-probe. This runs again on every
    // Clerk session event, and Clerk sends one each time it refreshes the
    // token, about once a minute: setting the default here unconditionally
    // put the picker back on it every minute, which read as a choice that
    // would not stay.
    //
    // Only where it is still offered, which is also what keeps a Free
    // account (D66) from sending a model its plan no longer includes: its
    // offer is GPT-6 Luna alone, so a stored GPT-6 Sol shows and sends the
    // default, Luna, instead. The stored choice is left as it is, and comes
    // back if the plan does.
    session.setModel(
      chooseModel(preferred(), config.models, config.defaultModel),
    );
    session.setGeneration(config.generation);
    session.setIsAdmin(config.isAdmin);
  } catch {
    // Left null rather than guessed at: an unanswered probe is not
    // evidence of a fake deployment, and the one thing this decides is
    // whether to offer a paid action.
    session.setIsAdmin(false);
  }
}

/**
 * What this tab has chosen, or failing that what this browser remembers.
 *
 * Once a project is open, what this tab has chosen is that project's model:
 * opening one puts its choice into the session (`use-projects.ts`), and a
 * re-probe then keeps it rather than putting the browser's back. The
 * browser's choice is what a project that never chose one, and every new
 * project, starts from.
 */
function currentOrStoredModel(session: BuilderSession): string | null {
  return session.getState().model ?? loadModelChoice();
}

/**
 * Bind a `BuilderSession` to React.
 *
 * `useSyncExternalStore` unsubscribes on unmount, which is what stops the UI
 * from being updated by a run that is still settling; the session's own epoch
 * guard covers reset and repeated submission. The session is deliberately not
 * disposed from an effect cleanup: under StrictMode that cleanup runs on the
 * simulated unmount and would permanently disable the memoized instance.
 * `BuilderSession.dispose()` exists for non-React owners of a session.
 */
export function useBuilderSession(): {
  session: BuilderSession;
  state: BuilderState;
} {
  const session = useMemo(() => {
    const created = new BuilderSession();
    // Standing instructions outlive the tab. Read once, here, rather than in
    // an effect: an effect would render one frame with them missing, and
    // under StrictMode would run twice.
    created.setKnowledge(loadKnowledge());
    created.setStyleDna(loadStyleDna());
    // What this deployment can serve. The picker stays hidden until it
    // answers, which is correct: there is no choice to offer yet, and a
    // failed probe is not worth surfacing here -- the run itself reports it.
    void applyDeploymentConfig(created, undefined, () =>
      currentOrStoredModel(created),
    );
    return created;
  }, []);

  // Sign-in gates the endpoint now (docs/decisions.md L5), and it can happen
  // at any point after the page has already loaded, from the header's modal.
  // Without this, the picker offered nothing signed-out and would keep
  // offering nothing signed-in, until a reload happened to re-run the probe
  // above.
  useEffect(() => {
    // Clerk reports far more than sign-in and sign-out: every token refresh
    // and session touch arrives here too. Only a change of signed-in state
    // is worth a new probe.
    let wasSignedIn: boolean | undefined;
    return onClerkSessionChange((signedIn) => {
      if (signedIn === wasSignedIn) return;
      wasSignedIn = signedIn;
      if (!signedIn) {
        session.setModels([]);
        session.setGeneration(null);
        session.setModel(null);
        session.setIsAdmin(false);
        return;
      }
      resetGenerationModeProbe();
      void applyDeploymentConfig(session, undefined, () =>
        currentOrStoredModel(session),
      );
    });
  }, [session]);

  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  return { session, state };
}
