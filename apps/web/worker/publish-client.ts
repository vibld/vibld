/**
 * Talks to `@vibld/preview`'s build step and `@vibld/publish`'s publish
 * step over their own service bindings (ADR-0010). Two separate Workers,
 * two separate calls -- this file is the only place in `apps/web` that
 * knows the shape of either internal API for auto-publish.
 */

import { budgeted, withinDeadline } from '@vibld/core';
import type { ProjectFile } from '@vibld/core';

/** The slice of a Workers service binding this file calls. Same shape preview-client.ts already declares. */
export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface PublishServiceEnv {
  PREVIEW?: ServiceBinding;
  PREVIEW_INTERNAL_SECRET?: string;
  PUBLISH?: ServiceBinding;
  PUBLISH_INTERNAL_SECRET?: string;
}

export function autoPublishConfigured(env: PublishServiceEnv): boolean {
  return Boolean(
    env.PREVIEW &&
    env.PREVIEW_INTERNAL_SECRET &&
    env.PUBLISH &&
    env.PUBLISH_INTERNAL_SECRET,
  );
}

/**
 * What taking a site down needs, which is less than publishing does.
 *
 * Publishing builds first, so it needs apps/preview as well. A takedown
 * builds nothing. Asking for the build service anyway would mean that
 * turning preview off, or losing its secret, leaves every already-published
 * site up with its owner answered 503 by the only control that removes one.
 * A fail-closed check has to fail closed on the thing it is actually about.
 */
export function publishServiceConfigured(env: PublishServiceEnv): boolean {
  return Boolean(env.PUBLISH && env.PUBLISH_INTERNAL_SECRET);
}

const INTERNAL_ORIGIN = 'https://internal.invalid';

/**
 * Why a build produced nothing, carried across the service boundary.
 *
 * A copy of `@vibld/preview`'s own list rather than an import: the two
 * Workers are separate deployments that talk over a service binding and
 * share no build, the same reason `ServiceBinding` is declared here rather
 * than imported. `parseBuildResult` checks the wire value against it, so
 * the copy cannot drift into accepting something the other side never
 * sends, and `build-reasons.test.ts` compares the two lists, so it cannot
 * drift into rejecting something the other side does.
 *
 * The list is the source and the type is derived from it (#196 review).
 * Written the other way round, as a union with a `readonly
 * BuildFailureReason[]` beside it, a member added to the union and
 * forgotten in the list compiled perfectly: the wire value would then be
 * discarded as unrecognised, and a failure the other side had named
 * exactly would reach `worthRepairing` as no evidence at all.
 */
export const BUILD_FAILURE_REASONS = [
  'busy',
  'install',
  'build',
  'output',
  'sandbox',
] as const;

export type BuildFailureReason = (typeof BUILD_FAILURE_REASONS)[number];

export type BuildResult =
  | { ok: true; files: ProjectFile[]; skipped: string[] }
  | { ok: false; error: string; reason?: BuildFailureReason };

/**
 * `@vibld/preview`'s own reply is trusted content -- it is our other
 * Worker, not a caller -- but every field is still checked, same discipline
 * `preview-client.ts`'s `parseStatus` already applies.
 */
function parseBuildResult(body: unknown): BuildResult {
  const record = (body ?? {}) as {
    files?: unknown;
    skipped?: unknown;
    error?: unknown;
    reason?: unknown;
  };
  if (Array.isArray(record.files)) {
    const files = record.files.filter(
      (entry): entry is ProjectFile =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ProjectFile).path === 'string' &&
        typeof (entry as ProjectFile).content === 'string',
    );
    if (files.length > 0) {
      return {
        ok: true,
        files,
        skipped: Array.isArray(record.skipped)
          ? record.skipped.filter(
              (entry): entry is string => typeof entry === 'string',
            )
          : [],
      };
    }
  }
  // Absent rather than guessed when the wire value is not one this knows.
  // A caller deciding whether to spend a model call on a repair reads the
  // absence as "no evidence about the project" and does nothing, which is
  // the safe direction: the alternative is inventing a reason and spending
  // somebody's money on it (#194).
  const reason = BUILD_FAILURE_REASONS.find((known) => known === record.reason);
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'The build service returned an unexpected response.',
    ...(reason ? { reason } : {}),
  };
}

