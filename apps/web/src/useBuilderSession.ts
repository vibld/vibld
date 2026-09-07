import { useMemo, useSyncExternalStore } from 'react';
import { BuilderSession } from './generation/session.ts';
import type { BuilderState } from './generation/session.ts';

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
  const session = useMemo(() => new BuilderSession(), []);
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  return { session, state };
}
