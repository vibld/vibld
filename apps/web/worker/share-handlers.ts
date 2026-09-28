import { remixName } from '@vibld/core';

import {
  SHARE_PREVIEW_ROUTE,
  SHARE_REMIX_ROUTE,
  SHARE_VIEW_ROUTE,
  routeKeyFor,
  shareTokenInPath,
} from './access-gate.ts';
import { BillingStore } from './billing-store.ts';
import { SUSPENDED_MESSAGE } from './spendable.ts';
import { ACTIVE_PROJECT_LIMIT, tierFor } from './entitlement.ts';
import type { Tier } from './entitlement.ts';
import {
  MediaRoomError,
  copyMediaForRemix,
  removeCopies,
} from './media-copy.ts';
import type { PreviewStatus } from './preview-client.ts';
import type { PrincipalDenied, PrincipalGranted } from './principal.ts';
import { PROJECT_LIMIT_CODE, projectView } from './project-handlers.ts';
import type { ProjectLinks } from './project-handlers.ts';
import { ProjectStore } from './project-store.ts';
import type { ProjectRecord } from './project-store.ts';
import { checkRequestOrigin } from './request-guard.ts';
import {
  isShareToken,
  sharePreviewKey,
  shareTokenFromLink,
} from './share-link.ts';

/**
 * A project's share link, from the side of whoever holds it
 * (docs/decisions.md, "Resolved 2026-09-28", sharing).
 *
 *     GET  /api/share/:token          the shared project: its name and its
 *                                     accepted code, read-only
 *     GET  /api/share/:token/preview  the live preview's state
 *     POST /api/share/:token/preview  start the live preview (signed in)
 *     POST /api/share/:token/remix    copy it into the caller's account
 *
 * The owner's half, turning the link on and off, is on the project's own
 * routes (`/api/projects/:id/share`, `project-handlers.ts`).
 *
 * **Nobody is identified to read the link.** The view and the preview's
 * state are for whoever the owner sent the link to, who may have no
 * account, so the token is the whole of the authorisation there, the way a
 * preview share link's signature is (L10). What that asks of this file is
 * that the token be the only way in (`ProjectStore.findShared`, which is
 * also where every reason a link stops working is decided), that a request
 * which names a dead link learns nothing about why, and that a stranger
 * cannot make the link cost more than it should: every such request is
 * counted against the caller's address (`SHARE_BURST`) before the database
 * is read.
 *
 * **What a stranger is shown.** The project's name, because it is the
 * project's and the owner chose to share the project; its accepted code,
 * which is what the link is for; and whether a live preview can be run.
 * Not the owner's id, name or email, not the project's id, not when it was
 * made or last opened, not its settings and not its conversation. The
 * settings do travel with a remix (below), and the owner is told so where
 * they turn the link on.
 *
 * **The live preview runs in one sandbox per link, started on request.**
 * Not a sandbox per viewer, which would make a link that travelled cost a
 * container for every person who opened it; and not a static render,
 * because a generated project is a Vite and React app whose page is
 * whatever its code draws, and there is nothing to render without running
 * it. Nothing starts until somebody presses the button, the way the
 * builder's own preview waits to be asked, and only somebody signed in can
 * press it (docs/decisions.md, 2026-09-28): starting spends container time,
 * and an account is what a start is counted against (`SHARE_PREVIEW_BURST`,
 * per user, on top of the per-address count), refused while that account is
 * suspended or leaving, and traceable to somebody if a link is abused to
 * keep sandboxes busy. Every viewer of the link, signed in or not, is then
 * shown the same sandbox (`sharePreviewKey`), which serves the owner's
 * media restricted to the files the code references, exactly as the
 * owner's own preview does; and it lives the preview's usual thirty minutes
 * (L9) in the same container budget, queueing like any other preview when
 * the budget is spent. It spends no model money. It is stopped when the
 * link stops for a reason somebody is present for (the owner turning it
 * off, archiving or deleting the project, an operator's hold, the account's
 * deletion), and otherwise ends at its lifetime.
 *
 * **A remix copies the accepted code and the settings, not the
 * conversation.** The link shows the code and the preview; the
 * conversation is the owner talking to the agent, which they never showed
 * anybody, and copying it into a stranger's account would reveal exactly
 * what the link was careful not to. The media the code uses is copied into
 * the remixer's library (`media-copy.ts`), so the remix depends on nothing
 * of the owner's. It is a new project in the caller's account, held to the
 * free tier's limit like any other.
 */

export interface ShareEnv {
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
  /** Per address, on every route here that nobody signs in for. */
  SHARE_BURST?: RateLimit;
  /** Per caller, on a remix: it copies code and media into R2. */
  REMIX_BURST?: RateLimit;
  /**
   * Per caller, on starting a link's live preview: a sandbox's time. On top
   * of `SHARE_BURST`, which counts the same request against its address.
   */
  SHARE_PREVIEW_BURST?: RateLimit;
}

