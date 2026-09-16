import { useEffect, useRef, useState } from 'react';
import type { ProjectFile } from '@vibld/core';
import {
  createPreviewShare,
  fetchPreviewShares,
  fetchPreviewStatus,
  revokePreviewShare,
  startSandboxPreview,
  stopSandboxPreview,
} from './preview-client.ts';
import type { PreviewShare, PreviewStatus } from './preview-client.ts';
import { createStatusGate } from '../github/panel-view.ts';

/** How often to re-check a preview that has not yet settled (matches `handlePlan`'s own poll interval, `worker/index.ts`'s `POLL_INTERVAL_MS`). */
export const POLL_INTERVAL_MS = 1500;

const SETTLED = new Set(['ready', 'failed']);

export interface PreviewSandbox {
  status: PreviewStatus | null;
  pending: boolean;
  /**
   * The checkpoint the running preview was built from. A sandbox is a live
   * copy of one checkpoint, not of "the project", so once a later one is
   * accepted the frame is serving work that has been moved on from. It is
   * kept here rather than in `PreviewPanel` because the panel is unmounted
   * on a tab switch, which would take the knowledge with it while the
   * sandbox it describes carried on running.
   */
  ranRevision: string | null;
  /** Start (or restart) a preview of this checkpoint's files. */
  run(files: ProjectFile[], revision: string): void;
  /** Stop the running preview, if any. */
  stop(): void;
  /**
   * Why the last stop could not be confirmed, or null.
   *
   * The screen used to clear itself either way, on the reasoning that the
   * sandbox times out on its own eventually (L9) so a failed stop has
   * nothing useful left to do. Eventually is not now: somebody presses Stop
   * because they want it not running, often because a share link is serving
   * their code to whoever has the URL, and being told it stopped when it did
   * not is the one answer that makes them stop trying.
   *
   * Unconfirmed rather than failed, deliberately. A rejected request
   * establishes that no successful answer arrived, and not that the sandbox
   * survived: the DELETE may have been carried out with the reply lost.
   * Saying it is still running would swap one false certainty for its
   * opposite.
   */
  stopError: string | null;
  /** Every share grant issued for the current preview (docs/decisions.md L10). Empty once the preview itself stops or fails. */
  shares: PreviewShare[];
  sharePending: boolean;
  shareError: string | null;
  /** Mint a new share link for the currently-ready preview. */
  share(): void;
  /** Revoke one share link, independent of the preview itself. */
  revokeShare(shareId: string): void;
}

/**
 * Whether the running sandbox is serving a checkpoint that has been moved on
 * from.
 *
 * Here rather than in a component because two of them ask it now: the panel,
 * which draws the sentence, and the tab badge, which says "live" from another
 * tab entirely. Two copies of this would be two chances to drift, and the
 * badge is the one nobody is looking at when it goes wrong.
 */
export function servingOlderThan(
  sandbox: Pick<PreviewSandbox, 'status' | 'ranRevision'>,
  acceptedRevision: string | undefined,
): boolean {
  return (
    sandbox.status?.status === 'ready' &&
    sandbox.ranRevision !== null &&
    acceptedRevision !== undefined &&
    acceptedRevision !== sandbox.ranRevision
  );
}

