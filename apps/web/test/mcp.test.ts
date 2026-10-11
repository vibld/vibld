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
  EDIT_TOOLS,
  INSTRUCTIONS,
  MAX_READ_CHARS,
  MAX_SCREENSHOT_HEIGHT,
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
import { McpBuildStore, McpCallStore } from '../worker/mcp-store.ts';
import {
  MAX_SCREENSHOT_BYTES,
  NAVIGATION_TIMEOUT_MS,
  captureScreenshot,
} from '../worker/screenshot.ts';
import type { BrowserPage, ScreenshotOptions } from '../worker/screenshot.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const USER = 'user_2abc123';
const PROJECT = '11111111-2222-4333-8444-555555555555';
const RUN = '99999999-8888-4777-8666-555555555555';

const CALLER: McpCaller = {
  principal: { userId: USER, policyIdentity: 'unknown' },
  clientId: 'client_assistant',
  scopes: ['build', 'edit'],
};

/** A connection approved for builds, before editing was a scope of its own. */
const BUILD_ONLY: McpCaller = { ...CALLER, scopes: ['build'] };

/** A small PNG's worth of base64, for the fake browser to answer with. */
const IMAGE = Buffer.from('fake png bytes').toString('base64');

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
  const editCalls: { tool: string; projectId: string }[] = [];
  const captures: { url: string; width: number; fullPage: boolean }[] = [];
  const bursts: string[] = [];
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
    takeEditCall: async (tool, projectId) => {
      editCalls.push({ tool, projectId });
      return { taken: true, limit: 50 };
    },
    screenshot: {
      burstAllowed: async () => {
        bursts.push('screenshot');
        return true;
      },
      capture: async (url, options) => {
        captures.push({ url, ...options });
        return {
          data: IMAGE,
          mimeType: 'image/png',
          width: options.width,
          height: 800,
          clipped: false,
        };
      },
    },
    ...overrides,
  };
  return {
    value,
    calls,
    builds,
    recorded,
    reserved,
    released,
    editCalls,
    captures,
    bursts,
  };
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
      `Bearer error="insufficient_scope", resource_metadata="https://app.vibld.com${MCP_METADATA_PATH}", scope="build edit"`,
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

  it('lists the thirteen tools, each with a closed input schema', async () => {
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
        'list_files',
        'read_files',
        'write_files',
        'check_types',
        'list_checkpoints',
        'restore_checkpoint',
        'get_logs',
        'take_screenshot',
      ],
    );
    // Each can replace a project's code, so clients may confirm it.
    for (const name of ['start_build', 'write_files', 'restore_checkpoint']) {
      const annotations = TOOLS.find((tool) => tool.name === name)
        ?.annotations as { destructiveHint?: boolean } | undefined;
      assert.equal(annotations?.destructiveHint, true, name);
    }
    for (const name of [
      'list_files',
      'read_files',
      'list_checkpoints',
      'get_logs',
    ]) {
      const annotations = TOOLS.find((tool) => tool.name === name)
        ?.annotations as { readOnlyHint?: boolean } | undefined;
      assert.equal(annotations?.readOnlyHint, true, name);
    }
    for (const tool of TOOLS) {
      assert.equal(tool.inputSchema.additionalProperties, false);
      for (const property of Object.values(
        tool.inputSchema.properties as Record<string, Record<string, unknown>>,
      )) {
        const items = property.items as Record<string, unknown> | undefined;
        if (items?.type === 'object') {
          assert.equal(items.additionalProperties, false, tool.name);
        }
      }
    }
    // Only the editing tools are counted against the plan (D201).
    assert.deepEqual(
      TOOLS.map((tool) => tool.name).filter((name) => EDIT_TOOLS.has(name)),
      [
        'list_files',
        'read_files',
        'write_files',
        'check_types',
        'list_checkpoints',
        'restore_checkpoint',
        'get_logs',
        'take_screenshot',
      ],
    );
  });

  it('offers no screenshots where Browser Rendering is not bound', async () => {
    const d = deps({ screenshot: undefined });
    const response = await handleMcpMessage(
      rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      d.value,
    );
    const body = (await response.json()) as {
      result: { tools: { name: string }[] };
    };
    assert.equal(body.result.tools.length, 12);
    assert.ok(!body.result.tools.some((t) => t.name === 'take_screenshot'));
    const called = await handleMcpMessage(
      rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'take_screenshot', arguments: { projectId: PROJECT } },
      }),
      d.value,
    );
    const refused = (await called.json()) as { error: { code: number } };
    assert.equal(refused.error.code, -32602);
    assert.deepEqual(d.editCalls, []);
    assert.deepEqual(d.calls, []);
  });

  it('asks a connection without the edit scope to step up, before counting or reading anything', async () => {
    for (const name of EDIT_TOOLS) {
      const d = deps({ caller: BUILD_ONLY });
      const response = await handleMcpMessage(
        rpc({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: { name, arguments: { projectId: PROJECT } },
        }),
        d.value,
      );
      assert.equal(response.status, 403, name);
      assert.equal(
        response.headers.get('WWW-Authenticate'),
        `Bearer error="insufficient_scope", scope="build edit", resource_metadata="https://app.vibld.com${MCP_METADATA_PATH}", error_description="Editing needs the edit scope"`,
      );
      const body = (await response.json()) as {
        id: number;
        error: { code: number; message: string };
      };
      assert.equal(body.id, 9);
      assert.match(
        body.error.message,
        /Connect vibld again and approve editing/,
      );
      assert.deepEqual(d.editCalls, [], name);
      assert.deepEqual(d.calls, [], name);
      assert.deepEqual(d.bursts, [], name);
    }
    // The five tools before them need only build.
    const d = deps({ caller: BUILD_ONLY });
    const listed = await callTool(d.value, 'search_templates', {
      query: 'bakery',
    });
    assert.equal(listed.isError, false);
  });

  it('points a client without a token at the metadata', async () => {
    const response = mcpUnauthorized('https://app.vibld.com', 'missing');
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('WWW-Authenticate'),
      `Bearer resource_metadata="https://app.vibld.com${MCP_METADATA_PATH}", scope="build edit"`,
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
        scopes_supported: ['build', 'edit'],
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

describe('the editing tools (D190)', () => {
  const FILES = `/api/projects/${PROJECT}/files`;
  const code = (revision: string, files: { path: string; content: string }[]) =>
    ({ status: 200, body: { snapshot: { revision, files } } }) as ApiAnswer;
  const accepted = code('r0000000a', [
    { path: 'src/App.tsx', content: 'export default 1;' },
    { path: 'index.html', content: '<div id="root"></div>' },
  ]);

  /** A valid call to each editing tool. */
  const VALID: Record<string, Record<string, unknown>> = {
    list_files: { projectId: PROJECT },
    read_files: { projectId: PROJECT, paths: ['src/App.tsx'] },
    write_files: {
      projectId: PROJECT,
      baseRevision: 'r0000000a',
      files: [{ path: 'src/App.tsx', content: 'x' }],
    },
    check_types: { projectId: PROJECT },
    list_checkpoints: { projectId: PROJECT },
    restore_checkpoint: {
      projectId: PROJECT,
      revision: 'r0000000b',
      baseRevision: 'r0000000a',
    },
    get_logs: { projectId: PROJECT },
    take_screenshot: { projectId: PROJECT },
  };

  it('counts every editing call, a read as much as a write, and no other tool', async () => {
    const d = deps({ routes: { [`GET ${FILES}`]: accepted } });
    await callTool(d.value, 'list_files', { projectId: PROJECT });
    await callTool(d.value, 'read_files', {
      projectId: PROJECT,
      paths: ['src/App.tsx'],
    });
    await callTool(d.value, 'search_templates', { query: 'bakery' });
    await callTool(d.value, 'list_projects', {});
    assert.deepEqual(d.editCalls, [
      { tool: 'list_files', projectId: PROJECT },
      { tool: 'read_files', projectId: PROJECT },
    ]);
  });

  it("refuses at the plan's cap before reading or writing anything", async () => {
    for (const [name, args] of Object.entries(VALID)) {
      const d = deps({
        takeEditCall: async () => ({ taken: false, limit: 50 }),
      });
      const result = await callTool(d.value, name, args);
      assert.equal(result.isError, true, name);
      assert.match(
        String(result.value.error),
        /made 50 calls to vibld's editing tools in the last 24 hours/,
        name,
      );
      assert.match(
        String(result.value.error),
        /Editing in the builder at https:\/\/app\.vibld\.com is not affected/,
      );
      assert.deepEqual(d.calls, [], `${name} read nothing`);
    }
  });

  it('takes no call for a malformed one', async () => {
    const malformed: [string, Record<string, unknown>][] = [
      ['list_files', { projectId: 'not-a-project' }],
      ['read_files', { projectId: PROJECT, paths: [] }],
      ['read_files', { projectId: PROJECT, paths: ['a'.repeat(257)] }],
      ['read_files', { projectId: PROJECT, paths: ['a'], revision: '../x' }],
      [
        'read_files',
        {
          projectId: PROJECT,
          paths: Array.from({ length: 21 }, (_, i) => `f${i}.ts`),
        },
      ],
      ['write_files', { projectId: PROJECT, files: [] }],
      ['write_files', { projectId: PROJECT, baseRevision: 'r0000000a' }],
      [
        'write_files',
        {
          projectId: PROJECT,
          baseRevision: 'r0000000a',
          files: [{ path: 'a.ts' }],
        },
      ],
      [
        'write_files',
        { projectId: PROJECT, baseRevision: 'r0000000a', delete: 'a.ts' },
      ],
      ['list_checkpoints', { projectId: PROJECT, limit: 0 }],
      ['restore_checkpoint', { projectId: PROJECT, revision: 'r0000000b' }],
      ['read_files', { projectId: PROJECT, paths: ['a'], offset: -1 }],
      ['read_files', { projectId: PROJECT, paths: ['a'], offset: 1.5 }],
      ['read_files', { projectId: PROJECT, paths: ['a', 'b'], offset: 10 }],
      ['take_screenshot', { projectId: PROJECT, width: 1024 }],
      ['take_screenshot', { projectId: PROJECT, path: 'pricing' }],
      ['take_screenshot', { projectId: PROJECT, path: '//evil.example' }],
      ['take_screenshot', { projectId: PROJECT, fullPage: 'yes' }],
    ];
    for (const [name, args] of malformed) {
      const d = deps();
      const result = await callTool(d.value, name, args);
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
      assert.deepEqual(d.editCalls, [], name);
      assert.deepEqual(d.calls, [], name);
      assert.deepEqual(d.bursts, [], name);
    }
  });

  it('lists the files with their sizes and the revision to write against', async () => {
    const d = deps({ routes: { [`GET ${FILES}`]: accepted } });
    const result = await callTool(d.value, 'list_files', {
      projectId: PROJECT,
    });
    assert.deepEqual(result.value, {
      projectId: PROJECT,
      revision: 'r0000000a',
      files: [
        { path: 'src/App.tsx', chars: 17 },
        { path: 'index.html', chars: 21 },
      ],
    });
  });

  it('reads files up to its budget, naming what it left out or could not find', async () => {
    const big = 'x'.repeat(MAX_READ_CHARS - 10);
    const d = deps({
      routes: {
        [`GET ${FILES}?revision=r0000000b`]: code('r0000000b', [
          { path: 'big.ts', content: big },
          { path: 'small.ts', content: 'tiny' },
          { path: 'second.ts', content: 'y'.repeat(20) },
        ]),
      },
    });
    const result = await callTool(d.value, 'read_files', {
      projectId: PROJECT,
      paths: ['big.ts', 'second.ts', 'small.ts', 'gone.ts'],
      revision: 'r0000000b',
    });
    assert.equal(result.value.revision, 'r0000000b');
    assert.deepEqual(result.value.files, [
      { path: 'big.ts', content: big },
      { path: 'small.ts', content: 'tiny' },
    ]);
    assert.deepEqual(result.value.omitted, [{ path: 'second.ts', chars: 20 }]);
    assert.deepEqual(result.value.missing, ['gone.ts']);
  });

  it('reads a file longer than one call in parts, from the offset each part names', async () => {
    const long = 'a'.repeat(MAX_READ_CHARS) + 'b'.repeat(60_000);
    const routes = {
      [`GET ${FILES}`]: code('r0000000a', [
        { path: 'long.ts', content: long },
        { path: 'small.ts', content: 'tiny' },
      ]),
    };
    const first = await callTool(deps({ routes }).value, 'read_files', {
      projectId: PROJECT,
      paths: ['long.ts', 'small.ts'],
    });
    assert.deepEqual(first.value.files, [
      {
        path: 'long.ts',
        content: 'a'.repeat(MAX_READ_CHARS),
        offset: 0,
        nextOffset: MAX_READ_CHARS,
        chars: long.length,
      },
    ]);
    assert.deepEqual(first.value.omitted, [{ path: 'small.ts', chars: 4 }]);
    assert.match(
      String(first.value.next),
      new RegExp(`paths \\["long\\.ts"\\] and offset ${MAX_READ_CHARS}`),
    );

    const second = await callTool(deps({ routes }).value, 'read_files', {
      projectId: PROJECT,
      paths: ['long.ts'],
      offset: MAX_READ_CHARS,
    });
    assert.deepEqual(second.value.files, [
      {
        path: 'long.ts',
        content: 'b'.repeat(60_000),
        offset: MAX_READ_CHARS,
        chars: long.length,
      },
    ]);
    assert.equal(second.value.next, undefined);

    const past = await callTool(deps({ routes }).value, 'read_files', {
      projectId: PROJECT,
      paths: ['long.ts'],
      offset: long.length + 1,
    });
    assert.equal(past.isError, true);
    assert.match(String(past.value.error), /past the end of long\.ts/);
  });

  it('passes on a project with no code yet', async () => {
    const d = deps({
      routes: {
        [`GET ${FILES}`]: {
          status: 404,
          body: { error: 'This project has no code yet.' },
        },
      },
    });
    const result = await callTool(d.value, 'list_files', {
      projectId: PROJECT,
    });
    assert.equal(result.isError, true);
    assert.equal(result.value.error, 'This project has no code yet.');
  });

  it("writes and deletes through the project's own files route", async () => {
    const d = deps({
      routes: {
        [`PUT ${FILES}`]: code('r0000000c', [
          { path: 'src/App.tsx', content: 'x' },
          { path: 'src/new.ts', content: 'y' },
        ]),
      },
    });
    const result = await callTool(d.value, 'write_files', {
      projectId: PROJECT,
      baseRevision: 'r0000000a',
      files: [
        { path: 'src/App.tsx', content: 'x' },
        { path: 'src/new.ts', content: 'y' },
      ],
      delete: ['index.html'],
    });
    assert.equal(result.isError, false);
    assert.deepEqual(d.calls, [
      {
        method: 'PUT',
        path: FILES,
        body: {
          base: 'r0000000a',
          files: [
            { path: 'src/App.tsx', content: 'x' },
            { path: 'src/new.ts', content: 'y' },
          ],
          delete: ['index.html'],
        },
      },
    ]);
    assert.equal(result.value.revision, 'r0000000c');
    assert.deepEqual(result.value.written, ['src/App.tsx', 'src/new.ts']);
    assert.deepEqual(result.value.deleted, ['index.html']);
    assert.equal(result.value.files, 2);
    assert.match(String(result.value.next), /check_types/);
  });

  it('names the current revision when the project moved on, and passes on a build or an archive', async () => {
    const refusals: [ApiAnswer, RegExp][] = [
      [
        {
          status: 409,
          body: {
            error:
              'This project has changed since its files were read. Read them again, then edit.',
            code: 'checkpoint-moved',
            current: 'r0000000f',
          },
        },
        /Read them again, then edit\. The current revision is r0000000f\.$/,
      ],
      [
        {
          status: 409,
          body: {
            error:
              'A build is still running in this project. Wait for it to finish, then edit its files.',
          },
        },
        /A build is still running/,
      ],
      [
        {
          status: 409,
          body: {
            error: 'This project is archived. Unarchive it to edit its files.',
          },
        },
        /archived/,
      ],
    ];
    for (const [answer, message] of refusals) {
      const d = deps({ routes: { [`PUT ${FILES}`]: answer } });
      const result = await callTool(d.value, 'write_files', VALID.write_files!);
      assert.equal(result.isError, true);
      assert.match(String(result.value.error), message);
    }
  });

  it("reads the preview's type check, starting the preview where it must", async () => {
    const opened = {
      status: 200,
      body: {
        snapshot: {
          revision: 'r0000000a',
          files: [{ path: 'src/App.tsx', content: 'x' }],
        },
      },
    };
    const ready = (extra: Record<string, unknown>) => ({
      [`GET /api/projects/${PROJECT}`]: opened,
      'GET /api/preview': {
        status: 200,
        body: {
          status: 'ready',
          url: 'https://p.vibld-preview.dev/',
          expiresAt: 1_800_000_000_000,
          revision: 'r0000000a',
          ...extra,
        },
      },
    });
    const failing = await callTool(
      deps({
        routes: ready({ typecheckFailure: 'src/App.tsx(1,1): error TS2304' }),
      }).value,
      'check_types',
      { projectId: PROJECT },
    );
    assert.equal(failing.value.typecheck, 'failed');
    assert.equal(failing.value.output, 'src/App.tsx(1,1): error TS2304');
    const passing = await callTool(
      deps({ routes: ready({}) }).value,
      'check_types',
      { projectId: PROJECT },
    );
    assert.deepEqual(passing.value, { status: 'ready', typecheck: 'passed' });

    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}`]: opened,
        'GET /api/preview': { status: 200, body: { status: 'ready-to-start' } },
        'POST /api/preview': { status: 200, body: { status: 'installing' } },
      },
    });
    const starting = await callTool(d.value, 'check_types', {
      projectId: PROJECT,
    });
    assert.equal(starting.value.status, 'installing');
    assert.match(String(starting.value.next), /check_types again/);
    assert.equal(d.calls.at(-1)?.method, 'POST');
  });

  it('lists checkpoints newest first, as many as asked for', async () => {
    const checkpoints = Array.from({ length: 3 }, (_, i) => ({
      revision: `r000000${i}0`,
      runId: `edit-${i}`,
      kind: i === 0 ? 'edit' : 'build',
      acceptedAt: `2026-10-0${3 - i}T00:00:00.000Z`,
    }));
    const d = deps({
      routes: {
        [`GET /api/projects/${PROJECT}/checkpoints`]: {
          status: 200,
          body: { current: 'r00000000', checkpoints },
        },
      },
    });
    const result = await callTool(d.value, 'list_checkpoints', {
      projectId: PROJECT,
      limit: 2,
    });
    assert.deepEqual(result.value, {
      projectId: PROJECT,
      current: 'r00000000',
      checkpoints: [
        {
          revision: 'r00000000',
          kind: 'edit',
          acceptedAt: '2026-10-03T00:00:00.000Z',
        },
        {
          revision: 'r00000010',
          kind: 'build',
          acceptedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
      more: true,
    });
  });

  it("restores through the history's own route, from the revision it was shown", async () => {
    const d = deps({
      routes: {
        [`POST /api/projects/${PROJECT}/checkpoints/restore`]: code(
          'r0000000b',
          [{ path: 'src/App.tsx', content: 'old' }],
        ),
      },
    });
    const result = await callTool(
      d.value,
      'restore_checkpoint',
      VALID.restore_checkpoint!,
    );
    assert.deepEqual(d.calls, [
      {
        method: 'POST',
        path: `/api/projects/${PROJECT}/checkpoints/restore`,
        body: { revision: 'r0000000b', base: 'r0000000a' },
      },
    ]);
    assert.equal(result.value.revision, 'r0000000b');

    const moved = deps({
      routes: {
        [`POST /api/projects/${PROJECT}/checkpoints/restore`]: {
          status: 409,
          body: {
            error: 'This project has changed since its history was loaded.',
            code: 'checkpoint-moved',
            current: 'r0000000c',
          },
        },
      },
    });
    const refused = await callTool(
      moved.value,
      'restore_checkpoint',
      VALID.restore_checkpoint!,
    );
    assert.equal(refused.isError, true);
    assert.match(String(refused.value.error), /current revision is r0000000c/);
  });

  it('reports the preview and recent builds, starts nothing, and says what is not captured', async () => {
    const runs = Array.from({ length: 12 }, (_, i) => ({
      runId: `run-${i}`,
      projectId: PROJECT,
      stop: i === 0 ? 'validation-failed' : 'applied',
      model: 'claude-opus',
      elapsedMs: 61_400,
      endedAt: '2026-10-10T00:00:00.000Z',
      costMicroUsd: 1,
    }));
    const routes = (previewRevision: string) => ({
      [`GET /api/projects/${PROJECT}/checkpoints`]: {
        status: 200,
        body: { current: 'r0000000a', checkpoints: [] },
      },
      'GET /api/preview': {
        status: 200,
        body: {
          status: 'ready',
          url: 'https://p.vibld-preview.dev/',
          expiresAt: 1,
          revision: previewRevision,
          typecheckFailure: 'error TS1005',
        },
      },
      [`GET /api/runs?project=${PROJECT}`]: { status: 200, body: { runs } },
    });
    const d = deps({ routes: routes('r0000000a') });
    const result = await callTool(d.value, 'get_logs', { projectId: PROJECT });
    assert.deepEqual(result.value.preview, {
      status: 'ready',
      typecheck: 'failed',
      typecheckOutput: 'error TS1005',
    });
    const builds = result.value.builds as Record<string, unknown>[];
    assert.equal(builds.length, 10);
    assert.deepEqual(builds[0], {
      runId: 'run-0',
      outcome: 'validation-failed',
      model: 'claude-opus',
      endedAt: '2026-10-10T00:00:00.000Z',
      seconds: 61,
    });
    assert.match(String(result.value.notCaptured), /browser console/);
    assert.ok(d.calls.every((call) => call.method === 'GET'));

    const other = await callTool(
      deps({ routes: routes('r0000000z') }).value,
      'get_logs',
      { projectId: PROJECT },
    );
    assert.equal(
      (other.value.preview as Record<string, unknown>).status,
      'serving-other-code',
    );
  });

  describe('take_screenshot', () => {
    const opened = {
      status: 200,
      body: {
        snapshot: {
          revision: 'r0000000a',
          files: [{ path: 'src/App.tsx', content: 'x' }],
        },
      },
    };
    const ready = {
      [`GET /api/projects/${PROJECT}`]: opened,
      'GET /api/preview': {
        status: 200,
        body: {
          status: 'ready',
          url: 'https://3000-sbx-tok.vibld-preview.dev/',
          expiresAt: 1_800_000_000_000,
          revision: 'r0000000a',
        },
      },
    } as Record<string, ApiAnswer>;

    async function shoot(d: McpDeps, args: Record<string, unknown>) {
      const response = await handleMcpMessage(
        rpc({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: { name: 'take_screenshot', arguments: args },
        }),
        d,
      );
      return (await response.json()) as {
        result: {
          isError: boolean;
          content: {
            type: string;
            text?: string;
            data?: string;
            mimeType?: string;
          }[];
        };
      };
    }

    it('loads the page in the preview and answers with the image', async () => {
      const d = deps({ routes: ready });
      const body = await shoot(d.value, {
        projectId: PROJECT,
        path: '/pricing?plan=pro',
        width: 390,
        fullPage: true,
      });
      assert.equal(body.result.isError, false);
      const [text, image] = body.result.content;
      assert.equal(image?.type, 'image');
      assert.equal(image?.data, IMAGE);
      assert.equal(image?.mimeType, 'image/png');
      assert.deepEqual(JSON.parse(text!.text!), {
        projectId: PROJECT,
        path: '/pricing?plan=pro',
        width: 390,
        height: 800,
        format: 'png',
      });
      assert.deepEqual(d.captures, [
        {
          url: 'https://3000-sbx-tok.vibld-preview.dev/pricing?plan=pro',
          width: 390,
          fullPage: true,
        },
      ]);
      assert.deepEqual(d.editCalls, [
        { tool: 'take_screenshot', projectId: PROJECT },
      ]);
      assert.deepEqual(d.bursts, ['screenshot']);
    });

    it('defaults to the home page at the desktop width', async () => {
      const d = deps({ routes: ready });
      await shoot(d.value, { projectId: PROJECT });
      assert.deepEqual(d.captures, [
        {
          url: 'https://3000-sbx-tok.vibld-preview.dev/',
          width: 1280,
          fullPage: false,
        },
      ]);
    });

    it('starts the preview and takes no picture until it is ready', async () => {
      const d = deps({
        routes: {
          [`GET /api/projects/${PROJECT}`]: opened,
          'GET /api/preview': {
            status: 200,
            body: { status: 'ready-to-start' },
          },
          'POST /api/preview': { status: 200, body: { status: 'installing' } },
        },
      });
      const result = await callTool(d.value, 'take_screenshot', {
        projectId: PROJECT,
      });
      assert.equal(result.isError, false);
      assert.equal(result.value.status, 'installing');
      assert.match(String(result.value.next), /take_screenshot again/);
      assert.deepEqual(d.captures, []);
      assert.equal(d.calls.at(-1)?.method, 'POST');
    });

    it('refuses a burst before taking a daily call or reading anything', async () => {
      const d = deps({ routes: ready });
      d.value.screenshot = {
        burstAllowed: async () => false,
        capture: async () => {
          throw new Error('not reached');
        },
      };
      const result = await callTool(d.value, 'take_screenshot', {
        projectId: PROJECT,
      });
      assert.equal(result.isError, true);
      assert.match(String(result.value.error), /too quickly/);
      assert.deepEqual(d.editCalls, []);
      assert.deepEqual(d.calls, []);
    });

    it('says so when the page could not be captured', async () => {
      const d = deps({ routes: ready });
      d.value.screenshot = {
        burstAllowed: async () => true,
        capture: async () => {
          throw new Error('Navigation timeout of 20000 ms exceeded');
        },
      };
      const result = await callTool(d.value, 'take_screenshot', {
        projectId: PROJECT,
      });
      assert.equal(result.isError, true);
      assert.match(String(result.value.error), /could not be captured/);
    });
  });

  it('tells an assistant how to use them', () => {
    for (const name of EDIT_TOOLS) {
      assert.ok(INSTRUCTIONS.includes(name), name);
    }
  });
});

describe('the daily count of editing calls (D201)', () => {
  const since = '2026-10-09T10:00:00.000Z';
  function take(store: McpCallStore, id: string, userId = USER) {
    return store.take({
      id,
      userId,
      clientId: 'client_x',
      tool: 'read_files',
      projectId: PROJECT,
      since,
      calledAt: '2026-10-10T09:00:00.000Z',
      limit: 2,
    });
  }

  it('gives an account no more calls in the window than its limit', async () => {
    const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
    const store = new McpCallStore(db);
    const taken = await Promise.all([
      take(store, 'c1'),
      take(store, 'c2'),
      take(store, 'c3'),
    ]);
    assert.equal(
      taken.filter(Boolean).length,
      2,
      'two calls, however many arrive at once',
    );
    assert.equal(await take(store, 'c4', 'user_other'), true);
  });

  it('keeps only the window, so calls older than it count for nothing', async () => {
    const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
    await db
      .prepare(
        `INSERT INTO mcp_calls VALUES
           ('old1', ?1, 'client_x', 'list_files', ?2, '2026-10-09T09:59:59.000Z'),
           ('old2', ?1, 'client_x', 'list_files', ?2, '2026-10-08T00:00:00.000Z'),
           ('other', 'user_other', 'client_x', 'list_files', ?2, '2026-10-08T00:00:00.000Z')`,
      )
      .bind(USER, PROJECT)
      .run();
    const store = new McpCallStore(db);
    assert.equal(await take(store, 'c1'), true);
    assert.equal(await take(store, 'c2'), true);
    assert.equal(await take(store, 'c3'), false);
    const rows = await db
      .prepare('SELECT id FROM mcp_calls ORDER BY id')
      .all<{ id: string }>();
    assert.deepEqual(
      rows.results.map((row) => row.id),
      ['c1', 'c2', 'other'],
      "the account's own old calls are cleared, nobody else's",
    );
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

describe('the screenshot browser', () => {
  /** A fake Browser Rendering browser: what was asked of it, and when it closed. */
  function browser(
    options: {
      scrollHeight?: number;
      sizes?: number[];
      goto?: () => Promise<unknown>;
      idle?: () => Promise<unknown>;
    } = {},
  ) {
    const seen = {
      viewport: undefined as { width: number; height: number } | undefined,
      goto: [] as { url: string; timeout: number }[],
      shots: [] as ScreenshotOptions[],
      closed: 0,
    };
    const sizes = [...(options.sizes ?? [1000])];
    const page: BrowserPage = {
      setViewport: async (viewport) => {
        seen.viewport = viewport;
      },
      goto: async (url, { timeout }) => {
        seen.goto.push({ url, timeout });
        return options.goto?.();
      },
      waitForNetworkIdle: async () => options.idle?.(),
      evaluate: async <T>() => (options.scrollHeight ?? 0) as T,
      screenshot: async (shot) => {
        seen.shots.push(shot);
        return new Uint8Array(sizes.shift() ?? 1000);
      },
    };
    const launch = async () => ({
      newPage: async () => page,
      close: async () => {
        seen.closed++;
      },
    });
    return { seen, launch };
  }

  it('loads the page at the width and its frame height, then closes the browser', async () => {
    const b = browser({ idle: () => Promise.reject(new Error('never idle')) });
    const shot = await captureScreenshot(b.launch, 'https://p.example/', {
      width: 768,
      fullPage: false,
    });
    assert.deepEqual(b.seen.viewport, { width: 768, height: 1024 });
    assert.deepEqual(b.seen.goto, [
      { url: 'https://p.example/', timeout: NAVIGATION_TIMEOUT_MS },
    ]);
    assert.equal(shot.mimeType, 'image/png');
    assert.equal(shot.height, 1024);
    assert.equal(shot.clipped, false);
    assert.equal(Buffer.from(shot.data, 'base64').length, 1000);
    assert.equal(b.seen.closed, 1);
  });

  it('cuts a full page at its height limit', async () => {
    const b = browser({ scrollHeight: MAX_SCREENSHOT_HEIGHT * 3 });
    const shot = await captureScreenshot(b.launch, 'https://p.example/', {
      width: 1280,
      fullPage: true,
    });
    assert.equal(shot.height, MAX_SCREENSHOT_HEIGHT);
    assert.equal(shot.clipped, true);
    assert.deepEqual(b.seen.shots[0]?.clip, {
      x: 0,
      y: 0,
      width: 1280,
      height: MAX_SCREENSHOT_HEIGHT,
    });
    assert.equal(b.seen.shots[0]?.captureBeyondViewport, true);
  });

  it('takes a large picture again as a JPEG, and gives up past the last quality', async () => {
    const b = browser({
      sizes: [MAX_SCREENSHOT_BYTES + 1, MAX_SCREENSHOT_BYTES + 1, 900],
    });
    const shot = await captureScreenshot(b.launch, 'https://p.example/', {
      width: 390,
      fullPage: false,
    });
    assert.equal(shot.mimeType, 'image/jpeg');
    assert.deepEqual(
      b.seen.shots.map((s) => [s.type, s.quality]),
      [
        ['png', undefined],
        ['jpeg', 70],
        ['jpeg', 45],
      ],
    );
    const huge = browser({ sizes: Array(4).fill(MAX_SCREENSHOT_BYTES + 1) });
    await assert.rejects(
      captureScreenshot(huge.launch, 'https://p.example/', {
        width: 390,
        fullPage: false,
      }),
    );
    assert.equal(huge.seen.closed, 1);
  });

  it('closes the browser when the page does not load', async () => {
    const b = browser({
      goto: () => Promise.reject(new Error('Navigation timeout')),
    });
    await assert.rejects(
      captureScreenshot(b.launch, 'https://p.example/', {
        width: 1280,
        fullPage: false,
      }),
      /Navigation timeout/,
    );
    assert.equal(b.seen.closed, 1);
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
