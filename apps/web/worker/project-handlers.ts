import { canonicalModelId, isKnownModel } from '@vibld/ai';
import { sanitizeStyleDna } from '@vibld/ai/style-dna';
import { isStyleColorEdits, isStyleGalleryId } from '@vibld/ai/style-gallery';
import { isStylePresetId } from '@vibld/ai/style-presets';
import {
  DEFAULT_PROJECT_NAME,
  MAX_TRANSCRIPT_BYTES,
  cleanProjectName,
  copyName,
  parseTranscript,
  revisionFor,
  subdomainOrigin,
} from '@vibld/core';
import type { ProjectFile, TranscriptTurn } from '@vibld/core';

import {
  PROJECT_CHECKPOINTS_ROUTE,
  PROJECT_DUPLICATE_ROUTE,
  PROJECT_FILES_ROUTE,
  PROJECT_ITEM_ROUTE,
  PROJECT_RESTORE_ROUTE,
  PROJECT_SHARE_ROUTE,
  projectIdInPath,
  routeKeyFor,
} from './access-gate.ts';
import { D1GenerationStore } from './generation-store.ts';
import type { Tier } from './entitlement.ts';
import { planOf, projectLimitOf } from './spendable.ts';
import type { PrincipalDenied, PrincipalGranted } from './principal.ts';
import { ProjectStore, mayReplace } from './project-store.ts';
import type {
  ProjectRecord,
  ProjectSeo,
  ProjectSettings,
  SaveGuard,
} from './project-store.ts';
import {
  DEFAULT_LIMITS,
  checkBodySize,
  checkRequestOrigin,
  isProjectId,
  parseKnowledge,
  parseProjectFiles,
  parseReferenceUrl,
  pathProblem,
} from './request-guard.ts';
import type { GuardResult } from './request-guard.ts';
import { buildInFlight, UNREADABLE_RUN_HELD_MS } from './run-control.ts';
import { newShareToken, shareUrl } from './share-link.ts';

/**
 * `/api/projects`: the caller's own projects (docs/decisions.md, "Resolved
 * 2026-09-28", projects).
 *
 *     GET    /api/projects                 every project, active and archived
 *     POST   /api/projects                 make one (held to the tier's limit)
 *     GET    /api/projects/:id             open one: its settings, its
 *                                          conversation, its accepted code
 *                                          and any build still running in it
 *     PATCH  /api/projects/:id             rename, archive or unarchive, save
 *                                          settings and conversation, and
 *                                          what search engines are told
 *                                          about its site (D194)
 *     DELETE /api/projects/:id             delete it, code, site and all
 *     POST   /api/projects/:id/duplicate   copy it (held to the limit)
 *     POST   /api/projects/:id/share       turn its share link on
 *     DELETE /api/projects/:id/share       turn it off, for good
 *     GET    /api/projects/:id/checkpoints every accepted checkpoint
 *     POST   /api/projects/:id/checkpoints/restore
 *                                          make one of them the accepted
 *                                          one again (D152)
 *     GET    /api/projects/:id/files       the accepted code, or one
 *                                          checkpoint's (D190)
 *     PUT    /api/projects/:id/files       write and delete files in the
 *                                          accepted code, with no build
 *                                          (D190); with dryRun, checked
 *                                          and answered, never accepted
 *                                          (D212)
 *
 * Every route that names a project answers 404 for one that is not the
 * caller's, never 403: "that exists, and it is not yours" is a fact about
 * somebody else's account.
 *
 * In its own module rather than in `index.ts`, which cannot be loaded under
 * `node --test`, so the ownership rule, the limit and the deletion are
 * exercised by `projects.test.ts` against the real schema.
 */

export interface ProjectsEnv {
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
}

export interface ProjectsDeps {
  resolvePrincipal: (
    request: Request,
  ) => Promise<PrincipalDenied | PrincipalGranted>;
  now?: () => Date;
  newId?: () => string;
  /**
   * The caller's tier. Defaults to the reading every paid route makes,
   * `planOf` over the mirrored subscription and any gifted plan (D73), so
   * the limit and the allowance can never be decided from two different
   * answers.
   */
  tierOf?: (userId: string) => Promise<Tier>;
  /** Where the links in a project's view point. */
  links?: ProjectLinks;
  /** A share token. Defaults to 32 random bytes (`share-link.ts`). */
  newToken?: () => string;
  /**
   * Take this project's published site down, as its owner, before the
   * project is deleted. Supplied by the router, which is the one place
   * allowed to reach the takedown (ADR-0013, `publish-authorisation.test.
   * ts`), and only where publishing is configured. Absent, a project with a
   * live site is not deleted: see the DELETE below.
   */
  takeDownSite?: (projectId: string) => Promise<void>;
  /**
   * Disconnect this project's own domain (D189) before the project is
   * deleted; true once it has none. False stops the deletion, so the row
   * naming the hostname at Cloudflare is still there to try again with.
   */
  removeDomain?: (projectId: string) => Promise<boolean>;
  /**
   * Whether this account may edit files again now (D190): a burst limit,
   * since every edit stores a whole snapshot. Absent, every edit may.
   */
  editAllowed?: (userId: string) => Promise<boolean>;
  /**
   * Stop the live preview a share link may have started (`share-handlers.
   * ts`). Called when the link stops for a reason somebody is present for,
   * so a viewer already watching it does not keep a sandbox for the rest of
   * its lifetime. Absent where there is no preview service.
   */
  stopSharePreview?: (token: string) => Promise<void>;
  /**
   * A build's Workflow instance status, so opening a project can tell a
   * build still running from one the engine stopped without writing its
   * end (`run-control.ts`). Absent where there is no Workflow binding.
   */
  instanceStatus?: (runId: string) => Promise<string | undefined>;
}

