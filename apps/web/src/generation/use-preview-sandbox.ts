import { useEffect, useRef, useState } from 'react';
import type { ProjectFile } from '@vibld/core';
import {
  fetchPreviewStatus,
  startSandboxPreview,
  stopSandboxPreview,
} from './preview-client.ts';
import type { PreviewStatus } from './preview-client.ts';

/** How often to re-check a preview that has not yet settled (matches `handlePlan`'s own poll interval, `worker/index.ts`'s `POLL_INTERVAL_MS`). */
const POLL_INTERVAL_MS = 1500;

const SETTLED = new Set(['ready', 'failed']);

export interface PreviewSandbox {
  status: PreviewStatus | null;
  pending: boolean;
  /** Start (or restart) a preview of these files. */
  run(files: ProjectFile[]): void;
  /** Stop the running preview, if any. */
  stop(): void;
}

/**
 * Owns the lifecycle of one sandbox preview (docs/decisions.md L7-L11):
 * start, poll until it settles, stop.
 *
 * Called from `Workspace.tsx`, one level above `PreviewPanel`, deliberately:
 * `Workspace` renders `PreviewPanel` only while the Preview tab is the
 * active one, so a state hook inside `PreviewPanel` itself would be torn
 * down -- polling and all -- every time the user switched to Code or
 * Console and back, silently orphaning a sandbox that was still running.
 * `Workspace` does not unmount on a tab switch, so state here survives one.
 */
export function usePreviewSandbox(): PreviewSandbox {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [pending, setPending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // The interval must not outlive the shell even though this hook otherwise
  // does not track component lifetime.
  useEffect(() => stopPolling, []);

  function pollUntilSettled() {
    stopPolling();
    pollRef.current = setInterval(() => {
      void fetchPreviewStatus().then((result) => {
        // A transient read failure (a dropped request, an expired session)
        // is not the sandbox failing -- the poll itself keeps going rather
        // than reporting a status the server never actually sent.
        if (result === null) return;
        setStatus(result);
        if (SETTLED.has(result.status)) stopPolling();
      });
    }, POLL_INTERVAL_MS);
  }

  async function run(files: ProjectFile[]) {
    stopPolling();
    setPending(true);
    setStatus(null);
    try {
      const initial = await startSandboxPreview(files);
      setStatus(initial);
      if (!SETTLED.has(initial.status)) pollUntilSettled();
    } catch (error) {
      setStatus({
        status: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'Could not start the sandbox preview.',
      });
    } finally {
      setPending(false);
    }
  }

  async function stop() {
    stopPolling();
    setPending(true);
    try {
      await stopSandboxPreview();
    } catch {
      // Best-effort: the sandbox times out on its own either way (L9), so
      // there is nothing more useful to do with a failed stop than let the
      // UI forget about it.
    } finally {
      setStatus(null);
      setPending(false);
    }
  }

  return {
    status,
    pending,
    run: (files) => void run(files),
    stop: () => void stop(),
  };
}
