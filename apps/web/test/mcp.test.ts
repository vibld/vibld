import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { DesignTemplateName } from '@vibld/ai/design-template-index';

import {
  callerFromVerification,
  resetMcpTokenCache,
  verifyMcpToken,
} from '../worker/mcp-auth.ts';
import type { McpCaller } from '../worker/mcp-auth.ts';
import {
  MCP_METADATA_PATH,
  SERVER_INFO,
  TOOLS,
  handleMcpMessage,
  mcpUnauthorized,
  negotiateVersion,
  protectedResourceMetadata,
  readBuildStart,
} from '../worker/mcp-server.ts';
import type { ApiAnswer, McpDeps } from '../worker/mcp-server.ts';
import { McpBuildStore } from '../worker/mcp-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const USER = 'user_2abc123';
const PROJECT = '11111111-2222-4333-8444-555555555555';
const RUN = '99999999-8888-4777-8666-555555555555';

const CALLER: McpCaller = {
  principal: { userId: USER, policyIdentity: 'unknown' },
  clientId: 'client_assistant',
  scopes: ['build'],
};

const TEMPLATES: DesignTemplateName[] = [
  {
    id: 'bakery-landing',
    name: 'Crumb',
    summary: 'Bakery landing page with menu and opening hours',
    kind: 'site',
    useCase: 'marketing' as DesignTemplateName['useCase'],
    category: 'Food and drink',
    format: 'design' as DesignTemplateName['format'],
    batch: 'b1',
    addedOn: '2026-10-01',
  },
  {
    id: 'crm-dashboard',
    name: 'Pipeline',
    summary: 'CRM dashboard with deals and contacts',
    kind: 'app',
    useCase: 'saas' as DesignTemplateName['useCase'],
    category: 'CRM',
    format: 'design' as DesignTemplateName['format'],
    batch: 'b1',
    addedOn: '2026-10-01',
  },
];

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function deps(
  overrides: Partial<McpDeps> & {
    routes?: Record<string, ApiAnswer>;
  } = {},
) {
  const calls: Call[] = [];
  const builds: unknown[] = [];
  const recorded: { runId: string; projectId: string }[] = [];
  const reserved: string[] = [];
  const released: string[] = [];
  const routes = overrides.routes ?? {};
  const value: McpDeps = {
    caller: CALLER,
    appOrigin: 'https://app.vibld.com',
    siteOrigin: 'https://vibld.com',
    templates: TEMPLATES,
    dailyBuildLimit: 20,
    api: async (method, path, body) => {
      calls.push({ method, path, ...(body !== undefined ? { body } : {}) });
      return (
        routes[`${method} ${path}`] ?? {
          status: 404,
          body: { error: 'Not found.' },
        }
      );
    },
    startBuild: async (body) => {
      builds.push(body);
      return { ok: true, runId: RUN };
    },
    reserveBuild: async () => {
      reserved.push('place-1');
      return 'place-1';
    },
    confirmBuild: async (place, runId, projectId) => {
      recorded.push({ runId, projectId });
      assert.equal(place, 'place-1');
    },
    releaseBuild: async (place) => {
      released.push(place);
    },
    buildBurstAllowed: async () => true,
    ...overrides,
  };
  return { value, calls, builds, recorded, reserved, released };
}

