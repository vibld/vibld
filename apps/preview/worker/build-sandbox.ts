/**
 * Which sandbox instance a build runs in: not the one this user's preview
 * runs in.
 *
 * Every other route in `index.ts` names the instance by the user's own id,
 * which is how L9's "1 concurrent preview per user" is enforced without any
 * code of its own (see `preview-sandbox.ts`). A build is not a preview and
 * is not counted by that rule, and sharing the instance meant a build was
 * refused as `busy` for as long as a preview was live. The Workspace keeps
 * a preview running across submissions and nothing stops it on submit, so
 * that was the ordinary follow-up edit rather than a rare race: it switched
 * off #194's build verification for exactly the readers who were iterating
 * hardest, and it made stopping the preview a precondition of publishing
 * (#196 review).
 *
 * Its own module so it can be read under `node --test`: `index.ts` imports
 * `@cloudflare/sandbox` and cannot be loaded there, and this is one line
 * that is worth asserting on directly rather than through the source.
 *
 * Prefixed rather than suffixed so the name cannot collide with a user's
 * own however `normalizeId` rewrites it: every name this returns begins
 * with `build`, and a Clerk user id begins with `user_`.
 */
export function buildSandboxName(userId: string): string {
  return `build:${userId}`;
}