/**
 * The two addresses a project's view links to: the builder's own origin,
 * which a share link is on, and the domain published sites are served
 * under (`apps/publish`'s `PUBLISH_HOSTNAME`).
 */
export interface ProjectLinks {
  origin: string;
  publishHostname: string;
}

export const DEFAULT_PUBLISH_HOSTNAME = 'vibld-preview.dev';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const NOT_FOUND = () => json({ error: 'That project does not exist.' }, 404);

/**
 * A save carries the whole conversation, so its body is allowed the
 * transcript's own bound plus room for the settings beside it, rather than
 * the 256 KiB a build request is held to.
 */
export const MAX_PROJECT_BODY_BYTES = MAX_TRANSCRIPT_BYTES + 64 * 1024;

/** The code the builder matches on to offer an upgrade rather than retry. */
export const PROJECT_LIMIT_CODE = 'project-limit';

/**
 * The code a save made from an older copy of the project is refused with
 * (docs/decisions.md, "Resolved 2026-09-29 (later)", D63), which the
 * builder matches on to stop saving and offer a reload.
 */
export const PROJECT_CHANGED_CODE = 'project-changed';

function changedRefusal(version: number): Response {
  return json(
    {
      error: 'This project changed in another tab.',
      code: PROJECT_CHANGED_CODE,
      version,
    },
    409,
  );
}

/**
 * Refuse a create, a duplicate or an unarchive that would pass the limit.
 *
 * Not a `RunRefusal` (`run-outcome.ts`): that vocabulary names why a run
 * did not start, and this is not a run. It keeps the same convention, a
 * sentence for the person and an identifier for the code, under `code` so
 * nothing that reads `reason` as a run refusal mistakes it for one.
 */
function limitRefusal(limit: number): Response {
  return json(
    {
      error: `A free account can have ${limit} active projects. Archive one to start another, or upgrade for unlimited projects.`,
      code: PROJECT_LIMIT_CODE,
      limit,
    },
    403,
  );
}

/**
 * A project as its owner's builder reads it.
 *
 * `share.url` is the link itself, since it is the owner's to copy; it is
 * null while the link is off. `share.held` says an operator has stopped
 * it, which the owner is told plainly rather than finding out from a
 * friend. `site` is the project's published site, by the state the publish
 * service would report, with its address.
 */
export function projectView(project: ProjectRecord, links?: ProjectLinks) {
  const origin = links?.origin ?? '';
  const hostname = links?.publishHostname ?? DEFAULT_PUBLISH_HOSTNAME;
  return {
    id: project.id,
    name: project.name,
    archived: project.archivedAt !== null,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    editedAt: project.editedAt,
    lastOpenedAt: project.lastOpenedAt,
    hasCode: project.acceptedRevision !== null,
    turns: project.transcriptTurns,
    // The version the next save names as the one it was made from.
    version: project.version,
    settings: project.settings,
    share: {
      on: project.share.token !== null,
      url: project.share.token ? shareUrl(origin, project.share.token) : null,
      held: project.share.heldAt !== null,
    },
    site: project.site
      ? {
          slug: project.site.slug,
          state: project.site.state,
          url: `${subdomainOrigin(project.site.slug, hostname)}/`,
        }
      : null,
    seo: project.seo,
  };
}

function fail(status: number, error: string): GuardResult<never> {
  return { ok: false, status, error };
}

/**
 * The settings the builder sent, field by field. A field that is absent is
 * not changed; one that is present and null is cleared.
 *
 * The two closed sets, the style preset and the model, are sanitised
 * rather than refused, the rule `parseStyleDna` already applies to values
 * carried from one request to the next: a preset or a model renamed since
 * the builder last saved should cost that one choice, not the whole save.
 * The two free-text fields are held to the bounds their own parsers apply
 * on `/api/plan`, so a saved setting is always one a build would accept.
 */
export function parseProjectSettings(
  value: unknown,
): GuardResult<Partial<ProjectSettings>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(400, '"settings" must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const settings: Partial<ProjectSettings> = {};
  if ('style' in raw) {
    settings.style = isStylePresetId(raw.style) ? raw.style : null;
  }
  if ('model' in raw) {
    const wanted =
      typeof raw.model === 'string' ? canonicalModelId(raw.model) : null;
    settings.model = isKnownModel(wanted) ? wanted : null;
  }
  if ('referenceUrl' in raw) {
    const parsed = parseReferenceUrl({ referenceUrl: raw.referenceUrl });
    if (!parsed.ok) return parsed;
    settings.referenceUrl = parsed.value;
  }
  // Null and empty are different answers for the two standing
  // preferences, and both are kept. Null is "this project never said",
  // which the builder fills from what the browser last chose; empty is
  // "this project said none", which it must not.
  if ('knowledge' in raw) {
    const parsed = parseKnowledge({ knowledge: raw.knowledge });
    if (!parsed.ok) return parsed;
    settings.knowledge =
      parsed.value ?? (typeof raw.knowledge === 'string' ? '' : null);
  }
  if ('styleDna' in raw) {
    settings.styleDna =
      raw.styleDna === null || raw.styleDna === undefined
        ? null
        : sanitizeStyleDna(raw.styleDna);
  }
  if ('galleryStyle' in raw) {
    settings.galleryStyle = isStyleGalleryId(raw.galleryStyle)
      ? raw.galleryStyle
      : null;
  }
  if ('galleryColors' in raw) {
    settings.galleryColors = isStyleColorEdits(raw.galleryColors)
      ? raw.galleryColors
      : null;
  }
  // A project builds in a preset or a gallery style, never both (D144).
  // Choosing one clears the other here too, so a builder older than the
  // gallery, which saves only `style`, cannot leave both stored. Color
  // edits belong to the gallery style and go with it (D147): a save that
  // names a style without them, as a builder older than the edits does,
  // clears them, so one style's edits never carry over to another.
  if (settings.style && settings.galleryStyle) {
    return fail(400, 'Choose a style or a gallery style, not both.');
  }
  if (settings.style) settings.galleryStyle = null;
  if (settings.galleryStyle) settings.style = null;
  if (
    'galleryStyle' in settings &&
    (!settings.galleryStyle || !('galleryColors' in raw))
  ) {
    settings.galleryColors = null;
  }
  return { ok: true, value: settings };
}

