import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  describedBy,
  handleHealth,
  handleOpenApi,
} from '../worker/api-description.ts';
import { OPENAPI, UNDESCRIBED } from '../worker/openapi.ts';

/*
 * The description is written by hand, so these hold it to the router: a
 * route added without a description, or a description left behind by a
 * route that was removed, fails here rather than reaching an agent.
 */

const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));

async function routedPaths(): Promise<string[]> {
  const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
  return [
    ...new Set(
      [...source.matchAll(/pathname === '(\/api\/[^']+)'/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}

/** `/api/projects/:id` as OpenAPI writes it, `/api/projects/{id}`. */
function templated(path: string): string {
  return path.replace(/:([a-z]+)/g, '{$1}');
}

const HOSTED_ORIGIN = 'https://app.vibld.com';

/** A deployment signed in with Clerk, as app.vibld.com is. */
const CLERK = { CLERK_FRONTEND_API_URL: 'https://clerk.vibld.com' };

/** Every 401 description in a served document. */
function unauthorized(document: {
  paths: Record<string, Record<string, unknown>>;
}): string[] {
  const found: string[] = [];
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Record<string, unknown> })
        .responses;
      const refused = responses?.['401'] as
        { description?: string } | undefined;
      if (refused?.description) found.push(refused.description);
    }
  }
  return found;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

