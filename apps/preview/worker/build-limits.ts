/**
 * What a build is given, and how long its lock outlives that.
 *
 * Their own module so the relationship between them can be asserted on the
 * real values rather than parsed back out of source: `preview-sandbox.ts`
 * imports `@cloudflare/sandbox` and cannot be loaded under `node --test`,
 * and this is arithmetic worth checking rather than describing. Same
 * reasoning as `build-sandbox.ts` beside it.
 */

/**
 * What each half of a build is given before it is abandoned.
 *
 * Bounded at all because the command is the generated project's to declare
 * (#196 review). `npm run build` is whatever its package.json says, and a
 * manifest naming a watch-mode script never returns: the build held its
 * lock forever, the lock aged out under a second build that then emptied
 * the workspace beneath the first, and the paid Workflow waiting on the
 * answer sat there until its own step timed out. None of that needs a bad
 * actor; one plausible wrong script does it.
 *
 * Generous against what they measure: an install and a production build of
 * a generated Vite project are a minute or two, and every build here starts
 * from an empty workspace, so the install is always a cold one.
 */
export const BUILD_INSTALL_TIMEOUT_MS = 5 * 60_000;
export const BUILD_COMPILE_TIMEOUT_MS = 5 * 60_000;

/**
 * How long a build lock is believed before the build holding it is treated
 * as gone.
 *
 * Strictly greater than the two bounds above, and that ordering is the
 * point rather than the number: a lock that expired while its own build was
 * still legitimately running is what let two builds share one workspace.
 * The slack covers everything between the timed commands -- writing the
 * project out, reading the output back -- and `build-limits.test.ts`
 * asserts the ordering, so neither half can be raised without the lock
 * being raised with it.
 */
export const BUILD_LOCK_TTL_MS = 15 * 60_000;
