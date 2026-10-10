import type { Principal } from './principal.ts';

/**
 * The bearer token on a request to `/mcp` (docs/decisions.md D182): an
 * OAuth access token Clerk issued to an assistant the person authorized,
 * checked with Clerk itself.
 *
 * Asked of Clerk's Backend API rather than verified locally, for two
 * reasons. It answers for both token formats Clerk can be set to issue (a
 * JWT, or an opaque `oat_` token), so the dashboard setting cannot quietly
 * turn every assistant away. And it says whether the token was revoked,
 * which a signature cannot: a person who removes an assistant's access in
 * their Clerk account has removed it here too, once the short cache below
 * runs out.
 *
 * A session token sent here is refused, as an OAuth token sent to the
 * builder's own API is (`principal.ts`): each kind opens one door.
 */

const VERIFY_URL =
  'https://api.clerk.com/v1/oauth_applications/access_tokens/verify';

/**
 * The scope a token must carry to use `/mcp`. A Clerk custom scope (Clerk
 * Dashboard, OAuth applications, Scopes tab), given to assistants that
 * register themselves as a default scope for dynamic clients. Signing in
 * to some other app with vibld grants `openid` or `profile`, never this,
 * so such a token cannot start builds or spend credit.
 */
export const MCP_SCOPE = 'build';

/** How long a token Clerk vouched for is taken on trust. */
export const VERIFIED_TTL_MS = 60_000;
/** Bounds the cache, which lives as long as the isolate does. */
const MAX_CACHED = 500;

export interface McpCaller {
  principal: Principal;
  /** The OAuth client the person authorized: which assistant this is. */
  clientId: string;
  scopes: string[];
}

export type McpAuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; reason: 'missing' | 'invalid' | 'insufficient_scope' }
  | {
      ok: false;
      reason: 'unavailable';
      /** Seconds Clerk asked to wait, when it was throttling. */
      retryAfter?: number;
    };

const cache = new Map<string, { caller: McpCaller; until: number }>();

/** Test seam: forget what was verified. */
export function resetMcpTokenCache(): void {
  cache.clear();
}

async function digest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function bearerOf(request: Request): string | undefined {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

/**
 * What Clerk's answer says, read field by field. Anything that is not a
 * live token for a user (`user_...`), issued for this server (`resource`,
 * the RFC 8707 audience a client names when it signs in), is not one,
 * whatever else it carries: a token meant for another API is not replayed
 * here.
 */
export function callerFromVerification(
  body: unknown,
  resource: string,
): McpCaller | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.revoked === true || record.expired === true) return null;
  if (!Array.isArray(record.aud) || !record.aud.includes(resource)) {
    return null;
  }
  const subject = record.subject;
  if (typeof subject !== 'string' || !/^user_[A-Za-z0-9]+$/.test(subject)) {
    return null;
  }
  const clientId =
    typeof record.client_id === 'string' && record.client_id !== ''
      ? record.client_id
      : null;
  if (!clientId) return null;
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : typeof record.scope === 'string'
      ? record.scope.split(/\s+/).filter(Boolean)
      : [];
  return {
    // No email. Model policy and platform admin status are keyed on a
    // verified email (L4), and an assistant acting for somebody gets
    // neither: 'unknown' is the shared bucket that grants nothing beyond
    // the plan (`Principal.policyIdentity`).
    principal: {
      userId: subject,
      policyIdentity: 'unknown',
      viaAssistant: true,
    },
    clientId,
    scopes,
  };
}

/** When Clerk says the token expires, in milliseconds; undefined if never. */
export function expiryOf(body: unknown): number | undefined {
  const expiration = (body as Record<string, unknown> | null)?.expiration;
  if (typeof expiration !== 'number' || !Number.isFinite(expiration)) {
    return undefined;
  }
  // Clerk gives seconds; a value already in milliseconds is taken as is.
  return expiration < 1e12 ? expiration * 1000 : expiration;
}

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

export async function verifyMcpToken(
  request: Request,
  env: { CLERK_SECRET_KEY?: string },
  /** This server's canonical URI, which the token's audience must name. */
  resource: string,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<McpAuthResult> {
  const token = bearerOf(request);
  if (!token) return { ok: false, reason: 'missing' };
  // Opaque tokens only: Clerk cannot revoke a JWT access token, so one
  // would keep starting builds for a day after the person disconnected the
  // assistant. Clerk is set to issue opaque ones (docs/mcp-server.md).
  if (JWT_SHAPE.test(token)) return { ok: false, reason: 'invalid' };
  if (!env.CLERK_SECRET_KEY) return { ok: false, reason: 'unavailable' };
  const now = (deps.now ?? Date.now)();
  // Per resource: a token checked for one origin's `/mcp` is not thereby
  // good for another's.
  const key = await digest(`${resource}\n${token}`);
  const cached = cache.get(key);
  if (cached && cached.until > now) return permitted(cached.caller);
  if (cached) cache.delete(key);

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(VERIFY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ access_token: token }),
    });
  } catch (error) {
    console.error('Clerk token verification unreachable', error);
    return { ok: false, reason: 'unavailable' };
  }
  // Clerk answers an unknown, expired or revoked token with a 4xx; a 5xx is
  // Clerk being unwell, and a 429 its Backend API limit, neither of which
  // is the caller's fault, and they are said so: signing in again would not
  // help.
  if (response.status === 429) {
    const wait = Number(response.headers.get('Retry-After'));
    return {
      ok: false,
      reason: 'unavailable',
      ...(Number.isInteger(wait) && wait > 0 ? { retryAfter: wait } : {}),
    };
  }
  // A 401 or 403 is Clerk refusing this server's own secret key, not the
  // caller's token (an unknown token is a 400 or 404): the same outage for
  // every caller, which no new sign-in fixes.
  if (
    response.status >= 500 ||
    response.status === 401 ||
    response.status === 403
  ) {
    if (response.status < 500) {
      console.error('Clerk refused the secret key', response.status);
    }
    return { ok: false, reason: 'unavailable' };
  }
  if (!response.ok) return { ok: false, reason: 'invalid' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const caller = callerFromVerification(body, resource);
  if (!caller) return { ok: false, reason: 'invalid' };
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  // Trusted for the cache's minute or until the token expires, whichever
  // is sooner.
  const expiry = expiryOf(body);
  if (expiry !== undefined && expiry <= now) {
    return { ok: false, reason: 'invalid' };
  }
  cache.set(key, {
    caller,
    until: Math.min(now + VERIFIED_TTL_MS, expiry ?? Infinity),
  });
  return permitted(caller);
}

/** A real token for a person is still not one for `/mcp` without the scope. */
function permitted(caller: McpCaller): McpAuthResult {
  return caller.scopes.includes(MCP_SCOPE)
    ? { ok: true, caller }
    : { ok: false, reason: 'insufficient_scope' };
}
