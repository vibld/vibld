/**
 * The platform-admin settings page: where it lives, and what it shows.
 *
 * These tools used to sit in the composer, under the style controls, on
 * every admin's every session. `builder-layout.test.ts` records what that
 * cost: the composer grew past a viewport it had been told not to scroll,
 * and the model picker and the controls beneath it became unreachable. They
 * are also not building tools. Granting somebody credit or taking a site
 * down is not part of writing a prompt, and putting it there meant an admin
 * could not use the product the way everybody else does.
 *
 * So they have a page. Deciding what that page shows is pure and lives
 * here, apart from the component, because the interesting case is a timing
 * one and a test of it should not need a DOM.
 */

/** The one path that is not the builder. */
export const ADMIN_PATH = '/admin';

/**
 * Whether a path asks for the admin page.
 *
 * A trailing slash is the same request: people type it, and browsers and
 * link-shorteners add it. Anything deeper is not this page.
 */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`;
}

/**
 * What the page renders, given what is known about the caller.
 *
 * Three states, not two, and the third is the point. `isAdmin` reaches the
 * shell from the `/api/config` probe, which is a fetch: for the first
 * moments of every page load nobody has answered yet. Reading that silence
 * as "no" would tell an admin who opened this page directly that their own
 * page does not exist, and then replace it under them a heartbeat later.
 * `null` is that silence, and it is rendered as the wait it is.
 *
 * None of this is a security control. Every `/api/admin/*` route checks the
 * caller itself at the trusted boundary (ADR-0006); this only decides what
 * is worth drawing.
 */
export type AdminPageView = 'checking' | 'denied' | 'admin';

export function adminPageView(isAdmin: boolean | null): AdminPageView {
  if (isAdmin === null) return 'checking';
  return isAdmin ? 'admin' : 'denied';
}
