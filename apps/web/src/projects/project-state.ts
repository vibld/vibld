import { clipTranscriptTurn } from '@vibld/core';
import type { TranscriptTurn } from '@vibld/core';
import type { StyleDna } from '@vibld/ai/style-dna';

import type { SessionSettings } from '../generation/session.ts';
import type {
  ProjectPatch,
  ProjectSettings,
  ProjectSummary,
} from './projects-client.ts';
import { isProjectsPath, projectIdFromPath } from './project-route.ts';

/**
 * The decisions the projects hook makes, apart from the hook, so each can
 * be tested without React or a network: what opening a project puts back,
 * what an address asks for, and what has changed since the last save.
 */

/** What this browser last chose, for a project that never said. */
export interface BrowserDefaults {
  model: string | null;
  knowledge: string;
  styleDna: StyleDna;
}

/**
 * The settings a project opens with.
 *
 * The project's own choice wins wherever it made one (docs/decisions.md,
 * 2026-09-28, projects). Where it never did, which is every project made
 * before projects remembered anything, this browser's last choice fills
 * in, the same default a new project is given.
 *
 * The model is only restored if the deployment still offers it to this
 * person: a saved id the picker cannot show would be sent with the next
 * build and refused there. When the offer is not known yet (the probe has
 * not answered), it is restored anyway, and `applyDeploymentConfig` checks
 * it against the offer when it arrives, because it prefers what the
 * session already holds.
 */
export function settingsToRestore(
  saved: ProjectSettings,
  defaults: BrowserDefaults,
  offered: readonly { id: string }[],
  current: string | null,
): SessionSettings & { referenceUrl: string } {
  const wanted = saved.model ?? defaults.model;
  const model =
    wanted !== null &&
    (offered.length === 0 || offered.some((option) => option.id === wanted))
      ? wanted
      : current;
  return {
    style: saved.style,
    referenceUrl: saved.referenceUrl ?? '',
    model,
    knowledge: saved.knowledge ?? defaults.knowledge,
    styleDna: saved.styleDna ?? defaults.styleDna,
  };
}

/** What the address bar is asking the builder to show. */
export type PathAction =
  /** Open this project, which is not the one open now. */
  | { kind: 'open'; id: string }
  /** Show the list of projects. */
  | { kind: 'list' }
  /** Put the open project's address in the bar; nothing else changes. */
  | { kind: 'address'; id: string }
  /** Open the most recently opened active project. */
  | { kind: 'open-recent'; id: string }
  /** There is no active project to open: make one. */
  | { kind: 'create' }
  /** Nothing for projects to do here (the admin page, or already shown). */
  | { kind: 'none' };

/**
 * What an address means, given what is open and what exists.
 *
 * Any address that is not a project, the list or the admin page is the
 * builder's own (`/` above all): it shows the open project, or on a fresh
 * load the one opened last, so a refresh with no project in the address
 * still comes back to the work.
 */
export function pathAction(
  pathname: string,
  isAdminPage: boolean,
  currentId: string | null,
  projects: readonly ProjectSummary[] | null,
): PathAction {
  if (isAdminPage) return { kind: 'none' };
  if (isProjectsPath(pathname)) return { kind: 'list' };
  const named = projectIdFromPath(pathname);
  if (named !== null) {
    return named === currentId ? { kind: 'none' } : { kind: 'open', id: named };
  }
  if (currentId !== null) return { kind: 'address', id: currentId };
  if (projects === null) return { kind: 'none' };
  // The list arrives most recently opened first.
  const recent = projects.find((project) => !project.archived);
  return recent ? { kind: 'open-recent', id: recent.id } : { kind: 'create' };
}

/** The settings as the Worker stores them. */
export function wireSettings(settings: SessionSettings): ProjectSettings {
  return {
    style: settings.style,
    referenceUrl: settings.referenceUrl,
    model: settings.model,
    knowledge: settings.knowledge,
    styleDna: settings.styleDna,
  };
}

/**
 * Settings as a comparison key: the Worker's shape, in one fixed order, so
 * the same settings always make the same string whether they came from the
 * Worker or from the session.
 */
export function settingsMark(settings: ProjectSettings): string {
  return JSON.stringify([
    settings.style,
    settings.referenceUrl,
    settings.model,
    settings.knowledge,
    settings.styleDna,
  ]);
}

/** What was last saved, as the comparison keys `changedSince` reads. */
export interface SavedMarks {
  settings: string | null;
  transcript: string | null;
}

/**
 * What has changed since the last save, as the patch that would save it,
 * or null for nothing.
 *
 * The conversation is only saved once its last turn has settled. A turn
 * still running has nothing worth keeping yet, and saving it would write
 * a spinner into the project that a reload could only show as cancelled;
 * what matters is saving it the moment it closes, which is "after each
 * accepted build and each agent reply". Settings are saved whenever they
 * change, running or not.
 */
export function changedSince(
  marks: SavedMarks,
  settings: SessionSettings,
  transcript: readonly TranscriptTurn[],
): { patch: ProjectPatch; marks: SavedMarks } | null {
  const wire = wireSettings(settings);
  const settingsKey = settingsMark(wire);
  const settled = transcript.at(-1)?.status !== 'running';
  const turns = settled ? transcript.map(clipTranscriptTurn) : null;
  const transcriptMark = turns ? JSON.stringify(turns) : marks.transcript;

  const patch: ProjectPatch = {};
  if (settingsKey !== marks.settings) patch.settings = wire;
  if (turns && transcriptMark !== marks.transcript) patch.transcript = turns;
  if (!patch.settings && !patch.transcript) return null;
  return {
    patch,
    marks: { settings: settingsKey, transcript: transcriptMark },
  };
}

/**
 * The marks for a project as the Worker holds it.
 *
 * Taken from what was stored rather than from what the session was given,
 * so that anything opening filled in from this browser (a project that
 * never chose a model, say) differs from them and is saved once, and a
 * turn saved while still running is saved again as the cancelled turn it
 * now reads as. Anything else opening a project does is not a change.
 */
export function marksFor(
  saved: ProjectSettings,
  transcript: readonly TranscriptTurn[],
): SavedMarks {
  return {
    settings: settingsMark(saved),
    transcript: JSON.stringify(transcript.map(clipTranscriptTurn)),
  };
}

/** "3 minutes ago", "yesterday", or a date, for the list's last-edited column. */
export function formatEdited(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
