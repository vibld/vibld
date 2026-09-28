/**
 * Where a project lives in the address bar.
 *
 * `/p/<id>` for an open project and `/projects` for the list, by path
 * rather than by query or fragment, for the reasons `use-pathname.ts`
 * gives for the admin page: the fragment belongs to the GitHub OAuth
 * callback, and the SPA fallback (`not_found_handling` in wrangler.jsonc)
 * already serves the shell on any path, so a reload of either reaches the
 * builder with no Worker change. A path is also what a share link will be
 * later, and it keeps the query string free for the things that already
 * use it (a referral code on arrival, Stripe's return).
 *
 * Pure, so the rules are testable without a DOM.
 */

/** The list of projects. */
export const PROJECTS_PATH = '/projects';

/** The address of one project. */
export function projectPath(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

/**
 * The project a path names, or null. A trailing slash is the same address,
 * as it is for the admin page; anything deeper is not a project.
 */
export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]!);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function isProjectsPath(pathname: string): boolean {
  return pathname === PROJECTS_PATH || pathname === `${PROJECTS_PATH}/`;
}

/**
 * The same address with a different path, keeping what follows it.
 *
 * Rewriting `/` to `/p/<id>` on load must not drop the fragment the GitHub
 * callback left there, or the query a Stripe return carries, before
 * whatever reads them has had the chance.
 */
export function withPath(
  location: { search: string; hash: string },
  pathname: string,
): string {
  return `${pathname}${location.search}${location.hash}`;
}