interface ProjectPatch {
  name?: string;
  archived?: boolean;
  settings?: Partial<ProjectSettings>;
  transcript?: TranscriptTurn[];
  seo?: Partial<ProjectSeo>;
  /** Absent from a builder older than versions, whose save always wins. */
  guard?: SaveGuard;
}

/**
 * Bounds on the owner's SEO fields (D194). Search engines show about 60
 * characters of a title and 160 of a description; these leave room
 * beyond that without letting a field become a page.
 */
export const SEO_TITLE_MAX = 120;
export const SEO_DESCRIPTION_MAX = 320;
const SEO_IMAGE_MAX = 2048;

/** Plain text on one line: whitespace runs, newlines included, become one space. */
function seoText(
  value: unknown,
  field: string,
  max: number,
): GuardResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return fail(400, `"seo.${field}" must be text or null.`);
  }
  // Control characters have no place in a title, and would end up in the
  // page's <head>.
  const text = value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (text.length > max) {
    return fail(400, `"seo.${field}" is longer than ${max} characters.`);
  }
  return { ok: true, value: text === '' ? null : text };
}

/**
 * The preview image: an https URL, or a path on the site itself such as
 * `/og.png`, which apps/publish makes absolute on whichever address
 * serves the site.
 */
function seoImage(value: unknown): GuardResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return fail(400, '"seo.image" must be text or null.');
  }
  const image = value.trim();
  if (image === '') return { ok: true, value: null };
  const refused = fail(
    400,
    '"seo.image" must be an https:// address or a path on the site, such as /og.png.',
  );
  if (image.length > SEO_IMAGE_MAX || /[\s"<>\\]/.test(image)) return refused;
  if (image.startsWith('/')) {
    return image.startsWith('//') ? refused : { ok: true, value: image };
  }
  let url: URL;
  try {
    url = new URL(image);
  } catch {
    return refused;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return refused;
  return { ok: true, value: url.href };
}

/** The owner's SEO fields, field by field: absent is unchanged, null clears. */
export function parseProjectSeo(
  value: unknown,
): GuardResult<Partial<ProjectSeo>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(400, '"seo" must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const seo: Partial<ProjectSeo> = {};
  if ('title' in raw) {
    const title = seoText(raw.title, 'title', SEO_TITLE_MAX);
    if (!title.ok) return title;
    seo.title = title.value;
  }
  if ('description' in raw) {
    const description = seoText(
      raw.description,
      'description',
      SEO_DESCRIPTION_MAX,
    );
    if (!description.ok) return description;
    seo.description = description.value;
  }
  if ('image' in raw) {
    const image = seoImage(raw.image);
    if (!image.ok) return image;
    seo.image = image.value;
  }
  if ('indexing' in raw) {
    if (typeof raw.indexing !== 'boolean') {
      return fail(400, '"seo.indexing" must be true or false.');
    }
    seo.indexing = raw.indexing;
  }
  return { ok: true, value: seo };
}

/** A page's name for itself: a UUID, or anything as plain and as short. */
const WRITER = /^[A-Za-z0-9-]{1,64}$/;

/** Everything a PATCH may carry, all of it checked before any of it is written. */
export function parseProjectPatch(body: unknown): GuardResult<ProjectPatch> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const raw = body as Record<string, unknown>;
  const patch: ProjectPatch = {};
  if ('name' in raw) {
    const name = cleanProjectName(raw.name);
    if (name === null) return fail(400, 'A project needs a name.');
    patch.name = name;
  }
  if ('archived' in raw) {
    if (typeof raw.archived !== 'boolean') {
      return fail(400, '"archived" must be true or false.');
    }
    patch.archived = raw.archived;
  }
  if ('settings' in raw) {
    const settings = parseProjectSettings(raw.settings);
    if (!settings.ok) return settings;
    patch.settings = settings.value;
  }
  if ('transcript' in raw) {
    const transcript = parseTranscript(raw.transcript);
    if (!transcript.ok) return fail(400, transcript.error);
    if (JSON.stringify(transcript.turns).length > MAX_TRANSCRIPT_BYTES) {
      return fail(413, 'This conversation is too long to save.');
    }
    patch.transcript = transcript.turns;
  }
  if ('seo' in raw) {
    const seo = parseProjectSeo(raw.seo);
    if (!seo.ok) return seo;
    patch.seo = seo.value;
  }
  if ('version' in raw) {
    if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 0) {
      return fail(400, '"version" must be a whole number.');
    }
    if (
      'writer' in raw &&
      (typeof raw.writer !== 'string' || !WRITER.test(raw.writer))
    ) {
      return fail(400, '"writer" is not a page id.');
    }
    patch.guard = {
      version: raw.version as number,
      writer: typeof raw.writer === 'string' ? raw.writer : null,
    };
  }
  return { ok: true, value: patch };
}