export async function buildProject(
  env: PublishServiceEnv,
  userId: string,
  files: ProjectFile[],
): Promise<BuildResult> {
  const response = await env.PREVIEW!.fetch(
    new Request(new URL('/internal/preview/build', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PREVIEW_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, files }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The build service returned an unreadable response.',
    };
  }
  return parseBuildResult(body);
}

export type PublishResult =
  | { ok: true; slug: string; url: string }
  | { ok: false; error: string; status: number };

export async function publishProject(
  env: PublishServiceEnv,
  userId: string,
  projectId: string,
  slug: string | undefined,
  files: ProjectFile[],
): Promise<PublishResult> {
  const response = await env.PUBLISH!.fetch(
    new Request(new URL('/internal/publish', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, projectId, slug, files }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    };
  }
  const record = (body ?? {}) as {
    slug?: unknown;
    url?: unknown;
    error?: unknown;
  };
  if (
    response.ok &&
    typeof record.slug === 'string' &&
    typeof record.url === 'string'
  ) {
    return { ok: true, slug: record.slug, url: record.url };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not publish this project.',
    // Pass through a meaningful status (400/403/409) rather than
    // collapsing every failure to 502 -- a slug conflict or an invalid
    // slug is the caller's to fix, not this service's own error.
    status:
      response.status >= 400 && response.status < 500 ? response.status : 502,
  };
}

export type UnpublishResult =
  { ok: true; slug: string } | { ok: false; error: string; status: number };

/**
 * Take this project's published site off the web (ADR-0013).
 *
 * No build step, unlike publishing: there is nothing to make, only
 * something to stop serving. Ownership is checked again on the other side
 * -- apps/web knows who is asking, apps/publish knows whose slug this is --
 * so a caller cannot take down somebody else's site by naming their
 * project.
 */
export async function unpublishProject(
  env: PublishServiceEnv,
  userId: string,
  projectId: string,
): Promise<UnpublishResult> {
  const response = await env.PUBLISH!.fetch(
    new Request(new URL('/internal/unpublish', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, projectId }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    };
  }
  const record = (body ?? {}) as { slug?: unknown; error?: unknown };
  if (response.ok && typeof record.slug === 'string') {
    return { ok: true, slug: record.slug };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not take this project down.',
    // Same rule publishing uses: a 403 or a 404 is the caller's answer, not
    // this service failing.
    status:
      response.status >= 400 && response.status < 500 ? response.status : 502,
  };
}

export type HoldResult =
  | { ok: true; slug: string; state: 'held' | 'live' | 'down' }
  | { ok: false; error: string; status: number };

/**
 * Take somebody else's published site off the web, or put the decision back
 * (#172). Called only from the platform-admin routes.
 *
 * `by` and `reason` travel because a takedown of work that is not yours is
 * the clearest case of the auditable action SECURITY.md asks for, and the
 * store is where that record belongs.
 */
