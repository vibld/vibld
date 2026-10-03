import { useEffect, useRef, useState } from 'react';
import type { ProjectSnapshot, TranscriptTurn } from '@vibld/core';
import {
  fetchCheckpoints,
  restoreCheckpoint,
} from '../projects/projects-client.ts';
import type {
  Checkpoint,
  CheckpointHistory as History,
} from '../projects/projects-client.ts';

/**
 * Every checkpoint this project has accepted, and putting one back (D152).
 *
 * Fetched rather than taken from the conversation in memory, for the reason
 * `RunHistory` is: the list is the Worker's record of what was accepted, so
 * it survives a reload and includes builds this tab never watched. The
 * conversation only supplies the words: each row is named by the prompt
 * whose build accepted it, where this project's conversation still has one.
 *
 * Restoring asks first, because it changes what the preview shows and what
 * the next build starts from, and says plainly what it does not change: the
 * published site and the connected repository stay as they were until the
 * person ships again.
 */
export function CheckpointHistory({
  runCount,
  projectId = null,
  building = false,
  transcript = [],
  onRestored,
  onRestoring,
}: {
  runCount: number;
  /** The project on screen; the list is that project's checkpoints. */
  projectId?: string | null;
  /** A build is running, which the Worker refuses a restore during. */
  building?: boolean;
  /** The conversation, for naming each checkpoint by what was asked. */
  transcript?: readonly TranscriptTurn[];
  /**
   * Called with the restored code once the Worker has accepted it; answers
   * whether the builder now holds it.
   */
  onRestored?: (
    projectId: string,
    snapshot: ProjectSnapshot,
  ) => boolean | Promise<boolean>;
  /**
   * Called as a restore sets off, so the composer can be held: a build sent
   * meanwhile would start from the code the restore is replacing, and be
   * refused as a conflict (Codex review of internal PR 360). Answers the function
   * that releases this hold, and only this one, once the restore settles.
   */
  onRestoring?: () => () => void;
}) {
  // Kept with the project it was read for, so another project's list is
  // never on screen, or restorable, while this one's is on its way.
  const [loaded, setLoaded] = useState<{
    projectId: string | null;
    history: History | null;
  } | null>(null);
  const history: History | null | 'loading' =
    loaded === null || loaded.projectId !== projectId
      ? 'loading'
      : loaded.history;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  // The project on screen now, read after a restore's await: one that was
  // started for another project has no business announcing itself here.
  const shownProject = useRef(projectId);
  shownProject.current = projectId;

  // Re-read when a run finishes, when another project is opened, and after
  // a restore, which is itself one more acceptance in the list.
  useEffect(() => {
    if (!projectId) {
      setLoaded({ projectId, history: null });
      return;
    }
    let cancelled = false;
    void fetchCheckpoints(projectId).then((result) => {
      if (!cancelled) {
        setLoaded({ projectId, history: result.ok ? result.value : null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runCount, projectId, reloads]);

  // What was being confirmed or said belongs to the project it was about.
  useEffect(() => {
    setConfirming(null);
    setOutcome(null);
    setRestoring(false);
  }, [projectId]);

  async function restore(revision: string) {
    if (!projectId || history === null || history === 'loading') return;
    setRestoring(true);
    setOutcome(null);
    const release = onRestoring?.();
    try {
      const result = await restoreCheckpoint(
        projectId,
        revision,
        history.current,
      );
      // Another project was opened while this was on its way. The restore
      // happened on the server, and that project's own History shows it
      // when it is opened again; this one's says nothing about it.
      if (shownProject.current !== projectId) return;
      if (result.ok) {
        const held = onRestored
          ? await onRestored(projectId, result.value)
          : true;
        if (shownProject.current !== projectId) return;
        setOutcome(
          held
            ? `Restored the checkpoint at revision ${result.value.revision}.`
            : `Restored the checkpoint at revision ${result.value.revision}, but the builder is still showing the code from before. Open the project again to see it.`,
        );
      } else {
        setOutcome(result.failure.message);
      }
      setRestoring(false);
      setConfirming(null);
      setReloads((count) => count + 1);
    } finally {
      release?.();
    }
  }

  if (history === 'loading') return null;

  return (
    <div className="runs checkpoints">
      <h2 className="pane-title">History</h2>
      <p className="pane-note">
        Every checkpoint this project has accepted. Restoring one makes it the
        code the preview shows and the next build starts from; your published
        site and GitHub repository change only when you ship again.
      </p>
      <p className="checkpoints__outcome" role="status" aria-live="polite">
        {outcome}
      </p>
      {history === null ? (
        <p className="empty">
          {projectId
            ? 'Checkpoint history is unavailable right now.'
            : 'No checkpoints yet.'}
        </p>
      ) : history.checkpoints.length === 0 ? (
        <p className="empty">No checkpoints yet.</p>
      ) : (
        <ol className="runs__list">
          {history.checkpoints.map((checkpoint, index) => {
            // The newest acceptance of the current revision is "Current";
            // an older acceptance of the same code is not offered either,
            // since restoring it would change nothing.
            const isCurrent = checkpoint.revision === history.current;
            const isCurrentRow =
              isCurrent &&
              history.checkpoints.findIndex(
                (entry) => entry.revision === history.current,
              ) === index;
            const key = `${checkpoint.runId ?? 'copy'}-${checkpoint.revision}`;
            const label = labelFor(checkpoint, transcript);
            return (
              <li key={key} className="runs__item checkpoints__item">
                <p className="runs__stop">
                  {label}
                  {isCurrentRow ? (
                    <span className="pill pill--on checkpoints__current">
                      Current
                    </span>
                  ) : null}
                </p>
                <p className="runs__detail">
                  {KIND_LABELS[checkpoint.kind]}, revision {checkpoint.revision}
                </p>
                <time className="runs__when" dateTime={checkpoint.acceptedAt}>
                  {new Date(checkpoint.acceptedAt).toLocaleString()}
                </time>
                {isCurrent ? null : confirming === checkpoint.revision ? (
                  <div className="checkpoints__confirm">
                    <p className="runs__detail">
                      Restore this checkpoint? The preview and your next build
                      will use it.
                    </p>
                    <button
                      type="button"
                      className="button button--small button--primary"
                      disabled={building || restoring}
                      onClick={() => void restore(checkpoint.revision)}
                    >
                      {restoring ? 'Restoring...' : 'Yes, restore'}
                    </button>
                    <button
                      type="button"
                      className="button button--small"
                      disabled={restoring}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--small checkpoints__restore"
                    disabled={building || restoring}
                    title={
                      building
                        ? 'Wait for the build to finish to restore a checkpoint.'
                        : undefined
                    }
                    onClick={() => {
                      setOutcome(null);
                      setConfirming(checkpoint.revision);
                    }}
                  >
                    Restore
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const KIND_LABELS: Record<Checkpoint['kind'], string> = {
  build: 'Built',
  repair: 'Repaired after its build check',
  restore: 'First attempt kept after a repair',
  rollback: 'Restored from history',
  copy: 'Copied with the project',
};

/**
 * What a checkpoint is called: the prompt whose build accepted it, found by
 * the Worker's id for that build (the part before any `:repair`), or else
 * by the revision a turn recorded, and failing both, what made it.
 */
export function labelFor(
  checkpoint: Checkpoint,
  transcript: readonly TranscriptTurn[],
): string {
  if (checkpoint.kind === 'rollback') return 'Restored an earlier checkpoint';
  const runId = checkpoint.runId?.split(':')[0] ?? null;
  const turn =
    (runId
      ? transcript.find((entry) => entry.serverRunId === runId)
      : undefined) ??
    transcript.find(
      (entry) =>
        entry.revision === checkpoint.revision && entry.status === 'accepted',
    );
  const words = turn?.prompt.trim() || turn?.summary?.trim();
  if (words) return words.length > 140 ? `${words.slice(0, 139)}...` : words;
  return checkpoint.kind === 'copy'
    ? 'The code this project was copied with'
    : `Checkpoint ${checkpoint.revision}`;
}