describe('the OpenAPI description', () => {
  it('describes every route the router has, apart from administration and deliveries', async () => {
    const routed = await routedPaths();
    assert.ok(routed.length > 40, `only found ${routed.length} routes`);
    const missing = routed.filter(
      (path) =>
        !path.startsWith('/api/admin/') &&
        !(path in UNDESCRIBED) &&
        !(templated(path) in OPENAPI.paths),
    );
    assert.deepEqual(missing, [], `undescribed: ${missing.join(', ')}`);
  });

  it('describes no route the router does not have', async () => {
    const routed = new Set((await routedPaths()).map(templated));
    const stale = Object.keys(OPENAPI.paths).filter(
      (path) => !routed.has(path),
    );
    assert.deepEqual(stale, [], `not routed: ${stale.join(', ')}`);
  });

  it('describes nothing it leaves out, and leaves out only what is routed', async () => {
    const routed = new Set(await routedPaths());
    for (const path of Object.keys(UNDESCRIBED)) {
      assert.ok(routed.has(path), `${path} is not routed`);
      assert.ok(!(path in OPENAPI.paths), `${path} is both`);
    }
    assert.ok(
      !Object.keys(OPENAPI.paths).some((path) =>
        path.startsWith('/api/admin/'),
      ),
    );
  });

  it('gives every operation an id, a summary, a tag and its responses', () => {
    const ids = new Set<string>();
    const tags = new Set(OPENAPI.tags.map((tag) => tag.name));
    for (const [path, item] of Object.entries(OPENAPI.paths)) {
      for (const method of METHODS) {
        const op = (item as Record<string, Record<string, unknown>>)[method];
        if (!op) continue;
        const where = `${method.toUpperCase()} ${path}`;
        assert.equal(typeof op.operationId, 'string', where);
        assert.ok(!ids.has(op.operationId as string), `${where}: duplicate id`);
        ids.add(op.operationId as string);
        assert.equal(typeof op.summary, 'string', where);
        for (const tag of op.tags as string[]) {
          assert.ok(tags.has(tag), `${where}: unknown tag ${tag}`);
        }
        assert.ok(
          Object.keys(op.responses as object).length > 0,
          `${where}: no responses`,
        );
      }
    }
    assert.ok(ids.size > 50, `only ${ids.size} operations`);
  });

  it('resolves every reference to a schema it defines', () => {
    const text = JSON.stringify(OPENAPI);
    const refs = new Set(
      [...text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(
        (match) => match[1]!,
      ),
    );
    const defined = OPENAPI.components.schemas as Record<string, unknown>;
    const broken = [...refs].filter((name) => !(name in defined));
    assert.deepEqual(broken, []);
  });

  it('requires a JSON body wherever the Worker refuses a write without one', () => {
    // project-handlers.ts runs writeGuard on every POST and PATCH, and
    // share-handlers.ts checks the origin on every POST: both answer 415
    // unless the request says it carries JSON. A generated client sends that
    // header only for a body the description says is required.
    const paths = OPENAPI.paths as Record<
      string,
      Record<string, { requestBody?: Record<string, unknown> }>
    >;
    const loose: string[] = [];
    for (const [path, item] of Object.entries(paths)) {
      if (!/^\/api\/(projects|share)\//.test(path)) continue;
      for (const method of ['post', 'patch']) {
        const operation = item[method];
        if (!operation) continue;
        const body = operation.requestBody as
          { required?: boolean; content?: Record<string, unknown> } | undefined;
        if (body?.required !== true || !body.content?.['application/json']) {
          loose.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    assert.deepEqual(loose, []);
  });

  it('asks the owner session writes for the Origin owner-auth.ts checks', () => {
    // sameOrigin refuses a POST or DELETE with no Origin header, so a
    // client generated without one could never sign in or out.
    const owner = (OPENAPI.paths as Record<string, Record<string, unknown>>)[
      '/api/owner/session'
    ]!;
    for (const method of ['post', 'delete']) {
      const { parameters } = owner[method] as {
        parameters: { name: string; in: string; required?: boolean }[];
      };
      assert.ok(
        parameters.some(
          (p) => p.name === 'Origin' && p.in === 'header' && p.required,
        ),
        method,
      );
    }
  });

  it('never offers the generic Error as one of exactly one choice', () => {
    // A specialized error extends Error, so a response matching it matches
    // Error too, and a oneOf with both rejects every such response.
    const overlapping: string[] = [];
    const visit = (value: unknown, at: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, `${at}/${i}`));
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, v] of Object.entries(value)) {
        if (
          key === 'oneOf' &&
          JSON.stringify(v).includes('"#/components/schemas/Error"')
        ) {
          overlapping.push(at);
        }
        visit(v, `${at}/${key}`);
      }
    };
    visit(OPENAPI.paths, '');
    assert.deepEqual(overlapping, []);
  });

  it('describes every field a preview status can carry', () => {
    const schemas = OPENAPI.components.schemas as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    assert.ok(schemas.PreviewStatus!.properties!.updatingTo);
  });

  it('carries no payment extension', () => {
    // D183: agent commerce is skipped, so nothing here asks to be paid.
    assert.doesNotMatch(JSON.stringify(OPENAPI), /x-payment/i);
  });
});

describe('the routes that describe the API', () => {
  it('serve the document to any origin', async () => {
    const response = handleOpenApi(
      new Request('https://app.vibld.com/api/openapi.json'),
      CLERK,
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'application/vnd.oai.openapi+json; charset=utf-8',
    );
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await response.json(), OPENAPI);
  });

  it('never advertises the scheme a proxy forwarded over', () => {
    // Traefik on the VPS terminates TLS and forwards over http.
    const document = describedBy('http://builder.example.com', 'owner');
    assert.doesNotMatch(JSON.stringify(document.servers), /http:/);
  });

  it('names the deployment that served it as the server', async () => {
    // A client generated from a self-hosted copy must not call the hosted
    // builder, least of all with that copy's owner password.
    const response = handleOpenApi(
      new Request('https://builder.example.com/api/openapi.json'),
      CLERK,
    );
    const document = (await response.json()) as typeof OPENAPI;
    assert.deepEqual(document.servers, [
      { url: '/', description: 'This deployment' },
    ]);
    assert.deepEqual(
      document,
      describedBy('https://builder.example.com', 'clerk'),
    );
  });

  it('asks for the sign-in the deployment accepts', async () => {
    const response = handleOpenApi(
      new Request('https://builder.example.com/api/openapi.json'),
      {
        VIBLD_AUTH: 'access',
        VIBLD_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        VIBLD_ACCESS_AUD: 'aud',
      },
    );
    const text = await response.text();
    assert.doesNotMatch(text, /"clerk"/);
    // Only the hosted builder's own sentence still names Clerk's header,
    // and no refusal blames a missing bearer token.
    assert.equal(text.match(/Authorization: Bearer/g)?.length, 1);
    for (const description of unauthorized(JSON.parse(text))) {
      assert.doesNotMatch(description, /bearer|authorization/i);
    }
    const document = JSON.parse(text) as {
      security: unknown;
      components: { securitySchemes: Record<string, { name: string }> };
    };
    assert.deepEqual(document.security, [{ access: [] }]);
    assert.deepEqual(Object.keys(document.components.securitySchemes), [
      'access',
    ]);
    assert.equal(
      document.components.securitySchemes.access!.name,
      'Cf-Access-Jwt-Assertion',
    );
    // Apart from the Origin each write now asks for, an operation reads as
    // it did, and one that names no sign-in still names none.
    const owner = JSON.parse(
      JSON.stringify(describedBy(HOSTED_ORIGIN, 'owner').paths),
    ) as Record<string, Record<string, { parameters?: { name: string }[] }>>;
    const expected = JSON.parse(
      JSON.stringify(OPENAPI.paths).replace(/"clerk":/g, '"owner":'),
    ) as typeof owner;
    for (const [path, item] of Object.entries(owner)) {
      for (const [method, operation] of Object.entries(item)) {
        const before = expected[path]![method]!.parameters;
        if (operation.parameters && before) {
          operation.parameters = operation.parameters.slice(0, before.length);
        }
      }
    }
    assert.deepEqual(owner, expected);
  });

  it('asks every secured write for the Origin owner and Access sign-in check', () => {
    // principal.ts refuses an owner or Access write with no Origin naming
    // this deployment; Clerk sign-in does not check it.
    for (const mode of ['owner', 'access'] as const) {
      const document = describedBy('https://builder.example.com', mode);
      const missing: string[] = [];
      let writes = 0;
      for (const [path, item] of Object.entries(
        document.paths as Record<string, Record<string, unknown>>,
      )) {
        for (const method of ['post', 'put', 'patch', 'delete']) {
          const operation = item[method] as
            | {
                security?: Record<string, unknown>[];
                parameters?: { name: string; in: string; required?: boolean }[];
              }
            | undefined;
          if (!operation?.security?.some((req) => mode in req)) continue;
          writes += 1;
          const origin = operation.parameters?.find(
            (p) => p.in === 'header' && p.name === 'Origin',
          );
          if (!origin?.required) missing.push(`${method} ${path}`);
        }
      }
      assert.ok(writes > 10, mode);
      assert.deepEqual(missing, [], mode);
    }
    const clerk = describedBy(HOSTED_ORIGIN, 'clerk');
    assert.doesNotMatch(
      JSON.stringify(clerk.paths['/api/projects']),
      /"Origin"/,
    );
  });

  it('says so when the deployment has no sign-in configured', async () => {
    const response = handleOpenApi(
      new Request('https://builder.example.com/api/openapi.json'),
      { VIBLD_AUTH: 'owner' },
    );
    const document = (await response.json()) as typeof OPENAPI;
    assert.match(document.info.description, /^This deployment has no sign-in/);
    assert.match(document.info.description, /not-configured/);
  });

  it('answer a health check without touching anything', async () => {
    const response = handleHealth(
      new Request('https://app.vibld.com/api/health'),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('answer HEAD with no body, and refuse a write', async () => {
    const head = handleHealth(
      new Request('https://app.vibld.com/api/health', { method: 'HEAD' }),
    );
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const post = handleOpenApi(
      new Request('https://app.vibld.com/api/openapi.json', { method: 'POST' }),
    );
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  });
});