async function holdCall(
  env: PublishServiceEnv,
  path: '/internal/hold' | '/internal/release',
  body: Record<string, string>,
): Promise<HoldResult> {
  const response = await env.PUBLISH!.fetch(
    new Request(new URL(path, INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_INTERNAL_SECRET}`,
      },
      body: JSON.stringify(body),
    }),
  );
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    };
  }
  const record = (parsed ?? {}) as {
    slug?: unknown;
    state?: unknown;
    error?: unknown;
  };
  if (
    response.ok &&
    typeof record.slug === 'string' &&
    (record.state === 'held' ||
      record.state === 'live' ||
      record.state === 'down')
  ) {
    return { ok: true, slug: record.slug, state: record.state };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not change this site.',
    status:
      response.status >= 400 && response.status < 500 ? response.status : 502,
  };
}

export function holdProject(
  env: PublishServiceEnv,
  slug: string,
  by: string,
  reason: string,
): Promise<HoldResult> {
  return holdCall(env, '/internal/hold', { slug, by, reason });
}

export function releaseProject(
  env: PublishServiceEnv,
  slug: string,
  by: string,
): Promise<HoldResult> {
  return holdCall(env, '/internal/release', { slug, by });
}

/**
 * How long one call to the build service may stay pending (#196 review).
 *
 * `build` catches a rejection and reports `unavailable`, which claims
 * nothing about the project. A call that never rejects never reaches that
 * catch: the Durable Object or its storage stalls, the await sits there,
 * and the enclosing step eventually times out, which fails a Workflow whose
 * project was already accepted, promoted, settled and billed. The caller
 * loses the run over a build they never asked for. The catch was the right
 * answer to the wrong half of the problem.
 *
 * Longer than a build's own wall clock in `apps/preview`, deliberately: the
 * service bounds its whole build and answers within that, so anything
 * beyond it is the service not answering rather than a build still working.
 * Cutting off a build that was about to reply would turn a real verdict
 * into `unavailable` and lose the repair this feature exists to buy.
 *
 * `repair-timeout.test.ts` checks that against `apps/preview`'s real
 * number, and checks that two of these plus the rebuild wait still fit
 * inside `REPAIR_BUILD_ALLOWANCE_MS`.
 */
export const BUILD_CALL_TIMEOUT_MS = 13 * 60_000;

export const REBUILD_WAIT_INTERVAL_MS = 5_000;
export const REBUILD_WAIT_ATTEMPTS = 6;
export const REBUILD_WAIT_BUDGET_MS =
  REBUILD_WAIT_INTERVAL_MS * REBUILD_WAIT_ATTEMPTS;

/**
 * One call to the build service, bounded, where no answer and a rejection
 * are the same fact (#196 review).
 *
 * A pending promise reaches no catch, so the deadline is what turns a
 * build service that will not answer into one that says nothing about the
 * project, which is what a service that rejects already said. Both land
 * on `undefined`, and the caller reports `unavailable` rather than failing
 * a Workflow whose project was accepted, promoted, settled and billed.
 *
 * `within` is how much of a caller's budget is left, and the smaller of
 * the two bounds wins. Separated from the step so a test can hand it a
 * call that never answers and watch it give up: inside the step it closed
 * over a service binding, and nothing could reach it.
 */
export async function buildWithin<T>(
  run: () => Promise<T>,
  within: number,
): Promise<T | undefined> {
  try {
    return await withinDeadline(run(), budgeted(BUILD_CALL_TIMEOUT_MS, within));
  } catch {
    return undefined;
  }
}

/**
 * Asking a busy workspace again, out of one budget for the asking
 * (#196 review).
 *
 * A function rather than a loop inside the step, for the reason four other
 * findings on this pull request ended the same way: a test that cannot
 * call the thing ends up measuring the text around it. The build it asks
 * with is unreachable from a test (it holds a service binding), so the
 * budget arithmetic had nothing exercising it and the fake could not even
 * observe the cap each call was given. Here `ask` is a parameter and the
 * cap is its argument.
 *
 * The count bounds the sleeping, the clock bounds the rest, and the last
 * check is why both are needed: nothing is started that the budget cannot
 * also finish, because sleeping out the last of it and asking again spends
 * the wait to get `unavailable` for it, which is a worse answer than the
 * refusal already in hand.
 */
export async function askWhileBusy<T>(
  ask: (within: number) => Promise<T>,
  busy: (answer: T) => boolean,
  clock: { wait: (ms: number) => Promise<void>; now: () => number },
): Promise<T> {
  const deadline = clock.now() + BUILD_CALL_TIMEOUT_MS + REBUILD_WAIT_BUDGET_MS;
  const left = () => deadline - clock.now();
  let answer = await ask(left());
  for (let asked = 0; asked < REBUILD_WAIT_ATTEMPTS; asked += 1) {
    if (!busy(answer)) break;
    if (left() <= REBUILD_WAIT_INTERVAL_MS) break;
    await clock.wait(REBUILD_WAIT_INTERVAL_MS);
    answer = await ask(left());
  }
  return answer;
}