/** The preview service, narrowed to what a share link uses. */
export interface SharePreview {
  start(
    key: string,
    files: { path: string; content: string }[],
    mediaOwner: string,
  ): Promise<PreviewStatus>;
  status(key: string): Promise<PreviewStatus | null>;
}

export interface ShareDeps {
  resolvePrincipal: (
    request: Request,
  ) => Promise<PrincipalDenied | PrincipalGranted>;
  /** Null when this deployment has no preview service. */
  preview: SharePreview | null;
  links: ProjectLinks;
  now?: () => Date;
  newId?: () => string;
  tierOf?: (userId: string) => Promise<Tier>;
  /**
   * Whether an account is suspended. Defaults to the reading every paid
   * route makes (`BillingStore.isSuspended`).
   */
  isSuspended?: (userId: string) => Promise<boolean>;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // A link that was turned off must stop answering at once, not when a
  // cache somewhere decides it is stale.
  'cache-control': 'no-store',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * One answer for every dead link: off, held, archived, deleted, an owner
 * suspended or leaving, or a token that never existed. Telling them apart
 * would tell a stranger something about somebody else's account.
 */
const GONE = () =>
  json({ error: 'This link is not active. Ask whoever sent it.' }, 404);

const ALLOWED: Record<string, readonly string[]> = {
  [SHARE_VIEW_ROUTE]: ['GET'],
  [SHARE_PREVIEW_ROUTE]: ['GET', 'POST'],
  [SHARE_REMIX_ROUTE]: ['POST'],
};

/**
 * The address a request came from, for the per-address limit. Cloudflare
 * sets `CF-Connecting-IP` on every request that reaches the Worker, the
 * same header `IP_BURST` keys on in `handlePlan`.
 */
function addressOf(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/**
 * Whether a limiter lets this through. Fails open on the limiter itself
 * being unavailable, the rule every other limiter in this Worker keeps: an
 * outage of a speed bump is not a reason to refuse everybody.
 */
async function within(limiter: RateLimit | undefined, key: string) {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (error) {
    console.error('share rate limiter unavailable', error);
    return true;
  }
}

export async function handleShare(
  request: Request,
  env: ShareEnv,
  deps: ShareDeps,
): Promise<Response> {
  if (!env.DB || !env.PROJECT_CONTENT) {
    return json(
      { error: 'Sharing is not configured for this deployment.' },
      503,
    );
  }
  const { pathname } = new URL(request.url);
  const route = routeKeyFor(pathname);
  const method = request.method.toUpperCase();
  const allowed = ALLOWED[route];
  if (!allowed) return json({ error: 'Not found.' }, 404);
  if (!allowed.includes(method)) {
    return json({ error: `Use ${allowed.join(', ')}.` }, 405);
  }

  if (method === 'POST') {
    const origin = checkRequestOrigin(
      request.headers,
      new URL(request.url).origin,
    );
    if (!origin.ok) return json({ error: origin.error }, origin.status);
  }

  // A remix is somebody signed in, and is counted against them after they
  // are identified. Everything else is counted against the address before
  // the database is read, so a flood of guesses costs the flood.
  if (route !== SHARE_REMIX_ROUTE) {
    if (!(await within(env.SHARE_BURST, `share:${addressOf(request)}`))) {
      return json({ error: 'Too many requests. Try again shortly.' }, 429);
    }
  }

  const token = shareTokenInPath(pathname);
  if (!isShareToken(token)) return GONE();

  const store = new ProjectStore(env.DB, env.PROJECT_CONTENT);
  const clock = deps.now ?? (() => new Date());

  if (route === SHARE_REMIX_ROUTE) {
    return remix(request, env, deps, store, token, clock);
  }

  const project = await store.findShared(token);
  if (!project) return GONE();

  if (route === SHARE_VIEW_ROUTE) {
    const snapshot = await store.accepted(project.id);
    return json({
      project: { name: project.name },
      snapshot: snapshot
        ? { revision: snapshot.revision, files: snapshot.files }
        : null,
      livePreview: deps.preview !== null && snapshot !== undefined,
    });
  }

  // The live preview.
  if (!deps.preview) {
    return json(
      { error: 'Live previews are not available on this deployment.' },
      503,
    );
  }
  const key = await sharePreviewKey(token);
  if (method === 'GET') {
    const status = await deps.preview.status(key);
    return status
      ? json(status)
      : json(
          { error: 'The preview service returned an unreadable response.' },
          502,
        );
  }
  // Starting it needs somebody signed in (docs/decisions.md, 2026-09-28).
  // Identity refuses an account that has asked to be deleted
  // (`principal.ts`); a suspended one is refused here, since a suspension
  // stops what an account may start and identity does not read it.
  const resolved = await deps.resolvePrincipal(request);
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;
  const suspended =
    deps.isSuspended ??
    ((who: string) => new BillingStore(env.DB!).isSuspended(who));
  if (await suspended(userId)) {
    return json({ error: SUSPENDED_MESSAGE, reason: 'account-suspended' }, 403);
  }
  if (!(await within(env.SHARE_PREVIEW_BURST, `share-preview:${userId}`))) {
    return json(
      { error: 'Too many live previews started. Try again shortly.' },
      429,
    );
  }
  const snapshot = await store.accepted(project.id);
  if (!snapshot) {
    return json(
      { error: 'There is nothing to preview in this project yet.' },
      409,
    );
  }
  return json(await deps.preview.start(key, snapshot.files, project.userId));
}

/**
 * An operator stopping a share link, or lifting that (the share half of
 * `/api/admin/publish/hold` and `/release`, which have already checked the
 * caller is a platform admin).
 *
 * Named by the link as the report carried it (`shareTokenFromLink`). A
 * hold is recorded with who and why, and stops the link's live preview if
 * one is running, so the content stops being reachable at once rather than
 * at the end of the sandbox's lifetime. A release says whether the link is
 * serving again, which it is only if its owner has not turned it off in
 * the meantime.
 *
 * The answer is shaped like a site's (`state`: held, live or down), so the
 * admin panel reads both the same way; `share` carries the token in place
 * of a slug.
 */
export async function handleShareHold(
  env: ShareEnv,
  request: {
    link: unknown;
    reason: unknown;
    by: string;
    release: boolean;
    now: string;
    /** Null where there is no preview service, so nothing can be running. */
    stopPreview: ((token: string) => Promise<void>) | null;
  },
): Promise<Response> {
  if (!env.DB || !env.PROJECT_CONTENT) {
    return json(
      { error: 'Sharing is not configured for this deployment.' },
      503,
    );
  }
  const token =
    typeof request.link === 'string' ? shareTokenFromLink(request.link) : null;
  if (!token) {
    return json({ error: 'That is not a share link.' }, 400);
  }
  const store = new ProjectStore(env.DB, env.PROJECT_CONTENT);

  if (request.release) {
    const lifted = await store.releaseShare(token, request.by, request.now);
    if (lifted === 'missing') {
      return json({ error: 'No project has that share link.' }, 404);
    }
    if (lifted === 'not-held') {
      return json({ error: 'This share link is not held.' }, 409);
    }
    return json({ share: token, state: lifted.on ? 'live' : 'down' });
  }

  if (typeof request.reason !== 'string' || request.reason.trim() === '') {
    return json({ error: 'Say why this share link is being taken down.' }, 400);
  }
  const held = await store.holdShare(
    token,
    request.by,
    request.reason.trim(),
    request.now,
  );
  if (!held) return json({ error: 'No project has that share link.' }, 404);
  if (request.stopPreview) {
    await request.stopPreview(token).catch((error: unknown) => {
      console.error('held share preview could not be stopped', error);
    });
  }
  return json({ share: token, state: 'held' });
}

async function remix(
  request: Request,
  env: ShareEnv,
  deps: ShareDeps,
  store: ProjectStore,
  token: string,
  clock: () => Date,
): Promise<Response> {
  const resolved = await deps.resolvePrincipal(request);
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;

  if (!(await within(env.REMIX_BURST, `remix:${userId}`))) {
    return json({ error: 'Too many remixes. Try again shortly.' }, 429);
  }

  const source = await store.findShared(token);
  if (!source) return GONE();

  const tierOf =
    deps.tierOf ??
    (async (who: string) =>
      tierFor(await new BillingStore(env.DB!).findActiveSubscription(who)));
  const limit = ACTIVE_PROJECT_LIMIT[await tierOf(userId)];
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = clock().toISOString();
  const id = newId();

  // Within one account the library is already the remixer's, so there is
  // nothing to copy and nothing that could depend on somebody else.
  const crossAccount = source.userId !== userId;
  let copied: string[] = [];
  let copy: ProjectRecord | null;
  try {
    copy = await store.duplicate(
      source,
      userId,
      { id, name: remixName(source.name), now },
      limit,
      {
        transcript: false,
        ...(crossAccount
          ? {
              prepare: async (snapshot) => {
                const result = await copyMediaForRemix(
                  env.DB!,
                  env.PROJECT_CONTENT!,
                  source.userId,
                  userId,
                  snapshot,
                  { newId, now },
                );
                copied = result.copied;
                return result.snapshot;
              },
            }
          : {}),
      },
    );
  } catch (error) {
    // The project was removed by `duplicate`; the media it had copied was
    // not, since the library is not the project's. Taken back here, so a
    // remix that did not land leaves nothing in the remixer's library
    // either.
    await removeCopies(env.DB!, env.PROJECT_CONTENT!, userId, copied);
    if (error instanceof MediaRoomError) {
      return json({ error: error.message, code: 'media-room' }, 409);
    }
    throw error;
  }
  if (!copy) {
    return json(
      {
        error: `A free account can have ${limit} active projects. Archive one to make room for this remix, or upgrade for unlimited projects.`,
        code: PROJECT_LIMIT_CODE,
        limit,
      },
      403,
    );
  }
  return json({ project: projectView(copy, deps.links) }, 201);
}