async function readJson(request: Request): Promise<GuardResult<unknown>> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return fail(400, 'Body must be valid JSON.');
  }
}

/** The checks every write makes before identity, cheapest first. */
function writeGuard(request: Request): Response | null {
  const origin = checkRequestOrigin(
    request.headers,
    new URL(request.url).origin,
  );
  if (!origin.ok) return json({ error: origin.error }, origin.status);
  const size = checkBodySize(request.headers, {
    ...DEFAULT_LIMITS,
    maxBodyBytes: MAX_PROJECT_BODY_BYTES,
  });
  if (!size.ok) return json({ error: size.error }, size.status);
  return null;
}

/**
 * A DELETE carries no body, so there is no content type to insist on, and
 * only the origin is checked: a cross-site page that could reach this would
 * be deleting somebody's work.
 */
function deleteGuard(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: 'Cross-site requests are not allowed.' }, 403);
  }
  return null;
}

const ALLOWED: Record<string, readonly string[]> = {
  '/api/projects': ['GET', 'POST'],
  [PROJECT_ITEM_ROUTE]: ['GET', 'PATCH', 'DELETE'],
  [PROJECT_DUPLICATE_ROUTE]: ['POST'],
  [PROJECT_SHARE_ROUTE]: ['POST', 'DELETE'],
  [PROJECT_CHECKPOINTS_ROUTE]: ['GET'],
  [PROJECT_RESTORE_ROUTE]: ['POST'],
  [PROJECT_FILES_ROUTE]: ['GET', 'PUT'],
};

/**
 * A revision as this product names one (`r` and eight hex digits, from
 * `GenerationMachine`), held to a shape that is safe in an R2 key rather
 * than to that one spelling, so a revision named some other way by an
 * older build is still one a person can restore.
 */
const REVISION = /^[A-Za-z0-9_-]{1,64}$/;

/** The code a restore made from an out-of-date history is refused with. */
export const CHECKPOINT_MOVED_CODE = 'checkpoint-moved';

interface RestoreRequest {
  revision: string;
  /** The accepted revision the caller was looking at; null for none. */
  base: string | null;
}

/** A restore's body: which checkpoint, and from which accepted revision. */
export function parseRestore(body: unknown): GuardResult<RestoreRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.revision !== 'string' || !REVISION.test(raw.revision)) {
    return fail(400, '"revision" is not a checkpoint.');
  }
  if (
    raw.base !== null &&
    (typeof raw.base !== 'string' || !REVISION.test(raw.base))
  ) {
    return fail(400, '"base" must be the accepted revision, or null.');
  }
  return { ok: true, value: { revision: raw.revision, base: raw.base } };
}

interface FileEdit {
  /** The accepted revision the edit was made against. */
  base: string;
  /** Written: added, or in place of a file already at the path. */
  files: ProjectFile[];
  /** Taken out of the project; each must be in it. */
  remove: string[];
  /**
   * Check and answer as an edit would, but accept nothing (D212): the
   * answer carries the code the edit would leave and the code it was made
   * against, and no checkpoint is made.
   */
  dryRun: boolean;
}

/**
 * An edit's body (D190): the files to write, the paths to delete, and the
 * revision they were made against. Every entry is checked before anything
 * is read, by the rules a project's own files are held to
 * (`parseProjectFiles`), and a path may be named once.
 */
export function parseFileEdit(body: unknown): GuardResult<FileEdit> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.base !== 'string' || !REVISION.test(raw.base)) {
    return fail(400, '"base" must be the accepted revision.');
  }
  const written = raw.files ?? [];
  const deleted = raw.delete ?? [];
  if (!Array.isArray(written)) return fail(400, '"files" must be a list.');
  if (!Array.isArray(deleted)) return fail(400, '"delete" must be a list.');
  if (written.length === 0 && deleted.length === 0) {
    return fail(400, 'Name at least one file to write or delete.');
  }
  const files = parseProjectFiles(written, DEFAULT_LIMITS);
  if (!files.ok) return files;
  if (deleted.length > DEFAULT_LIMITS.maxFiles) {
    return fail(
      413,
      `At most ${DEFAULT_LIMITS.maxFiles} files can be deleted at once.`,
    );
  }
  const remove: string[] = [];
  for (const path of deleted) {
    if (typeof path !== 'string') {
      return fail(400, 'Every path to delete must be a string.');
    }
    const problem = pathProblem(path);
    if (problem) return fail(400, problem);
    remove.push(path);
  }
  const named = new Set<string>();
  for (const path of [...files.value.map((file) => file.path), ...remove]) {
    if (named.has(path)) return fail(400, `"${path}" is named twice.`);
    named.add(path);
  }
  if (raw.dryRun !== undefined && typeof raw.dryRun !== 'boolean') {
    return fail(400, '"dryRun" must be true or false.');
  }
  return {
    ok: true,
    value: {
      base: raw.base,
      files: files.value,
      remove,
      dryRun: raw.dryRun === true,
    },
  };
}

/**
 * The accepted files with an edit applied: a file written over one at
 * the same path keeps its place, a new one goes at the end, and a deleted
 * one goes. A path to delete that is not in the project is refused rather
 * than ignored, since the caller believed it was there and is working
 * from something else.
 */
