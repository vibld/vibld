/**
 * The two routes that describe this API rather than being part of it
 * (D186): `/api/openapi.json`, the OpenAPI 3.1 document for every public
 * route, and `/api/health`, a liveness check. vibld.com's API catalog
 * (apps/marketing/worker/agent-discovery.ts) points at both.
 *
 * Neither identifies anybody or reads anything stored, so both are open to
 * any origin: an agent reading the description from another site is the
 * point of publishing it.
 */

import { OPENAPI } from './openapi.ts';
import type { PrincipalEnv } from './principal.ts';
import { signInMode, type SignInMode } from './sign-in-mode.ts';

const OPEN = {
  'access-control-allow-origin': '*',
} as const;

function readOnly(request: Request): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
    status: 405,
    headers: {
      ...OPEN,
      allow: 'GET, HEAD',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function body(request: Request, text: string): string | null {
  return request.method === 'HEAD' ? null : text;
}

const HOSTED = 'https://app.vibld.com';

/**
 * How a deployment signed in with something other than Clerk is called.
 * The owner's session is the cookie POST /api/auth/owner sets; Access puts
 * its token in a header on every request it lets through.
 */
const SCHEMES = {
  owner: {
    type: 'apiKey',
    in: 'cookie',
    name: 'vibld_owner',
    description:
      'The owner session this deployment sets after `createOwnerSession` (VIBLD_AUTH=owner).',
  },
  access: {
    type: 'apiKey',
    in: 'header',
    name: 'Cf-Access-Jwt-Assertion',
    description:
      'The token Cloudflare Access attaches to a request it lets through (VIBLD_AUTH=access). Its `CF_Authorization` cookie is accepted too.',
  },
} as const;

/** Every `{ clerk: [] }` requirement in `value`, named `scheme` instead. */
function signedInWith(value: unknown, scheme: string): unknown {
  if (Array.isArray(value)) return value.map((v) => signedInWith(v, scheme));
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0]![0] === 'clerk') {
    return { [scheme]: entries[0]![1] };
  }
  return Object.fromEntries(
    entries.map(([key, v]) => [
      key,
      key === 'securitySchemes' ? v : signedInWith(v, scheme),
    ]),
  );
}

const NOT_CONFIGURED =
  'This deployment has no sign-in configured, so every operation that names a security requirement answers 403 with `reason: "not-configured"` whatever it is sent. ';

/**
 * Owner and Access sign-in refuse a write with no `Origin` naming this
 * deployment (principal.ts, `sameOrigin`), so each secured write asks for
 * one. Clerk sign-in does not check it.
 */
const ORIGIN = {
  name: 'Origin',
  in: 'header',
  required: true,
  description:
    "This deployment's own origin. A write without it is refused 403 under owner or Access sign-in.",
  schema: { type: 'string', format: 'uri' },
} as const;

const WRITES = ['post', 'put', 'patch', 'delete'];

function withOrigin(document: unknown, scheme: string): unknown {
  const doc = document as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  const paths = Object.fromEntries(
    Object.entries(doc.paths).map(([path, item]) => [
      path,
      Object.fromEntries(
        Object.entries(item).map(([method, operation]) => {
          const security = operation.security as
            Record<string, unknown>[] | undefined;
          const parameters = (operation.parameters ?? []) as {
            name?: string;
            in?: string;
          }[];
          const secured = security?.some((req) => scheme in req) ?? false;
          const named = parameters.some(
            (p) => p.in === 'header' && p.name === 'Origin',
          );
          if (!WRITES.includes(method) || !secured || named) {
            return [method, operation];
          }
          return [
            method,
            { ...operation, parameters: [...parameters, ORIGIN] },
          ];
        }),
      ),
    ]),
  );
  return { ...doc, paths };
}

/**
 * The document as the deployment that served it answers: itself as
 * the server, so a client generated from a self-hosted or preview copy
 * calls that copy, and the sign-in that copy accepts in place of Clerk's.
 * A deployment with no sign-in configured says so rather than offering one
 * it cannot verify.
 */
export function describedBy(
  origin: string,
  mode: SignInMode | undefined,
): typeof OPENAPI {
  const served = {
    ...OPENAPI,
    // Elsewhere the server is `/`, which a client resolves against the URL it
    // fetched this document from. The origin the Worker sees can be `http:`
    // behind a proxy that terminated TLS (infrastructure/vps), and a client
    // told so would send its credentials in the clear.
    servers: [
      origin === HOSTED
        ? { url: HOSTED, description: 'The hosted builder' }
        : { url: '/', description: 'This deployment' },
    ],
  };
  if (mode === undefined) {
    return {
      ...served,
      info: {
        ...served.info,
        description: NOT_CONFIGURED + served.info.description,
      },
    } as typeof OPENAPI;
  }
  if (mode === 'clerk') return served;
  const swapped = withOrigin(
    signedInWith(served, mode),
    mode,
  ) as typeof OPENAPI;
  return {
    ...swapped,
    components: {
      ...swapped.components,
      securitySchemes: { [mode]: SCHEMES[mode] },
    },
  } as unknown as typeof OPENAPI;
}

/** The OpenAPI document, as `application/vnd.oai.openapi+json`. */
export function handleOpenApi(
  request: Request,
  env: PrincipalEnv = {},
): Response {
  const refused = readOnly(request);
  if (refused) return refused;
  const document = describedBy(new URL(request.url).origin, signInMode(env));
  return new Response(body(request, JSON.stringify(document)), {
    headers: {
      ...OPEN,
      'content-type': 'application/vnd.oai.openapi+json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

/**
 * Whether this Worker is answering: `{ "status": "ok" }`. A liveness check
 * only. It touches no binding, so it stays up when a dependency is down,
 * and says nothing about one.
 */
export function handleHealth(request: Request): Response {
  const refused = readOnly(request);
  if (refused) return refused;
  return new Response(body(request, JSON.stringify({ status: 'ok' })), {
    headers: {
      ...OPEN,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