function rpc(body: unknown): Request {
  return new Request('https://app.vibld.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callTool(
  d: McpDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; value: Record<string, unknown> }> {
  const response = await handleMcpMessage(
    rpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    d,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    id: number;
    result: { isError: boolean; content: { type: string; text: string }[] };
  };
  assert.equal(body.id, 7);
  return {
    isError: body.result.isError,
    value: JSON.parse(body.result.content[0]!.text) as Record<string, unknown>,
  };
}

describe('the MCP token check', () => {
  beforeEach(() => resetMcpTokenCache());
  const RESOURCE = 'https://app.vibld.com/mcp';

  it('reads a live token for a user', () => {
    assert.deepEqual(
      callerFromVerification(
        {
          subject: USER,
          client_id: 'client_x',
          scopes: ['profile'],
          aud: [RESOURCE],
          revoked: false,
          expired: false,
        },
        RESOURCE,
      ),
      {
        principal: {
          userId: USER,
          policyIdentity: 'unknown',
          viaAssistant: true,
        },
        clientId: 'client_x',
        scopes: ['profile'],
      },
    );
  });

  it('refuses a revoked, expired, client-less, non-user or other-audience token', () => {
    const live = {
      subject: USER,
      client_id: 'client_x',
      scopes: [],
      aud: [RESOURCE],
    };
    const read = (body: unknown) => callerFromVerification(body, RESOURCE);
    assert.ok(read(live));
    assert.equal(read({ ...live, revoked: true }), null);
    assert.equal(read({ ...live, expired: true }), null);
    assert.equal(read({ ...live, client_id: undefined }), null);
    assert.equal(read({ ...live, subject: 'org_123' }), null);
    assert.equal(read({ ...live, aud: ['https://api.example.com'] }), null);
    assert.equal(read({ ...live, aud: undefined }), null);
    assert.equal(read(null), null);
  });

  it('trusts a token no longer than until it expires', async () => {
    let calls = 0;
    let now = 1_000_000_000;
    const fetchImpl = (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          subject: USER,
          client_id: 'client_x',
          scopes: ['build'],
          aud: [RESOURCE],
          expiration: (now + 10_000) / 1000,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const request = new Request(RESOURCE, {
      headers: { Authorization: 'Bearer oat_short' },
    });
    const env = { CLERK_SECRET_KEY: 'sk_test_x' };
    const check = () =>
      verifyMcpToken(request, env, RESOURCE, { fetchImpl, now: () => now });
    assert.ok((await check()).ok);
    now += 5_000;
    assert.ok((await check()).ok);
    assert.equal(calls, 1);
    now += 6_000;
    await check();
    assert.equal(calls, 2, 'asked again once the token had expired');
  });

  it('does not carry a token checked for one origin to another', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          subject: USER,
          client_id: 'client_x',
          scopes: ['build'],
          aud: [RESOURCE],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const request = new Request(RESOURCE, {
      headers: { Authorization: 'Bearer oat_one_origin' },
    });
    const env = { CLERK_SECRET_KEY: 'sk_test_x' };
    assert.ok((await verifyMcpToken(request, env, RESOURCE, { fetchImpl })).ok);
    assert.deepEqual(
      await verifyMcpToken(request, env, 'https://other.example/mcp', {
        fetchImpl,
      }),
      { ok: false, reason: 'invalid' },
    );
  });

  it('asks Clerk with the secret, then trusts the answer for a minute', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          subject: USER,
          client_id: 'client_x',
          scopes: ['build'],
          aud: [RESOURCE],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const request = new Request('https://app.vibld.com/mcp', {
      headers: { Authorization: 'Bearer oat_abc' },
    });
    let now = 1_000_000;
    const env = { CLERK_SECRET_KEY: 'sk_test_x' };
    const first = await verifyMcpToken(request, env, RESOURCE, {
      fetchImpl,
      now: () => now,
    });
    assert.ok(first.ok);
    assert.equal(seen.length, 1);
    assert.match(seen[0]!.url, /oauth_applications\/access_tokens\/verify$/);
    assert.equal(
      new Headers(seen[0]!.init.headers).get('Authorization'),
      'Bearer sk_test_x',
    );
    assert.deepEqual(JSON.parse(seen[0]!.init.body as string), {
      access_token: 'oat_abc',
    });
    now += 30_000;
    assert.ok(
      (
        await verifyMcpToken(request, env, RESOURCE, {
          fetchImpl,
          now: () => now,
        })
      ).ok,
    );
    assert.equal(seen.length, 1);
    now += 60_000;
    assert.ok(
      (
        await verifyMcpToken(request, env, RESOURCE, {
          fetchImpl,
          now: () => now,
        })
      ).ok,
    );
    assert.equal(seen.length, 2);
  });

  it('refuses a real token that was not granted the build scope', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          subject: USER,
          client_id: 'client_x',
          scopes: ['openid', 'profile', 'email'],
          aud: [RESOURCE],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const request = new Request('https://app.vibld.com/mcp', {
      headers: { Authorization: 'Bearer oat_login_only' },
    });
    const env = { CLERK_SECRET_KEY: 'sk_test_x' };
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(
        await verifyMcpToken(request, env, RESOURCE, { fetchImpl }),
        {
          ok: false,
          reason: 'insufficient_scope',
        },
      );
    }
    const response = mcpUnauthorized(
      'https://app.vibld.com',
      'insufficient_scope',
    );
    assert.equal(response.status, 403);
    assert.equal(
      response.headers.get('WWW-Authenticate'),
      `Bearer error="insufficient_scope", resource_metadata="https://app.vibld.com${MCP_METADATA_PATH}", scope="build"`,
    );
  });

  it('refuses a JWT access token, which Clerk cannot revoke', async () => {
    let asked = 0;
    const fetchImpl = (async () => {
      asked++;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const request = new Request(RESOURCE, {
      headers: { Authorization: 'Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl' },
    });
    assert.deepEqual(
      await verifyMcpToken(
        request,
        { CLERK_SECRET_KEY: 'sk_test_x' },
        RESOURCE,
        {
          fetchImpl,
        },
      ),
      { ok: false, reason: 'invalid' },
    );
    assert.equal(asked, 0);
  });

  it('tells a bad token from Clerk being unwell', async () => {
    const request = new Request('https://app.vibld.com/mcp', {
      headers: { Authorization: 'Bearer nope' },
    });
    const env = { CLERK_SECRET_KEY: 'sk_test_x' };
    const answer = (status: number) =>
      (async () => new Response('{}', { status })) as unknown as typeof fetch;
    assert.deepEqual(
      await verifyMcpToken(request, env, RESOURCE, { fetchImpl: answer(404) }),
      { ok: false, reason: 'invalid' },
    );
    assert.deepEqual(
      await verifyMcpToken(request, env, RESOURCE, { fetchImpl: answer(400) }),
      { ok: false, reason: 'invalid' },
    );
    // Clerk refusing this server's secret key: no sign-in fixes that.
    for (const status of [401, 403]) {
      assert.deepEqual(
        await verifyMcpToken(request, env, RESOURCE, {
          fetchImpl: answer(status),
        }),
        { ok: false, reason: 'unavailable' },
      );
    }
    assert.deepEqual(
      await verifyMcpToken(request, env, RESOURCE, { fetchImpl: answer(503) }),
      { ok: false, reason: 'unavailable' },
    );
    // Clerk's Backend API limit: not a bad token, so no new sign-in.
    const throttled = (async () =>
      new Response('{}', {
        status: 429,
        headers: { 'Retry-After': '7' },
      })) as unknown as typeof fetch;
    assert.deepEqual(
      await verifyMcpToken(request, env, RESOURCE, { fetchImpl: throttled }),
      { ok: false, reason: 'unavailable', retryAfter: 7 },
    );
    assert.deepEqual(
      await verifyMcpToken(request, env, RESOURCE, { fetchImpl: answer(429) }),
      { ok: false, reason: 'unavailable' },
    );
    assert.deepEqual(
      await verifyMcpToken(
        new Request('https://app.vibld.com/mcp'),
        env,
        RESOURCE,
      ),
      { ok: false, reason: 'missing' },
    );
  });
});

