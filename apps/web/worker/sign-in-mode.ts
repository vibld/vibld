/**
 * Which sign-in a deployment is configured for (docs/decisions.md D123).
 *
 * Kept apart from principal.ts, and free of anything but owner-auth.ts,
 * because scripts/access-preflight.ts reaches it through platform-admins.ts
 * and runs in the deploy before dependencies are installed. principal.ts
 * pulls in the stores and @vibld/core; importing it from here broke every
 * deploy after internal PR 337 ("Cannot find package '@vibld/core'").
 */

import { ownerConfigured } from './owner-auth.ts';
import type { PrincipalEnv } from './principal.ts';

export type SignInMode = 'clerk' | 'owner' | 'access';

/**
 * The sign-in this deployment is configured for, or undefined when it is
 * configured for none. Undefined means every protected endpoint refuses,
 * never "open" -- an unauthenticated endpoint on a public URL lets anyone
 * spend the account's model budget, so the failure has to be closed. A
 * VIBLD_AUTH naming a mode that is not fully configured, or no mode at all,
 * is undefined too: a typo is not a way to switch sign-in off.
 */
export function signInMode(env: PrincipalEnv): SignInMode | undefined {
  const named = env.VIBLD_AUTH?.trim().toLowerCase();
  if (!named) return env.CLERK_FRONTEND_API_URL ? 'clerk' : undefined;
  if (named === 'clerk') {
    return env.CLERK_FRONTEND_API_URL ? 'clerk' : undefined;
  }
  if (named === 'owner') return ownerConfigured(env) ? 'owner' : undefined;
  if (named === 'access') {
    return env.VIBLD_ACCESS_TEAM_DOMAIN?.trim() && env.VIBLD_ACCESS_AUD?.trim()
      ? 'access'
      : undefined;
  }
  return undefined;
}