export function applyFileEdit(
  current: readonly ProjectFile[],
  edit: Pick<FileEdit, 'files' | 'remove'>,
): GuardResult<ProjectFile[]> {
  const byPath = new Map(current.map((file) => [file.path, file.content]));
  for (const path of edit.remove) {
    if (!byPath.has(path)) return fail(400, `"${path}" is not in the project.`);
  }
  const removed = new Set(edit.remove);
  const written = new Map(edit.files.map((file) => [file.path, file.content]));
  const files = current
    .filter((file) => !removed.has(file.path))
    .map((file) => ({
      path: file.path,
      content: written.get(file.path) ?? file.content,
    }));
  for (const file of edit.files) {
    if (!byPath.has(file.path)) files.push(file);
  }
  return { ok: true, value: files };
}

export async function handleProjects(
  request: Request,
  env: ProjectsEnv,
  deps: ProjectsDeps,
): Promise<Response> {
  if (!env.DB || !env.PROJECT_CONTENT) {
    return json(
      { error: 'Projects are not configured for this deployment.' },
      503,
    );
  }
  const db = env.DB;
  const { pathname } = new URL(request.url);
  const route = routeKeyFor(pathname);
  const method = request.method.toUpperCase();
  const allowed = ALLOWED[route];
  if (!allowed) return json({ error: 'Not found.' }, 404);
  if (!allowed.includes(method)) {
    return json({ error: `Use ${allowed.join(', ')}.` }, 405);
  }

  // Shape before identity, so a hostile request is refused before it costs
  // a token verification.
  const guarded =
    method === 'POST' || method === 'PATCH' || method === 'PUT'
      ? writeGuard(request)
      : method === 'DELETE'
        ? deleteGuard(request)
        : null;
  if (guarded) return guarded;

  const resolved = await deps.resolvePrincipal(request);
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;

  const clock = deps.now ?? (() => new Date());
  const now = () => clock().toISOString();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const tierOf =
    deps.tierOf ?? (async (who: string) => (await planOf(db, who)).tier);
  // The tier's limit, or an admin's override of it for this account (D73).
  const limitOf = async (who: string) =>
    projectLimitOf(db, who, await tierOf(who));
  const store = new ProjectStore(db, env.PROJECT_CONTENT);
  const links: ProjectLinks = deps.links ?? {
    origin: new URL(request.url).origin,
    publishHostname: DEFAULT_PUBLISH_HOSTNAME,
  };
  const view = (project: ProjectRecord) => projectView(project, links);
  const stopSharePreview = async (token: string | null) => {
    if (!token || !deps.stopSharePreview) return;
    // Best effort, and never a reason to refuse what was asked: the link is
    // already dead by the time this runs, and a preview nobody can reach
    // any more ends at its own lifetime anyway.
    await deps.stopSharePreview(token).catch((error: unknown) => {
      console.error('share preview could not be stopped', error);
    });
  };

  if (route === '/api/projects') {
    if (method === 'GET') {
      const [projects, tier, maxActive] = await Promise.all([
        store.list(userId),
        tierOf(userId),
        limitOf(userId),
      ]);
      return json({
        projects: projects.map(view),
        limits: {
          tier,
          active: projects.filter((project) => project.archivedAt === null)
            .length,
          maxActive,
        },
      });
    }

    const body = await readJson(request);
    if (!body.ok) return json({ error: body.error }, body.status);
    const raw = (body.value ?? {}) as Record<string, unknown>;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return json({ error: 'Body must be a JSON object.' }, 400);
    }
    let settings: ProjectSettings | undefined;
    if (raw.settings !== undefined) {
      const parsed = parseProjectSettings(raw.settings);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      settings = {
        style: null,
        referenceUrl: null,
        model: null,
        knowledge: null,
        styleDna: null,
        galleryStyle: null,
        galleryColors: null,
        ...parsed.value,
      };
    }
    const limit = await limitOf(userId);
    const id = newId();
    const created = await store.create(
      userId,
      {
        id,
        name: cleanProjectName(raw.name) ?? DEFAULT_PROJECT_NAME,
        now: now(),
        ...(settings ? { settings } : {}),
      },
      limit,
    );
    if (!created) return limitRefusal(limit!);
    const project = await store.find(userId, id);
    return json({ project: view(project!) }, 201);
  }

  const id = projectIdInPath(pathname);
  if (!isProjectId(id)) return NOT_FOUND();
  const project = await store.find(userId, id);
  if (!project) return NOT_FOUND();

  if (route === PROJECT_CHECKPOINTS_ROUTE) {
    const history = await new D1GenerationStore(
      db,
      env.PROJECT_CONTENT,
    ).listCheckpoints(project.id);
    return json(history);
  }

  if (route === PROJECT_RESTORE_ROUTE) {
    return restoreCheckpoint(
      request,
      userId,
      project,
      store,
      new D1GenerationStore(db, env.PROJECT_CONTENT),
      clock(),
      deps,
    );
  }

  if (route === PROJECT_FILES_ROUTE) {
    const generations = new D1GenerationStore(db, env.PROJECT_CONTENT);
    if (method === 'GET') {
      return readFiles(request, project, generations);
    }
    return editFiles(
      request,
      userId,
      project,
      store,
      generations,
      clock(),
      deps,
    );
  }

  if (route === PROJECT_DUPLICATE_ROUTE) {
    const limit = await limitOf(userId);
    const copy = await store.duplicate(
      project,
      userId,
      { id: newId(), name: copyName(project.name), now: now() },
      limit,
    );
    if (!copy) return limitRefusal(limit!);
    return json({ project: view(copy) }, 201);
  }

  if (route === PROJECT_SHARE_ROUTE) {
    if (method === 'DELETE') {
      await store.disableShare(userId, project.id);
      await stopSharePreview(project.share.token);
    } else {
      const outcome = await store.enableShare(
        userId,
        project.id,
        (deps.newToken ?? newShareToken)(),
        now(),
      );
      if (outcome === 'missing') return NOT_FOUND();
      if (outcome === 'held') {
        return json(
          {
            error:
              'This link has been turned off by the operator and cannot be turned on again. Write to the abuse address if you think this is a mistake.',
          },
          409,
        );
      }
      if (outcome === 'archived') {
        return json(
          {
            error: 'This project is archived. Unarchive it to share it.',
          },
          409,
        );
      }
    }
    const shared = await store.find(userId, project.id);
    return shared ? json({ project: view(shared) }) : NOT_FOUND();
  }

  if (method === 'GET') {
    // Opening is what orders the list, and what a builder with no project
    // in its address opens next time.
    const at = now();
    await store.touchOpened(userId, project.id, at);
    const [transcript, snapshot, build] = await Promise.all([
      store.readTranscript(project),
      store.accepted(project.id),
      // A build the page that started it did not see finish, which goes on
      // without it (docs/decisions.md, "Resolved 2026-09-29", keep
      // building): the builder shows it as still running and asks after it
      // until it ends. Never a reason to fail the open: the code and the
      // conversation are what matter most, and they do not depend on it.
      buildInFlight(
        store,
        new D1GenerationStore(db, env.PROJECT_CONTENT),
        userId,
        project.id,
        clock(),
        deps,
      ).catch((error: unknown) => {
        console.error('build in flight unreadable', error);
        return null;
      }),
    ]);
    return json({
      project: view({ ...project, lastOpenedAt: at }),
      transcript,
      // The accepted code, which is what the preview and the code view are
      // restored from. The revision comes with it because the next build
      // asserts it as its base (`handlePlan`), and a builder that restored
      // the files without it would have its first follow-up refused as a
      // conflict with its own project.
      snapshot: snapshot
        ? { revision: snapshot.revision, files: snapshot.files }
        : null,
      // Its Workflow instance id, which Stop and the builder's questions
      // name, and when it started; null for none.
      build,
    });
  }

  if (method === 'DELETE') {
    if (await store.runInFlight(project.id, clock())) {
      return json(
        {
          error:
            'A build is still running in this project. Wait for it to finish, then delete it.',
        },
        409,
      );
    }
    // The published site first, and the project only once it is down.
    //
    // The site is the project's, and deleting the project is the owner
    // saying the work should be gone; a site left serving would be the one
    // copy of it still in public, with nothing left in the builder that
    // reaches it. So a project whose site is live is not deleted until the
    // site is down, and if the takedown could not be done the owner is told
    // and nothing is deleted. A site that is held or already down is not
    // serving, and does not stand in the way. The slug itself is never
    // released (ADR-0010), so the name stays with this account.
    if (project.site?.state === 'live') {
      if (deps.takeDownSite) {
        await deps.takeDownSite(project.id).catch((error: unknown) => {
          console.error('project deletion: takedown failed', error);
        });
      }
      const after = await store.find(userId, project.id);
      if (after?.site?.state === 'live') {
        return json(
          {
            error: `This project's site at ${project.site.slug} is still online and could not be taken down. Take it down from the project, then delete it.`,
          },
          409,
        );
      }
    }
    // The project's own domain (D189), whether its site is live, held or
    // already down: a takedown keeps the domain, and nothing after the
    // deletion would reach it.
    if (deps.removeDomain && !(await deps.removeDomain(project.id))) {
      return json(
        {
          error:
            "This project's custom domain could not be disconnected. Try deleting it again shortly.",
        },
        502,
      );
    }
    // The link goes before the bytes, so a deletion that only gets part way
    // (a large project, below) does not leave a stranger looking at half of
    // it. The owner asked for all of it to go, the link included.
    if (project.share.token !== null) {
      await store.disableShare(userId, project.id);
      await stopSharePreview(project.share.token);
    }
    const removed = await store.remove(project.id);
    if (!removed) {
      return json(
        {
          error:
            'This project is large and was only partly deleted. Delete it again to finish.',
        },
        503,
      );
    }
    // Once more, now the project row is gone, for a domain a connect that
    // was already running recorded after the first pass. None can be
    // recorded from here on (`CustomDomainStore.add`). One Cloudflare could
    // not remove keeps its row, and the nightly check removes it there
    // (`sweepLapsedDomains`), since nothing here can reach it again.
    if (deps.removeDomain && !(await deps.removeDomain(project.id))) {
      console.error('project deletion: late custom domain left', project.id);
    }
    return json({ deleted: true });
  }

  // PATCH.
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const patch = parseProjectPatch(body.value);
  if (!patch.ok) return json({ error: patch.error }, patch.status);
  const at = now();
  const content =
    patch.value.settings !== undefined || patch.value.transcript !== undefined;
  const guard = patch.value.guard ?? null;

  // A save made from an older copy of the project, before anything else is
  // written, so the refused tab has changed nothing and is told why. The
  // store asks again as it writes, which is what decides a race; this is
  // for the common case of a tab that has simply been left open. Only the
  // settings and the conversation are versioned: a rename or an archive
  // overwrites nothing another tab saved, and is never refused for this.
  if (content && !mayReplace(project, guard)) {
    return changedRefusal(project.version);
  }

  // The one change that can be refused, first, so a refused unarchive
  // writes nothing else either and the builder is told plainly why.
  if (patch.value.archived === false && project.archivedAt !== null) {
    const limit = await limitOf(userId);
    const outcome = await store.unarchive(userId, project.id, at, limit);
    if (outcome === 'missing') return NOT_FOUND();
    if (outcome === 'limit') return limitRefusal(limit!);
  }
  if (patch.value.archived === true) {
    await store.archive(userId, project.id, at);
    // An archived project's link does not serve (`findShared`), so a live
    // preview a viewer started from it stops with it.
    await stopSharePreview(project.share.token);
  }
  if (patch.value.name !== undefined) {
    await store.rename(userId, project.id, patch.value.name, at);
  }
  if (patch.value.seo !== undefined) {
    await store.saveSeo(userId, project.id, patch.value.seo, at);
  }
  if (content) {
    const saved = await store.saveContent(
      userId,
      project.id,
      {
        ...(patch.value.settings !== undefined
          ? { settings: patch.value.settings }
          : {}),
        ...(patch.value.transcript !== undefined
          ? { transcript: patch.value.transcript }
          : {}),
      },
      at,
      guard,
    );
    if (saved.outcome === 'missing') return NOT_FOUND();
    if (saved.outcome === 'changed') return changedRefusal(saved.version);
  }
  const saved = await store.find(userId, project.id);
  return saved ? json({ project: view(saved) }) : NOT_FOUND();
}