/**
 * Owns the lifecycle of one sandbox preview (docs/decisions.md L7-L11) and
 * its share links (L10): start, poll until it settles, stop; mint or revoke
 * a share once it is ready.
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
  const [ranRevision, setRanRevision] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether the worker may still be holding a preview for this caller.
   *
   * Not the same fact as `status`, which is only what the screen is
   * showing. A stop that fails leaves a sandbox running while the screen
   * reports a failure, and a run that then skipped the stop would be handed
   * that same sandbox back and record the new checkpoint against it.
   *
   * Unknown behaves as true, which is why it starts that way: a sandbox
   * outlives a reload of this page and nothing here reads the status on
   * mount, so the first run of a session cannot assume it has none. Only a
   * stop that actually succeeded clears it. A needless `DELETE` costs one
   * request the worker answers `{ ok: true }` to with nothing to stop; a
   * missed one serves an old checkpoint under a new checkpoint's name.
   */
  const mayExist = useRef(true);
  /**
   * Latest wins for the poll, the same `createStatusGate` the connect panel,
   * the push button and the admin panel use.
   *
   * `stopPolling` clears the pending tick and does nothing about the
   * request an earlier tick already sent. That reply still arrives,
   * and it is about the sandbox from before the restart: committed, it puts
   * the old frame back while `ranRevision` names the new checkpoint, so the
   * staleness warning stays hidden and the old sandbox is presented as the
   * current one. It would also call `stopPolling` on the new interval, so
   * the replacement stops being watched.
   */
  const polls = useRef(createStatusGate());

  const [shares, setShares] = useState<PreviewShare[]>([]);
  const [sharePending, setSharePending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  function stopPolling() {
    if (pollRef.current !== null) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  /*
   * The poll must not outlive the shell even though this hook otherwise
   * does not track component lifetime.
   *
   * Clearing the timer is not enough on its own, and cancelling the gate is
   * what actually ends it. A tick that is waiting on its reply holds no
   * timer to clear, so cleanup would find nothing, and the reply would then
   * schedule the next tick into a shell that no longer exists. On sign-out,
   * where `AuthGate` takes the builder away and every request that follows
   * is refused, each of those answers is unreadable, which is deliberately
   * not a reason to stop asking: it would ask forever. Superseding the gate
   * makes the outstanding tick return without rescheduling.
   */
  useEffect(
    () => () => {
      stopPolling();
      polls.current.supersede();
    },
    [],
  );

  // A share only ever makes sense against a preview that is actually
  // running -- once this one stops or fails, its shares are somebody else's
  // history now, not this session's to keep showing or revoking.
  useEffect(() => {
    if (status?.status !== 'ready') {
      setShares([]);
      return;
    }
    void fetchPreviewShares().then(setShares);
  }, [status?.status]);

  /**
   * Ask again every `POLL_INTERVAL_MS` until the sandbox settles, one
   * request at a time.
   *
   * A chain rather than an interval, and the difference is not tidiness.
   * An interval fires on the clock whatever the last request is doing, so a
   * status read slower than 1.5 seconds leaves several in flight at once,
   * all holding the same `current()` token because the gate is taken once
   * for the whole poll. They then land in whatever order the network gives
   * them, and the gate cannot tell them apart. That is a real wrong screen,
   * not a race in the abstract: after an unconfirmed stop, a later request
   * can come back `failed`, clear the warning and end the poll, and then an
   * earlier one lands with the stale `installing` it was sent for. The
   * panel is left saying a sandbox is installing, with no warning and
   * nothing still asking, about something that no longer exists.
   *
   * The next tick is scheduled only once the previous answer has been
   * handled, so there is never a second request to be out of order with.
   * The first tick is still one interval out: the caller has just read the
   * status itself.
   */
  function pollUntilSettled() {
    stopPolling();
    // Once for the chain rather than per tick: every tick of it belongs to
    // the run that started it, and a run or a stop supersedes the lot.
    const current = polls.current.begin();
    const tick = async () => {
      // This one has fired, so there is no pending timer to cancel until
      // the next is scheduled. Anything cancelling a poll mid-request has to
      // supersede the gate rather than rely on `stopPolling`: the reply is
      // what schedules the next tick, and only the gate can stop it.
      pollRef.current = null;
      const result = await fetchPreviewStatus();
      // Sent before a run or a stop superseded this poll, answering after.
      // Nothing is rescheduled either: this chain is no longer the poll.
      if (!current()) return;
      if (result !== null) {
        setStatus(result);
        // The poll is what settles an unconfirmed stop, so it also has to
        // put the warning down. A sandbox the service reports as failed is
        // not running, whether it was deleted or died on its own, and
        // leaving "it may still be running" beside "no preview has been
        // started" is the panel contradicting itself. Worse, a failed
        // status takes the Stop button away, so nobody could clear it.
        if (result.status === 'failed') setStopError(null);
        if (SETTLED.has(result.status)) return;
      }
      // A transient read failure (a dropped request, an expired session) is
      // not the sandbox failing -- `result === null` falls through to here
      // rather than reporting a status the server never actually sent.
      pollRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    pollRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }

  async function run(files: ProjectFile[], revision: string) {
    // A stale complaint about the last sandbox has nothing to say about
    // this one.
    setStopError(null);
    stopPolling();
    polls.current.supersede();
    setPending(true);
    setStatus(null);
    setRanRevision(null);
    try {
      // `startPreview` reports an existing preview rather than replacing it
      // ("call `stopPreview()` first for a clean restart against new
      // files", `apps/preview/worker/preview-sandbox.ts`). So a restart
      // that does not stop first is not one: it hands back the sandbox that
      // is already running, still serving the checkpoint it was built from,
      // and recording the new checkpoint against it would put the current
      // revision on an older project. That is worse than saying nothing,
      // because then the absence of the warning above is itself a claim.
      if (mayExist.current) {
        try {
          await stopSandboxPreview();
          mayExist.current = false;
        } catch {
          setStatus({
            status: 'failed',
            error:
              'The running sandbox could not be stopped, so it has not been restarted. Try again in a moment.',
          });
          return;
        }
      }
      // Before the request, not after: a start whose reply is lost may
      // still have created the sandbox, and the next run has to stop it.
      mayExist.current = true;
      const initial = await startSandboxPreview(files);
      setStatus(initial);
      // Only now: this is the checkpoint the sandbox is actually being
      // built from.
      setRanRevision(revision);
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
    polls.current.supersede();
    setStopError(null);
    setPending(true);
    try {
      await stopSandboxPreview();
      mayExist.current = false;
      // Only now. Clearing these before the request answered is what made
      // the screen say the sandbox was gone whatever happened.
      setStatus(null);
      setRanRevision(null);
    } catch (error) {
      // What is actually known: the client did not get a successful answer.
      // Not that the sandbox is still running -- the DELETE may have been
      // carried out and the response lost -- so the wording says the stop
      // could not be confirmed, and the screen keeps showing what it last
      // knew rather than asserting either way. `mayExist` was never cleared
      // on this path either, because the next run still has to try to stop
      // it first; what changes is that the person is told.
      setStopError(
        error instanceof Error
          ? error.message
          : 'Could not stop the sandbox preview.',
      );
      // The poll was cancelled before the request went out, and asking
      // again is the only thing that can settle what just happened.
      //
      // For every status, not only the unsettled ones. A ready sandbox
      // whose DELETE succeeded with the reply lost is the case that reads
      // worst: the frame, the share list and the warning all sit there
      // describing something that is gone, and nothing asks. This costs one
      // request when the sandbox really is still ready, because
      // `pollUntilSettled` stops on the first settled answer.
      pollUntilSettled();
    } finally {
      setPending(false);
    }
  }

  async function share() {
    setShareError(null);
    setSharePending(true);
    try {
      const grant = await createPreviewShare();
      setShares((current) => [...current, grant]);
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : 'Could not create a share link.',
      );
    } finally {
      setSharePending(false);
    }
  }

  async function doRevokeShare(shareId: string) {
    setShareError(null);
    setSharePending(true);
    try {
      await revokePreviewShare(shareId);
      setShares((current) =>
        current.map((entry) =>
          entry.shareId === shareId
            ? { ...entry, revoked: true, url: undefined }
            : entry,
        ),
      );
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : 'Could not revoke that share link.',
      );
    } finally {
      setSharePending(false);
    }
  }

  return {
    status,
    ranRevision,
    pending,
    run: (files, revision) => void run(files, revision),
    stop: () => void stop(),
    stopError,
    shares,
    sharePending,
    shareError,
    share: () => void share(),
    revokeShare: (shareId) => void doRevokeShare(shareId),
  };
}