describe('the MCP protocol', () => {
  it('negotiates a version it speaks, and offers its newest otherwise', () => {
    assert.equal(negotiateVersion('2025-06-18'), '2025-06-18');
    assert.equal(negotiateVersion('1999-01-01'), '2025-11-25');
    // 2025-03-26 allows batches, which this server refuses.
    assert.equal(negotiateVersion('2025-03-26'), '2025-11-25');
  });

  it('initializes with tools and nothing else', async () => {
    const response = await handleMcpMessage(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      deps().value,
    );
    const body = (await response.json()) as {
      result: {
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string };
      };
    };
    assert.equal(body.result.protocolVersion, '2025-06-18');
    assert.deepEqual(Object.keys(body.result.capabilities), ['tools']);
    assert.equal(body.result.serverInfo.name, 'vibld');
  });

  it('acknowledges a notification with 202 and no body', async () => {
    const response = await handleMcpMessage(
      rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      deps().value,
    );
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
  });

  it('refuses a batch and a message that is not JSON-RPC', async () => {
    assert.equal(
      (
        await handleMcpMessage(
          rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
          deps().value,
        )
      ).status,
      400,
    );
    assert.equal(
      (await handleMcpMessage(rpc({ id: 1, method: 'ping' }), deps().value))
        .status,
      400,
    );
  });

  it('answers an unknown method with method-not-found', async () => {
    const response = await handleMcpMessage(
      rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' }),
      deps().value,
    );
    const body = (await response.json()) as { error: { code: number } };
    assert.equal(body.error.code, -32601);
  });

  it('lists the five tools, each with a closed input schema', async () => {
    const response = await handleMcpMessage(
      rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      deps().value,
    );
    const body = (await response.json()) as {
      result: {
        tools: { name: string; inputSchema: Record<string, unknown> }[];
      };
    };
    assert.deepEqual(
      body.result.tools.map((tool) => tool.name),
      [
        'search_templates',
        'list_projects',
        'start_build',
        'get_build_status',
        'get_preview_url',
      ],
    );
    // It can replace a named project's code, so clients may confirm it.
    assert.equal(
      TOOLS.find((tool) => tool.name === 'start_build')?.annotations
        ?.destructiveHint,
      true,
    );
    for (const tool of TOOLS) {
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
  });

  it('points a client without a token at the metadata', async () => {
    const response = mcpUnauthorized('https://app.vibld.com', 'missing');
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('WWW-Authenticate'),
      `Bearer resource_metadata="https://app.vibld.com${MCP_METADATA_PATH}", scope="build"`,
    );
    assert.deepEqual(
      protectedResourceMetadata(
        'https://app.vibld.com',
        'https://clerk.vibld.com',
      ),
      {
        resource: 'https://app.vibld.com/mcp',
        authorization_servers: ['https://clerk.vibld.com'],
        bearer_methods_supported: ['header'],
        scopes_supported: ['build'],
        resource_name: 'vibld',
      },
    );
  });
});