/**
 * Make one of a project's accepted checkpoints the accepted one again
 * (D152), and answer with its code, as opening the project does, so the
 * builder can show it and build on it.
 *
 * Refused while a build runs in the project, for the reason a delete is:
 * the build would promote over the restored code or be refused as a
 * conflict, and either way the person would not get what they pressed.
 * Refused for an archived project, which is read-only until unarchived.
 * Refused when the accepted revision is no longer the one the caller was
 * looking at, so a restore chosen from a stale list never undoes work
 * another tab or a finished build has accepted since (D63's rule, applied
 * to code).
 *
 * Nothing here spends: no budget is reserved or charged, no trace is
 * written, and nothing is published or pushed. The published site and the
 * connected repository stay as they were until the person ships again.
 */
async function restoreCheckpoint(
  request: Request,
  userId: string,
  project: ProjectRecord,
  store: ProjectStore,
  generations: D1GenerationStore,
  now: Date,
  deps: ProjectsDeps,
): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = parseRestore(body.value);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { revision, base } = parsed.value;

  const archived = () =>
    json(
      {
        error:
          'This project is archived. Unarchive it to restore a checkpoint.',
      },
      409,
    );
  if (project.archivedAt !== null) return archived();
  const buildRunning = () =>
    json(
      {
        error:
          'A build is still running in this project. Wait for it to finish, then restore a checkpoint.',
      },
      409,
    );
  // Every run that has not ended, however long since its row moved, asked
  // of its Workflow: one still going refuses this, and one the engine
  // stopped without saying so is settled here, so it does not hold off the
  // batch below, which counts every unended row as a build (Codex review
  // of internal PR 360). `rollback` asks again in that batch, which is what decides a
  // build started in between.
  // An instance that cannot be read is taken to be running, for far longer
  // than the half hour a builder opening the project allows it: a restore
  // under a live build would cost that build its budget.
  if (
    await buildInFlight(
      store,
      generations,
      userId,
      project.id,
      now,
      deps,
      UNREADABLE_RUN_HELD_MS,
    )
  ) {
    return buildRunning();
  }
  const history = await generations.listCheckpoints(project.id);
  if (!history.checkpoints.some((entry) => entry.revision === revision)) {
    return json({ error: 'That checkpoint does not exist.' }, 404);
  }
  const moved = (current: string | null) =>
    json(
      {
        error:
          'This project has changed since its history was loaded. Look again, then restore.',
        code: CHECKPOINT_MOVED_CODE,
        current,
      },
      409,
    );

  // Already there: a retry of a restore whose answer was lost, or a second
  // press. What was asked for is true, so it is answered as done and
  // nothing is written.
  if (history.current === revision) {
    const snapshot = await generations.loadRevision(project.id, revision);
    if (!snapshot) {
      return json({ error: 'That checkpoint is no longer stored.' }, 404);
    }
    return json({
      snapshot: { revision: snapshot.revision, files: snapshot.files },
    });
  }
  // Asked here for the common case, a list left open while something else
  // moved the project; the compare-and-set in `rollback` decides a race.
  if (history.current !== base) return moved(history.current);

  const result = await generations.rollback(project.id, revision, base);
  if (result.outcome === 'busy') return buildRunning();
  if (result.outcome === 'archived') return archived();
  if (result.outcome === 'gone') return NOT_FOUND();
  if (result.outcome === 'missing') {
    return json({ error: 'That checkpoint is no longer stored.' }, 404);
  }
  if (result.outcome === 'stale') return moved(result.current);
  return json({
    snapshot: {
      revision: result.snapshot.revision,
      files: result.snapshot.files,
    },
  });
}

