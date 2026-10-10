/**
 * What vibld.com tells an agent about the builder's API (D186): an API
 * catalog (RFC 9727) at `/.well-known/api-catalog`, and the same pointers as
 * `Link` headers on the home page (RFC 8288).
 *
 * The API itself is the builder's, on app.vibld.com; this site only says
 * where it is and where it is described. The description is the OpenAPI
 * document the builder serves, so the two cannot disagree about a route.
 */

/** The builder's API, the thing the catalog lists. */
export const API_BASE = 'https://app.vibld.com/api';
/** Its OpenAPI 3.1 description, served by the builder (apps/web). */
export const API_SPEC = 'https://app.vibld.com/api/openapi.json';
/** The media type that description is served as. */
export const API_SPEC_TYPE = 'application/vnd.oai.openapi+json';
/** A liveness check, answered without signing in. */
export const API_STATUS = 'https://app.vibld.com/api/health';
/** The guide for people, on this site. */
export const API_DOCS = '/docs/api';
/** Where the catalog itself is (RFC 9727 section 3). */
export const API_CATALOG_PATH = '/.well-known/api-catalog';
/** RFC 9727's profile, carried on the catalog's media type. */
const CATALOG_PROFILE = 'https://www.rfc-editor.org/info/rfc9727';

/** The catalog, as an RFC 9264 linkset, for a site served at `origin`. */
export function apiCatalog(origin: string): object {
  return {
    linkset: [
      {
        anchor: API_BASE,
        'service-desc': [{ href: API_SPEC, type: API_SPEC_TYPE }],
        'service-doc': [{ href: `${origin}${API_DOCS}`, type: 'text/html' }],
        status: [{ href: API_STATUS, type: 'application/json' }],
      },
    ],
  };
}

/**
 * The catalog's response. GET and HEAD only; HEAD carries the `Link` to the
 * catalog itself, as RFC 9727 section 3 asks of a well-known catalog.
 */
export function apiCatalogResponse(request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  const body = JSON.stringify(apiCatalog(new URL(request.url).origin), null, 2);
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': `application/linkset+json; profile="${CATALOG_PROFILE}"`,
      link: `<${API_CATALOG_PATH}>; rel="api-catalog"`,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}

/**
 * The home page's `Link` header: the catalog, the API's description and
 * guide, and the plain-language summary of the site for assistants.
 */
export const HOME_LINKS = [
  `<${API_CATALOG_PATH}>; rel="api-catalog"`,
  `<${API_SPEC}>; rel="service-desc"; type="${API_SPEC_TYPE}"`,
  `<${API_DOCS}>; rel="service-doc"; type="text/html"`,
  `</llms.txt>; rel="describedby"; type="text/plain"`,
].join(', ');

/** The home page's response with `HOME_LINKS` added; any other is unchanged. */
export function withHomeLinks(pathname: string, response: Response): Response {
  if (pathname !== '/' || !response.ok) return response;
  const linked = new Response(response.body, response);
  linked.headers.append('link', HOME_LINKS);
  return linked;
}

/** Who signs people in to vibld (D180): Clerk, on vibld's own domain. */
export const AUTHORIZATION_SERVER = 'https://clerk.vibld.com';

/**
 * The OAuth and OpenID Connect discovery paths answered here. Each one
 * redirects to the authorization server's own document at the same path:
 * the metadata names `https://clerk.vibld.com` as its issuer, and OIDC
 * Discovery 4.3 and RFC 8414 3.3 require a client to reject it when it was
 * fetched from any other origin, so it is never replayed on vibld.com.
 */
export const AUTHORIZATION_METADATA_PATHS = [
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
] as const;

export function isAuthorizationMetadataPath(pathname: string): boolean {
  return (AUTHORIZATION_METADATA_PATHS as readonly string[]).includes(pathname);
}

/** A redirect to Clerk's discovery document, at its own origin (D180). */
export function authorizationMetadata(request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  const { pathname } = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      location: `${AUTHORIZATION_SERVER}${pathname}`,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