describe('search_templates', () => {
  it('finds designs by what they are for, with their pages', async () => {
    const result = await callTool(deps().value, 'search_templates', {
      query: 'bakery landing page',
    });
    assert.equal(result.isError, false);
    const templates = result.value.templates as { id: string; url: string }[];
    assert.equal(templates[0]?.id, 'bakery-landing');
    assert.equal(
      templates[0]?.url,
      'https://vibld.com/templates/bakery-landing',
    );
  });

  it('fills from the designs sharing the most words when the matcher finds few', async () => {
    const result = await callTool(deps().value, 'search_templates', {
      query: 'deals and contacts',
      limit: 2,
    });
    const templates = result.value.templates as { id: string }[];
    assert.equal(templates[0]?.id, 'crm-dashboard');
    assert.ok(!templates.some((template) => template.id === 'bakery-landing'));
  });

  it('refuses an empty query as a tool error, not a crash', async () => {
    const result = await callTool(deps().value, 'search_templates', {
      query: '',
    });
    assert.equal(result.isError, true);
  });
});

describe('start_build', () => {
  it('makes a new project and builds in it, never over the last one opened', async () => {
    const d = deps({
      routes: {
        'POST /api/projects': {
          status: 201,
          body: { project: { id: PROJECT } },
        },
      },
    });
    const result = await callTool(d.value, 'start_build', {
      prompt: 'A site for my bakery',
      projectName: 'Bakery',
    });
    assert.equal(result.isError, false);
    assert.equal(result.value.runId, RUN);
    assert.equal(result.value.projectId, PROJECT);
    assert.deepEqual(d.calls, [
      { method: 'POST', path: '/api/projects', body: { name: 'Bakery' } },
    ]);
    assert.deepEqual(d.builds, [
      { prompt: 'A site for my bakery', projectId: PROJECT },
    ]);
    assert.deepEqual(d.recorded, [{ runId: RUN, projectId: PROJECT }]);
  });

  it("adds a template's brief after the request, as the builder does", async () => {
    const d = deps({
      routes: {
        'GET /api/templates/brief?id=bakery-landing': {
          status: 200,
          body: { brief: 'BRIEF' },
        },
        'POST /api/projects': {
          status: 201,
          body: { project: { id: PROJECT } },
        },
      },
    });
    await callTool(d.value, 'start_build', {
      prompt: 'Make it mine',
      templateId: 'bakery-landing',
    });
    assert.deepEqual(d.builds, [
      { prompt: 'Make it mine\n\nBRIEF', projectId: PROJECT },
    ]);
  });

  it('changes an existing project from its accepted code', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: {
          status: 200,
          body: {
            project: { id: PROJECT },
            snapshot: { revision: 'rev-3', files: [] },
            build: null,
          },
        },
      },
    });
    // `projectName` is ignored with `projectId`, as the schema says, even
    // a placeholder that would not pass on its own.
    await callTool(d.value, 'start_build', {
      prompt: 'Add a contact form',
      projectId: PROJECT,
      projectName: '',
    });
    assert.deepEqual(d.builds, [
      {
        prompt: 'Add a contact form',
        projectId: PROJECT,
        base: { revision: 'rev-3' },
      },
    ]);
  });

  it('refuses while a build is running in the project', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: {
          status: 200,
          body: { snapshot: null, build: { runId: RUN } },
        },
      },
    });
    const result = await callTool(d.value, 'start_build', {
      prompt: 'Again',
      projectId: PROJECT,
    });
    assert.equal(result.isError, true);
    assert.deepEqual(d.builds, []);
  });

  it('stops at the daily cap before reading or making anything', async () => {
    const d = deps({ reserveBuild: async () => null });
    const result = await callTool(d.value, 'start_build', { prompt: 'x' });
    assert.equal(result.isError, true);
    assert.match(String(result.value.error), /20 builds/);
    assert.deepEqual(d.calls, []);
    assert.deepEqual(d.builds, []);
  });

  it('stops when builds are started too quickly, without taking a place', async () => {
    const d = deps({ buildBurstAllowed: async () => false });
    const result = await callTool(d.value, 'start_build', { prompt: 'x' });
    assert.equal(result.isError, true);
    assert.deepEqual(d.calls, []);
    assert.deepEqual(d.reserved, []);
  });

  it('takes no place for a malformed call', async () => {
    const d = deps();
    const result = await callTool(d.value, 'start_build', {
      prompt: 'x',
      templateId: '../x',
    });
    assert.equal(result.isError, true);
    assert.deepEqual(d.reserved, []);
  });

  it("passes the builder's own refusal on", async () => {
    const d = deps({
      routes: {
        'POST /api/projects': {
          status: 201,
          body: { project: { id: PROJECT } },
        },
      },
      startBuild: async () => ({
        ok: false,
        status: 402,
        error: 'You have used this month’s allowance.',
      }),
    });
    const result = await callTool(d.value, 'start_build', { prompt: 'x' });
    assert.equal(result.isError, true);
    assert.equal(result.value.error, 'You have used this month’s allowance.');
    assert.deepEqual(d.recorded, []);
    assert.deepEqual(d.released, ['place-1']);
    assert.deepEqual(d.calls.at(-1), {
      method: 'DELETE',
      path: `/api/projects/${PROJECT}`,
    });
  });

  it('keeps the place when the refused build left its project behind', async () => {
    const d = deps({
      routes: {
        'POST /api/projects': {
          status: 201,
          body: { project: { id: PROJECT } },
        },
        [`DELETE /api/projects/${PROJECT}`]: {
          status: 503,
          body: { error: 'down' },
        },
      },
      startBuild: async () => ({
        ok: false,
        status: 402,
        error: 'You have used this month’s allowance.',
      }),
    });
    const result = await callTool(d.value, 'start_build', { prompt: 'x' });
    assert.equal(result.isError, true);
    assert.match(String(result.value.error), /could not be removed/);
    assert.deepEqual(d.released, [], 'the place stays taken');
  });

  it('keeps the project when the build may have started', async () => {
    const d = deps({
      routes: {
        'POST /api/projects': {
          status: 201,
          body: { project: { id: PROJECT } },
        },
      },
      startBuild: async () => ({
        ok: false,
        status: 504,
        error: 'The build did not report starting in time.',
      }),
    });
    const result = await callTool(d.value, 'start_build', { prompt: 'x' });
    assert.equal(result.isError, true);
    assert.ok(!d.calls.some((call) => call.method === 'DELETE'));
    assert.deepEqual(d.released, [], 'the place stays taken');
  });

  it('keeps the place when asking for the build failed outright', async () => {
    const d = deps({
      routes: {
        'POST /api/projects': {
          status: 201,
          body: { project: { id: PROJECT } },
        },
      },
      startBuild: async () => {
        throw new Error('connection lost');
      },
    });
    const result = await callTool(d.value, 'start_build', { prompt: 'x' });
    assert.equal(result.isError, true);
    assert.deepEqual(d.released, []);
  });

  it('never removes a project the assistant named', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: {
          status: 200,
          body: { snapshot: null, build: null },
        },
      },
      startBuild: async () => ({ ok: false, status: 402, error: 'No credit.' }),
    });
    const result = await callTool(d.value, 'start_build', {
      prompt: 'x',
      projectId: PROJECT,
    });
    assert.equal(result.isError, true);
    assert.ok(!d.calls.some((call) => call.method === 'DELETE'));
  });

  it('refuses a project id that is not one', async () => {
    const result = await callTool(deps().value, 'start_build', {
      prompt: 'x',
      projectId: '../admin',
    });
    assert.equal(result.isError, true);
  });
});