/**
 * The project's accepted code, or with `?revision=` one of the checkpoints
 * in its history (D190), as opening the project answers it.
 */
async function readFiles(
  request: Request,
  project: ProjectRecord,
  generations: D1GenerationStore,
): Promise<Response> {
  const wanted = new URL(request.url).searchParams.get('revision');
  if (wanted !== null && !REVISION.test(wanted)) {
    return json({ error: 'That checkpoint does not exist.' }, 404);
  }
  const history = await generations.listCheckpoints(project.id);
  const revision = wanted ?? history.current;
  if (revision === null) {
    return json({ error: 'This project has no code yet.' }, 404);
  }
  if (!history.checkpoints.some((entry) => entry.revision === revision)) {
    return json({ error: 'That checkpoint does not exist.' }, 404);
  }
  const snapshot = await generations.loadRevision(project.id, revision);
  if (!snapshot) {
    return json({ error: 'That checkpoint is no longer stored.' }, 404);
  }
  return json({
    snapshot: { revision: snapshot.revision, files: snapshot.files },
  });
}

/**
 * Write and delete files in a project's accepted code, with no build
 * (D190), and answer with the code that is accepted now, as a restore
 * does. How an assistant connected over `/mcp` edits a project.
 *
 * Held to what a restore is held to, for the same reasons: not while a
 * build runs in the project, not in an archived one, and only from the
 * revision that is accepted now (`base`), so an edit made from an older
 * read never undoes what a build or another tab accepted since. The
 * project it leaves is held to the limits a project sent to a build or a
 * preview is (`parseProjectFiles`), so it can still be built on.
 *
 * Nothing here spends: no model, no sandbox, no budget. The new revision
 * is stored, and joins the history as an `edit` checkpoint that can be
 * restored from like any other. Nothing is published or pushed.
 */
