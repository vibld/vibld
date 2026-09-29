import type { ProjectFile } from '@vibld/core';
import type { BuilderState } from './session.ts';

/**
 * Whether the listed files are the accepted checkpoint's own.
 *
 * Compared rather than inferred from `status`. A submission refused before
 * it starts (the budget reservation in `BuilderSession.submit`) leaves the
 * status `failed` and never touches `stagedFiles`, so after an accepted
 * checkpoint the list is still that checkpoint while the status says
 * otherwise. Reading the status there marks the list "staged" and tells
 * somebody the buttons act on something else, both about the very files
 * they are looking at.
 */
export function sameFiles(
  listed: ProjectFile[],
  accepted: ProjectFile[],
): boolean {
  return (
    listed.length === accepted.length &&
    listed.every(
      (file, index) =>
        file.path === accepted[index]?.path &&
        file.content === accepted[index]?.content,
    )
  );
}

/** The files on screen are a build's own code, shown while it is checked. */
export function showingChecked(state: BuilderState): boolean {
  return (
    state.running &&
    (state.check?.state === 'checking' || state.check?.state === 'repairing') &&
    state.stagedFiles.length > 0
  );
}

/** The files on screen are work that has not been accepted yet. */
export function showingStaged(state: BuilderState): boolean {
  return (
    state.stagedFiles.length > 0 &&
    (state.acceptedSnapshot === null ||
      !sameFiles(state.stagedFiles, state.acceptedSnapshot.files))
  );
}

/**
 * What export, publish and push act on, said when it is not what is on
 * screen.
 *
 * All three take the accepted checkpoint, deliberately: staged files have
 * not been validated, and exporting or publishing a project that is about
 * to be rejected is worse than offering nothing. So when the files being
 * shown are something else, the Ship menu says so above its actions, and
 * the Code tab says so above the list (D72 moved the actions out of it).
 * Null when there is nothing to act on or nothing to explain.
 */
export function shipNote(state: BuilderState): string | null {
  if (!state.acceptedSnapshot) return null;
  if (showingChecked(state) && showingStaged(state)) {
    return 'These act on the last finished checkpoint, not the files still being checked.';
  }
  if (showingStaged(state)) {
    return 'These act on the last accepted checkpoint, not the staged files.';
  }
  return null;
}
