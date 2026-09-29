import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { onConnectionChanged } from './github-client.ts';
import type { GitHubStatus } from './github-client.ts';
import { githubStatus } from './github-status.ts';

/**
 * Point the shared GitHub status at this project, and keep it read (D72).
 *
 * Every surface that shows the connection calls this with the open
 * project, and they all read the one copy (internal PR 34). Probed on mount and
 * whenever the connection changes, from here or from anywhere that
 * announces it: a rebind found by a push in another tab refreshed the push
 * button and, before the panel listened, left the header naming the
 * repository connected before it.
 */
export function useProjectStatus(
  projectId: string | null,
): GitHubStatus | null {
  // A layout effect rather than a plain one, so the switch lands before the
  // browser paints: a plain effect runs after a paint that would show the
  // last project's repository under this one's name. `setProject` is a
  // no-op for the project it already holds, so every surface can call it.
  useLayoutEffect(() => {
    githubStatus.setProject(projectId);
  }, [projectId]);
  const status = useSyncExternalStore(
    githubStatus.subscribe,
    githubStatus.read,
  );
  useEffect(() => {
    void githubStatus.refresh();
    return onConnectionChanged(() => void githubStatus.refresh());
  }, [projectId]);
  return status;
}