async function editFiles(
  request: Request,
  userId: string,
  project: ProjectRecord,
  store: ProjectStore,
  generations: D1GenerationStore,
  now: Date,
  deps: ProjectsDeps,
): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = parseFileEdit(body.value);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { base } = parsed.value;
  if (deps.editAllowed && !(await deps.editAllowed(userId))) {
    return json({ error: 'Too many file edits. Try again in a minute.' }, 429);
  }

  const archived = () =>
    json(
      {
        error: 'This project is archived. Unarchive it to edit its files.',
      },
      409,
    );
  if (project.archivedAt !== null) return archived();
  const buildRunning = () =>
    json(
      {
        error:
          'A build is still running in this project. Wait for it to finish, then edit its files.',
      },
      409,
    );
  // As a restore asks (`restoreCheckpoint`): every unended run, an
  // unreadable one held for longer, and the batch in `commitEdit` asks
  // again, which is what decides a build started in between.
  if (
    await buildInFlight(
      store,
      generations,
      userId,
      project.id,
      now,
      deps,
      UNREADABLE_RUN_HELD_MS,
    )
  ) {
    return buildRunning();
  }
  const moved = (current: string | null) =>
    json(
      {
        error:
          'This project has changed since its files were read. Read them again, then edit.',
        code: CHECKPOINT_MOVED_CODE,
        current,
      },
      409,
    );
  const accepted = await generations.loadAccepted(project.id);
  if (!accepted) {
    // No code to edit: the first build makes it. A project whose pointer
    // names a revision that is no longer stored is refused the same way
    // rather than edited from nothing.
    return json(
      { error: 'This project has no code yet. Build it first.' },
      409,
    );
  }
  if (accepted.revision !== base) return moved(accepted.revision);

  const merged = applyFileEdit(accepted.files, parsed.value);
  if (!merged.ok) return json({ error: merged.error }, merged.status);
  if (merged.value.length === 0) {
    return json({ error: 'A project needs at least one file.' }, 400);
  }
  const whole = parseProjectFiles(merged.value, DEFAULT_LIMITS);
  if (!whole.ok) {
    return json({ error: `After this edit: ${whole.error}` }, whole.status);
  }
  // A dry run (D212) stops here, after every check an edit makes but the
  // ones only the write itself can make (a build started in between, a
  // revision that collides). It answers with what the edit would leave and
  // what it was made against, so the caller can show the difference. The
  // draft's revision is a SHA-256 of its files with a `d`, never an `r`:
  // a preview it is put on cannot pass for one of accepted code, or of
  // another draft.
  if (parsed.value.dryRun) {
    return json({
      dryRun: true,
      snapshot: {
        revision: await draftRevision(whole.value),
        files: whole.value,
      },
      base: { revision: accepted.revision, files: accepted.files },
    });
  }
  // Nothing changed: what was asked for is already true, so it is answered
  // as done and nothing is written, as restoring the current checkpoint is.
  // Compared by content, since a revision is not always its files' hash (a
  // build older than `revisionFor`, or a copy).
  if (JSON.stringify(whole.value) === JSON.stringify(accepted.files)) {
    return json({
      snapshot: { revision: accepted.revision, files: accepted.files },
    });
  }
  const revision = revisionFor({ files: whole.value });

  const result = await generations.commitEdit(
    project.id,
    {
      revision,
      files: whole.value,
    },
    base,
  );
  if (result.outcome === 'busy') return buildRunning();
  if (result.outcome === 'archived') return archived();
  if (result.outcome === 'gone') return NOT_FOUND();
  if (result.outcome === 'stale') return moved(result.current);
  if (result.outcome === 'collision') {
    return json(
      {
        error:
          'These files could not be stored. Change anything in them, then try again.',
      },
      500,
    );
  }
  return json({
    snapshot: {
      revision: result.snapshot.revision,
      files: result.snapshot.files,
    },
  });
}

/** A dry run's draft revision (D212): `d` and 32 hex digits of SHA-256. */
async function draftRevision(files: ProjectFile[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(files)),
  );
  return `d${[...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
