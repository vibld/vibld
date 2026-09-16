/**
 * Who may use this deployment at all, decided apart from the database.
 *
 * Vibld grants model spend on sign-up, so an open door is a faucet pointed at
 * the provider bill. Before launch, an account can be created freely (Clerk
 * owns that) and can do nothing until its identity is on the invite list.
 *
 * Every rule here fails closed, and the mode does too: anything other than
 * the exact string "open" is invite-only, so a typo in a deployment variable
 * cannot open the door. That is the opposite of the usual default and it is
 * the point.
 */

export type AccessMode = 'invite' | 'open';

/**
 * The mode this deployment runs in.
 *
 * Unset means invite-only. A deployment that has never thought about this
 * question should be closed, not open, and opening it should take a
 * deliberate act by somebody who can set a variable.
 */
export function parseAccessMode(raw: string | undefined): AccessMode {
  // Compared raw. This trimmed and lowercased, so `OPEN`, ` open ` and
  // `Open` all opened the deployment while the comment above promised that
  // only the exact string could. Leniency here is the one place it cannot
  // be afforded: every accepted spelling is another way a mistyped
  // deployment variable opens the door, which is the failure this whole
  // module exists to make impossible.
  return raw === 'open' ? 'open' : 'invite';
}

export type AccessRefusal = 'not-invited' | 'unverified-identity';

export type AccessDecision =
  | { allowed: true; because: 'open' | 'admin' | 'invited' }
  | { allowed: false; because: AccessRefusal };

/**
 * Whether this caller may use the product.
 *
 * The order is the rule:
 *
 * 1. **A platform admin is always allowed**, before the mode is even read.
 *    An operator who locks themselves out of their own deployment has no way
 *    back in, because the tool that issues invites is behind this same gate.
 * 2. **An open deployment allows everyone**, including identities with no
 *    verified email. Open means open.
 * 3. **An unverified identity is refused**, because an invite list keyed on
 *    email means nothing if the email was never verified. `policyIdentity` is
 *    already 'unknown' in that case rather than a raw claim, so this is a
 *    check on the resolved identity, not on a header.
 * 4. Otherwise the list decides.
 */
export function decideAccess(input: {
  mode: AccessMode;
  isAdmin: boolean;
  /** `Principal.policyIdentity`: a verified email, or 'unknown'. */
  identity: string;
  invited: boolean;
}): AccessDecision {
  if (input.isAdmin) return { allowed: true, because: 'admin' };
  if (input.mode === 'open') return { allowed: true, because: 'open' };
  if (!isUsableIdentity(input.identity)) {
    return { allowed: false, because: 'unverified-identity' };
  }
  if (input.invited) return { allowed: true, because: 'invited' };
  return { allowed: false, because: 'not-invited' };
}

/** The sentinel `resolvePrincipal` uses when no verified email is present. */
export const UNKNOWN_IDENTITY = 'unknown';

export function isUsableIdentity(identity: string): boolean {
  return identity.trim().length > 0 && identity !== UNKNOWN_IDENTITY;
}

/**
 * An email as the invite list stores it.
 *
 * Lowercased and trimmed, so an invite issued to one spelling is found by
 * another. Returns null for anything that cannot be an address, which the
 * caller treats as a refusal rather than as an empty lookup.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * What a refused caller is told.
 *
 * The same sentence for both refusals, on purpose. "Your email is not
 * verified" and "you are not on the list" are different facts about the
 * account, and telling an anonymous caller which one applies turns this into
 * a way to test whether an address has been invited.
 */
export const REFUSED_MESSAGE =
  'This deployment is invite-only at the moment. Ask for access and you will be let in when the list opens.';
