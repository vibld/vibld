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
}

/** What the shell assumes when it cannot find out. Closed, deliberately. */
export const UNKNOWN_ACCESS: AccessStatus = {
  allowed: false,
  mode: 'invite',
  message: null,
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
  if (typeof body !== 'object' || body === null) return UNKNOWN_ACCESS;
  const value = body as Partial<AccessStatus>;
  return {
    allowed: value.allowed === true,
    mode: value.mode === 'open' ? 'open' : 'invite',
    message: typeof value.message === 'string' ? value.message : null,
  };
}
