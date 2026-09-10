import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BuilderSession } from './generation/session.ts';
import type { BuilderState } from './generation/session.ts';
import { loadKnowledge } from './generation/knowledge-store.ts';
import {
  detectDeploymentConfig,
  resetGenerationModeProbe,
} from './generation/remote-provider.ts';
import { onClerkSessionChange } from './auth/clerk-token.ts';

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
    // What this deployment can serve. The picker stays hidden until it
    // answers, which is correct: there is no choice to offer yet, and a
    // failed probe is not worth surfacing here -- the run itself reports it.
    void detectDeploymentConfig()
      .then((config) => {
        created.setModels(config.models);
        created.setModel(config.defaultModel);
      })
      .catch(() => {});
    return created;
  }, []);

  // Sign-in gates the endpoint now (docs/decisions.md L5), and it can happen
  // at any point after the page has already loaded, from the header's modal.
  // Without this, the picker offered nothing signed-out and would keep
  // offering nothing signed-in, until a reload happened to re-run the probe
  // above.
  useEffect(
    () =>
      onClerkSessionChange((signedIn) => {
        if (!signedIn) {
          session.setModels([]);
          session.setModel(null);
          return;
        }
        resetGenerationModeProbe();
        void detectDeploymentConfig()
          .then((config) => {
            session.setModels(config.models);
            session.setModel(config.defaultModel);
          })
          .catch(() => {});
      }),
    [session],
  );

  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  return { session, state };
}