describe('get_build_status', () => {
  it('says where the build is, and names the files instead of sending them', async () => {
    const d = deps({
      routes: {
        [`GET /api/runs/${RUN}`]: {
          status: 200,
          body: {
            run: { state: 'accepted', revision: 'rev-4' },
            snapshot: {
              revision: 'rev-4',
              files: [{ path: 'src/App.tsx', content: 'x'.repeat(5000) }],
            },
          },
        },
      },
    });
    const result = await callTool(d.value, 'get_build_status', { runId: RUN });
    assert.equal(result.value.state, 'accepted');
    assert.deepEqual(result.value.files, ['src/App.tsx']);
    assert.ok(!JSON.stringify(result.value).includes('xxxxx'));
  });
});

describe('get_preview_url', () => {
  const opened = {
    status: 200,
    body: {
      snapshot: {
        revision: 'rev-4',
        files: [{ path: 'src/App.tsx', content: 'x' }],
      },
    },
  };

  it('answers with a running preview of the same code', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: {
            status: 'ready',
            url: 'https://p.vibld-preview.dev/',
            expiresAt: 1_800_000_000_000,
            revision: 'rev-4',
          },
        },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'ready');
    assert.equal(result.value.url, 'https://p.vibld-preview.dev/');
    assert.ok(!d.calls.some((call) => call.method === 'POST'));
  });

  it("starts one with the project's code when none serves it", async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': { status: 200, body: { status: 'ready-to-start' } },
        'POST /api/preview': { status: 200, body: { status: 'installing' } },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'installing');
    assert.deepEqual(d.calls.at(-1), {
      method: 'POST',
      path: '/api/preview',
      body: opened.body.snapshot,
    });
  });

  it("moves the account's preview from another project to this one", async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: { status: 'ready', url: 'https://old/', revision: 'rev-other' },
        },
        'PATCH /api/preview': {
          status: 200,
          body: {
            outcome: 'applied',
            status: { status: 'ready', url: 'https://p/', revision: 'rev-4' },
          },
        },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.url, 'https://p/');
    assert.deepEqual(d.calls.at(-1), {
      method: 'PATCH',
      path: '/api/preview',
      body: opened.body.snapshot,
    });
  });

  it('restarts a preview the move asks to restart', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: { status: 'ready', url: 'https://old/', revision: 'rev-other' },
        },
        'PATCH /api/preview': {
          status: 200,
          body: { outcome: 'restart', reason: 'dependencies changed' },
        },
        'DELETE /api/preview': { status: 200, body: { ok: true } },
        'POST /api/preview': { status: 200, body: { status: 'installing' } },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'installing');
    assert.deepEqual(
      d.calls.slice(-3).map((call) => call.method),
      ['PATCH', 'DELETE', 'POST'],
    );
  });

  it('stops and restarts a preview that cannot be moved', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: { status: 'installing', revision: 'rev-other' },
        },
        'DELETE /api/preview': { status: 200, body: { status: 'stopped' } },
        'POST /api/preview': { status: 200, body: { status: 'installing' } },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'installing');
    assert.deepEqual(
      d.calls.slice(-2).map((call) => call.method),
      ['DELETE', 'POST'],
    );
  });

  it('answers a preview still starting on this revision as it is', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: { status: 'starting', revision: 'rev-4' },
        },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'starting');
    assert.ok(
      !d.calls.some((call) => ['DELETE', 'POST'].includes(call.method)),
    );
  });

  it('keeps a queued preview in line and gives it this code', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: { status: 'queued', position: 2 },
        },
        'POST /api/preview': {
          status: 200,
          body: { status: 'queued', position: 1 },
        },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'queued');
    assert.ok(!d.calls.some((call) => call.method === 'DELETE'));
    assert.deepEqual(d.calls.at(-1), {
      method: 'POST',
      path: '/api/preview',
      body: opened.body.snapshot,
    });
  });

  it('replaces a preview the first look missed', async () => {
    let posts = 0;
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': { status: 503, body: { error: 'unreadable' } },
        'DELETE /api/preview': { status: 200, body: { ok: true } },
      },
    });
    const api = d.value.api;
    d.value.api = async (method, path, body) => {
      if (method === 'POST' && path === '/api/preview') {
        d.calls.push({ method, path, body });
        posts += 1;
        return posts === 1
          ? {
              status: 200,
              body: { status: 'ready', url: 'https://old/', revision: 'rev-x' },
            }
          : { status: 200, body: { status: 'installing', revision: 'rev-4' } };
      }
      return api(method, path, body);
    };
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'installing');
    assert.deepEqual(
      d.calls.slice(-3).map((call) => call.method),
      ['POST', 'DELETE', 'POST'],
    );
  });

  it('leaves a move to this revision to finish installing', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': {
          status: 200,
          body: {
            status: 'installing',
            revision: 'rev-other',
            updatingTo: 'rev-4',
          },
        },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.value.status, 'installing');
    assert.ok(
      !d.calls.some((call) =>
        ['PATCH', 'DELETE', 'POST'].includes(call.method),
      ),
    );
  });

  it('says so when there is nothing to preview yet', async () => {
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: {
          status: 200,
          body: { snapshot: null },
        },
      },
    });
    const result = await callTool(d.value, 'get_preview_url', {
      projectId: PROJECT,
    });
    assert.equal(result.isError, true);
  });
});

