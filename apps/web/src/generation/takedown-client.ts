import { getClerkToken } from '../auth/clerk-token.ts';
import { shareTokenFromLink } from '../projects/share-route.ts';

/**
 * The operator's takedown, from the browser (internal issue 172).
 *
 * JSX-free for the same reason `publish-client.ts` is: this project's test
 * runner strips TypeScript types only and errors on JSX. `SiteTakedown.tsx`
 * is the half that calls this from React.
 *
 * Separate from `admin-client.ts` because it acts on a published site rather
 * than on an account, and the two have nothing in common but the gate in
 * front of them.
 */

/** What a site is doing, as the publish service reports it. */
export type SiteState = 'live' | 'down' | 'held';

export type TakedownResult =
  | {
      ok: true;
      /** The site's slug, or for a share link, the link as it was named. */
      slug: string;
      state: SiteState;
      /** Whether what was acted on is a project's share link. */
      share?: true;
    }
  | { ok: false; error: string };

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(response: Response): Promise<string> {
  const problem: unknown = await response.json().catch(() => null);
  return typeof problem === 'object' &&
    problem !== null &&
    typeof (problem as { error?: unknown }).error === 'string'
    ? (problem as { error: string }).error
    : `The takedown request failed (${response.status}).`;
}

function isSiteState(value: unknown): value is SiteState {
  return value === 'live' || value === 'down' || value === 'held';
}

async function call(
  path: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
  getToken: () => Promise<string | null>,
): Promise<TakedownResult> {
  const response = await fetchImpl(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const parsed: unknown = await response.json();
    const record = (parsed ?? {}) as {
      slug?: unknown;
      share?: unknown;
      state?: unknown;
    };
    if (typeof record.slug === 'string' && isSiteState(record.state)) {
      return { ok: true, slug: record.slug, state: record.state };
    }
    if (typeof record.share === 'string' && isSiteState(record.state)) {
      return {
        ok: true,
        slug: body.share ?? record.share,
        state: record.state,
        share: true,
      };
    }
    // Reporting a takedown that the server never confirmed is the one
    // outcome worth guarding: somebody stops checking.
    return {
      ok: false,
      error: 'The publish service returned an unexpected response.',
    };
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
    };
  }
}

/**
 * What was named: a published site's slug, or a project's share link.
 *
 * One field for both in the panel, because an abuse report carries one
 * address and the operator should not have to work out which kind it is
 * first. A share link is read the way the Worker reads it
 * (`shareTokenFromLink`): the whole address, or the token alone. Anything
 * else is a slug.
 */
function target(named: string): Record<string, string> {
  return shareTokenFromLink(named) ? { share: named } : { slug: named };
}

/**
 * Take a published site, or a project's share link, off the web. The
 * reason is required.
 */
export function holdSite(
  slug: string,
  reason: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<TakedownResult> {
  return call(
    '/api/admin/publish/hold',
    { ...target(slug), reason },
    fetchImpl,
    getToken,
  );
}

/**
 * Lift a hold. This does not by itself put the site back: a site whose owner
 * had also taken it down stays down, which is the store's rule and the right
 * one -- releasing returns the decision to whoever else has a say.
 */
export function releaseSite(
  slug: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<TakedownResult> {
  return call('/api/admin/publish/release', target(slug), fetchImpl, getToken);
}
