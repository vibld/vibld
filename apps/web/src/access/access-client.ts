import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Whether this account may use the product, as the shell asks it.
 *
 * The endpoint is the boundary, not this: every route that spends anything
 * re-checks independently (ADR-0006). This only decides which screen to
 * render, so a caller who tampered with the answer gets a builder whose every
 * action refuses, not access to anything.
 */
export interface AccessStatus {
  allowed: boolean;
  mode: 'invite' | 'open';
  message: string | null;
  /**
   * Whether this is an answer at all.
   *
   * "You are not on the list" and "we could not find out" both keep the
   * builder shut, and for that purpose they are the same. They are not the
   * same thing to say to a person. Collapsing them told an invited customer,
   * during a blip that lasted seconds, that their account was on a waiting
   * list -- a statement about them that was false, on a screen with no way
   * to try again.
   *
   * So the unknown keeps its own flag rather than borrowing the refusal.
   * False means the endpoint did not answer, or answered something that was
   * not a status.
   */
  decided: boolean;
}

/** What the shell assumes when it cannot find out. Closed, deliberately. */
export const UNKNOWN_ACCESS: AccessStatus = {
  allowed: false,
  mode: 'invite',
  message: null,
  decided: false,
};

/**
 * Fails closed on purpose.
 *
 * An unreachable status endpoint means an unknown answer, and the wrong way
 * to resolve an unknown is to show somebody a builder that will refuse every
 * action they take in it.
 */
export async function fetchAccess(): Promise<AccessStatus> {
  try {
    const token = await getClerkToken();
    const response = await fetch('/api/access/status', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return UNKNOWN_ACCESS;
    return readAccess(await response.json());
  } catch {
    return UNKNOWN_ACCESS;
  }
}

/** Parsed rather than trusted: this is model-adjacent JSON over the wire. */
export function readAccess(body: unknown): AccessStatus {
  // An array is an object and is not a status. Without that clause a `[]`
  // body came back as a decided refusal, which is the same mistake in
  // miniature: something that answered nothing counted as an answer.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return UNKNOWN_ACCESS;
  }
  const value = body as Partial<AccessStatus>;
  return {
    allowed: value.allowed === true,
    mode: value.mode === 'open' ? 'open' : 'invite',
    message: typeof value.message === 'string' ? value.message : null,
    // The endpoint answered, and this is what it said. A body that is not an
    // object never reaches here: it returned above, undecided, because
    // something that is not a status is not a refusal either.
    decided: true,
  };
}