describe("reading /api/plan's answer", () => {
  function stream(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        },
      }),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  }

  it('stops at the run id, even split across chunks', async () => {
    const result = await readBuildStart(
      stream([
        ': keepalive\n\n',
        'event: run\nda',
        `ta: {"runId":"${RUN}"}\n\n`,
      ]),
      1000,
    );
    assert.deepEqual(result, { ok: true, runId: RUN });
  });

  it('passes a JSON refusal on with its status', async () => {
    const result = await readBuildStart(
      new Response(JSON.stringify({ error: 'Too many generation requests.' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      1000,
    );
    assert.deepEqual(result, {
      ok: false,
      status: 429,
      error: 'Too many generation requests.',
    });
  });

  it('reads an error event before the run as a failed start', async () => {
    const result = await readBuildStart(
      stream([
        'event: error\ndata: {"error":"Generation failed unexpectedly."}\n\n',
      ]),
      1000,
    );
    assert.equal(result.ok, false);
  });

  it('gives up on a stream that never names a run', async () => {
    const result = await readBuildStart(
      new Response(new ReadableStream({ start() {} }), {
        headers: { 'content-type': 'text/event-stream' },
      }),
      50,
    );
    assert.equal(result.ok, false);
  });
});

describe('the daily count', () => {
  const since = '2026-10-09T00:00:00.000Z';
  function place(store: McpBuildStore, placeholder: string, userId = USER) {
    return store.reserve({
      placeholder,
      userId,
      clientId: 'client_x',
      since,
      startedAt: '2026-10-09T10:00:00.000Z',
      limit: 2,
    });
  }

  it('gives an account no more places in the window than its limit', async () => {
    const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
    const store = new McpBuildStore(db);
    await db
      .prepare(
        `INSERT INTO mcp_builds VALUES ('old', ?1, 'client_x', ?2, '2026-10-08T10:00:00.000Z')`,
      )
      .bind(USER, PROJECT)
      .run();
    const taken = await Promise.all([
      place(store, 'r1'),
      place(store, 'r2'),
      place(store, 'r3'),
    ]);
    assert.deepEqual(
      taken.filter(Boolean).length,
      2,
      'two places, however many calls arrive at once',
    );
    assert.equal(await place(store, 'r4', 'user_other'), true);
  });

  it('names the build in the place it took, and frees a place nobody used', async () => {
    const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
    const store = new McpBuildStore(db);
    assert.equal(await place(store, 'r1'), true);
    assert.equal(await place(store, 'r2'), true);
    await store.confirm('r1', 'run_1', PROJECT);
    await store.release('r2');
    const rows = await db
      .prepare('SELECT run_id, project_id FROM mcp_builds ORDER BY run_id')
      .all<{ run_id: string; project_id: string }>();
    assert.deepEqual(
      rows.results.map((row) => ({ ...row })),
      [{ run_id: 'run_1', project_id: PROJECT }],
    );
    assert.equal(await place(store, 'r3'), true);
    assert.equal(await place(store, 'r4'), false);
  });
});

describe("vibld.com's MCP Server Card", () => {
  it('names the tools this server lists, at the endpoint it serves', async () => {
    const { readFile } = await import('node:fs/promises');
    const card = JSON.parse(
      await readFile(
        new URL(
          '../../marketing/public/.well-known/mcp/server-card.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      serverInfo: { name: string; version: string };
      transport: { endpoint: string };
      tools: string[];
    };
    assert.deepEqual(
      card.tools,
      TOOLS.map((tool) => tool.name),
    );
    assert.equal(card.transport.endpoint, 'https://app.vibld.com/mcp');
    assert.equal(card.serverInfo.version, SERVER_INFO.version);
  });
});
