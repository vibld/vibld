import { matchCatalogDesigns } from '@vibld/ai/catalog-inspiration';
import type { DesignTemplateName } from '@vibld/ai/design-template-index';
import { MAX_PROMPT_CHARS } from '@vibld/ai/limits';

import { MCP_SCOPE, type McpCaller } from './mcp-auth.ts';

/**
 * `/mcp`: vibld as an MCP server (docs/decisions.md D182), so an assistant
 * the person has connected (Claude, Cursor and the like) can find a
 * template, start a build, ask after it and open its preview, on that
 * person's own account, plan and credit.
 *
 * Streamable HTTP, stateless: every JSON-RPC message is one POST answered
 * with one JSON body, which the transport allows in place of a stream. No
 * session is kept, because nothing here needs one: each tool call carries
 * the person's token and is complete in itself.
 *
 * The tools hold no rules of their own about money or access. Each is
 * served by calling the builder's own routes as the person (`api` below,
 * `actAs` in `principal.ts`), so a build started here is refused, priced
 * and limited exactly as one started in the builder: the invite gate, the
 * plan's models, the ledger, the burst limits. What this file adds is
 * only what an assistant needs on top: a cap on builds a day, and a burst
 * limit of its own, because an assistant can loop where a person clicks.
 *
 * Kept free of the Worker's bindings so it can be tested under
 * `node --test`; the router supplies them (`mcpDeps` in `index.ts`).
 */

/**
 * Not 2025-03-26: it allows JSON-RPC batches, which this server refuses
 * (they were dropped in 2025-06-18). A client asking for it is offered the
 * newest, as the lifecycle allows.
 */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'] as const;

export const SERVER_INFO = {
  name: 'vibld',
  title: 'vibld',
  version: '0.1.0',
};

export const INSTRUCTIONS =
  'vibld builds websites and web apps from a description. Find a starting design with search_templates, start a build with start_build, then poll get_build_status until it ends (a build takes several minutes). Open the result with get_preview_url. Builds are billed to the signed-in account, as they are in the builder at https://app.vibld.com.';

/** What the router lends a call: the person's own API, as them. */
export interface ApiAnswer {
  status: number;
  body: unknown;
}

export type BuildStart =
  { ok: true; runId: string } | { ok: false; status: number; error: string };

export interface McpDeps {
  caller: McpCaller;
  /** The builder's origin, for links the person can open. */
  appOrigin: string;
  /** vibld.com, where each template has its own page. */
  siteOrigin: string;
  /** One of the person's own routes, called as them. */
  api: (method: string, path: string, body?: unknown) => Promise<ApiAnswer>;
  /** `/api/plan`, as them, read until the build has an id. */
  startBuild: (body: Record<string, unknown>) => Promise<BuildStart>;
  templates: readonly DesignTemplateName[];
  /**
   * Takes one of the account's `dailyBuildLimit` places for assistant
   * builds in the last 24 hours, atomically; null when none is free.
   */
  reserveBuild: () => Promise<string | null>;
  /** The place `reserveBuild` gave now names the build that started. */
  confirmBuild: (
    place: string,
    runId: string,
    projectId: string,
  ) => Promise<void>;
  /** No build started: the place is given back. */
  releaseBuild: (place: string) => Promise<void>;
  dailyBuildLimit: number;
  /** False when this account is starting builds too fast. */
  buildBurstAllowed: () => Promise<boolean>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function rpcResult(id: JsonRpcRequest['id'], result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: JSON_HEADERS,
  });
}

function rpcError(
  id: JsonRpcRequest['id'] | undefined,
  code: number,
  message: string,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message },
    }),
    { status, headers: JSON_HEADERS },
  );
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** The newest version both sides speak, or ours when the client's is unknown. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
}

const ID_PATTERN = '^[0-9a-f-]{36}$';

export const TOOLS = [
  {
    name: 'search_templates',
    title: 'Search templates',
    description:
      "Search vibld's template catalog for designs that fit a description. Returns each template's id (for start_build's templateId), name, summary and its page on vibld.com.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What the site or app is for, in a few words: "bakery landing page", "CRM dashboard".',
          minLength: 1,
          maxLength: 200,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'How many to return. Defaults to 5.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_projects',
    title: 'List projects',
    description:
      "The signed-in person's vibld projects: id, name, whether it has code yet, and its published site and share link if it has them.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'start_build',
    title: 'Start a build',
    description:
      "Start a vibld build from a description, billed to the signed-in person's plan and credit. With no projectId it makes a new project; with one it changes that project's current code. Returns a runId: call get_build_status with it until the build ends, which takes several minutes.",
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'What to build or change, as the person would type it in the builder.',
          minLength: 1,
          maxLength: MAX_PROMPT_CHARS,
        },
        projectId: {
          type: 'string',
          pattern: ID_PATTERN,
          description:
            'An existing project to change (from list_projects). Leave out to start a new project.',
        },
        projectName: {
          type: 'string',
          maxLength: 80,
          description: 'A name for the new project. Ignored with projectId.',
        },
        templateId: {
          type: 'string',
          pattern: '^[a-z0-9-]{1,80}$',
          description:
            "A template's id from search_templates, to build from its design.",
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // A build in a named project replaces its code with a new revision.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'get_build_status',
    title: 'Get build status',
    description:
      'What became of a build started with start_build: running (with the phase it is in), accepted, failed, or stopped by the person. Poll every 15 seconds or so while it runs.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          pattern: ID_PATTERN,
          description: "start_build's runId.",
        },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_preview_url',
    title: 'Get preview URL',
    description:
      "A live preview of a project's current code, at a temporary URL anyone can open until it expires. Starts the preview if it is not running, which takes a minute or two: call again until the status is ready. An account runs one preview at a time, so this replaces any preview open in the builder.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          pattern: ID_PATTERN,
          description: 'The project to preview.',
        },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

class ToolError extends Error {}

/** A build that may have started even though no id came back. */
class UncertainStart extends ToolError {}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorOf(answer: ApiAnswer, fallback: string): string {
  const message = record(answer.body).error;
  return typeof message === 'string' && message !== '' ? message : fallback;
}

function stringArg(
  args: Record<string, unknown>,
  name: string,
  options: { required?: boolean; pattern?: RegExp; max?: number } = {},
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    if (options.required) throw new ToolError(`"${name}" is required.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError(`"${name}" must be a non-empty string.`);
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new ToolError(
      `"${name}" must be ${options.max} characters or fewer.`,
    );
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw new ToolError(`"${name}" is not a valid value.`);
  }
  return value;
}

const PROJECT_ID = /^[0-9a-f-]{36}$/;
/** Words too common in a request to say which design it wants. */
const FILLER = new Set([
  'and',
  'for',
  'the',
  'with',
  'page',
  'site',
  'website',
  'web',
  'app',
  'landing',
  'template',
  'design',
  'my',
  'our',
]);
const TEMPLATE_ID = /^[a-z0-9-]{1,80}$/;

export function searchTemplates(
  templates: readonly DesignTemplateName[],
  query: string,
  limit: number,
  siteOrigin: string,
) {
  const byId = new Map(templates.map((template) => [template.id, template]));
  // The builds' own matcher first, which ranks closely and may find few.
  // The rest is filled from the designs that share the most of the query's
  // words, so a query the matcher has nothing for ("bakery") still finds
  // what is nearest rather than nothing.
  const ids = matchCatalogDesigns(query, templates, limit);
  if (ids.length < limit) {
    const words = [
      ...new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length >= 3 && !FILLER.has(word)),
      ),
    ];
    const chosen = new Set(ids);
    const scored = templates
      .filter(
        (template) =>
          template.format === 'design' &&
          !template.mergedInto &&
          !chosen.has(template.id),
      )
      .map((template) => {
        const text =
          `${template.name} ${template.summary} ${template.category} ${template.useCase}`.toLowerCase();
        return {
          id: template.id,
          score: words.filter((word) => text.includes(word)).length,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const entry of scored) {
      if (ids.length >= limit) break;
      ids.push(entry.id);
    }
  }
  return ids
    .map((id) => byId.get(id))
    .filter((template): template is DesignTemplateName => Boolean(template))
    .map((template) => ({
      id: template.id,
      name: template.name,
      summary: template.summary,
      kind: template.kind,
      category: template.category,
      url: `${siteOrigin}/templates/${template.id}`,
    }));
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<unknown> {
  switch (name) {
    case 'search_templates': {
      const query = stringArg(args, 'query', { required: true, max: 200 })!;
      const raw = args.limit;
      const limit =
        typeof raw === 'number' && Number.isInteger(raw)
          ? Math.min(10, Math.max(1, raw))
          : 5;
      const templates = searchTemplates(
        deps.templates,
        query,
        limit,
        deps.siteOrigin,
      );
      return { templates };
    }

    case 'list_projects': {
      const answer = await deps.api('GET', '/api/projects');
      if (answer.status !== 200) {
        throw new ToolError(
          errorOf(answer, 'Your projects could not be read.'),
        );
      }
      const projects = Array.isArray(record(answer.body).projects)
        ? (record(answer.body).projects as unknown[])
        : [];
      return {
        projects: projects.map((entry) => {
          const project = record(entry);
          const share = record(project.share);
          const site = project.site ? record(project.site) : null;
          return {
            id: project.id,
            name: project.name,
            archived: project.archived,
            hasCode: project.hasCode,
            editedAt: project.editedAt,
            shareUrl: share.url ?? null,
            site: site ? { url: site.url, state: site.state } : null,
          };
        }),
        builderUrl: deps.appOrigin,
      };
    }

    case 'start_build':
      return startBuild(args, deps);

    case 'get_build_status': {
      const runId = stringArg(args, 'runId', {
        required: true,
        pattern: PROJECT_ID,
      })!;
      const answer = await deps.api(
        'GET',
        `/api/runs/${encodeURIComponent(runId)}`,
      );
      if (answer.status !== 200) {
        throw new ToolError(errorOf(answer, 'That build could not be read.'));
      }
      const body = record(answer.body);
      const run = record(body.run);
      const snapshot = body.snapshot ? record(body.snapshot) : null;
      const files = Array.isArray(snapshot?.files)
        ? (snapshot!.files as unknown[])
            .map((file) => record(file).path)
            .filter((path): path is string => typeof path === 'string')
        : undefined;
      // The code itself stays in vibld: an assistant asking after a build
      // needs to know where it got to, not tens of thousands of characters
      // of source. The paths say what was made.
      return {
        ...run,
        ...(files ? { files } : {}),
        ...(run.state === 'accepted'
          ? {
              next: 'Call get_preview_url with the projectId to open it, or open the builder.',
            }
          : run.state === 'running' || run.state === undefined
            ? { next: 'Still building. Ask again in about 15 seconds.' }
            : {
                next: 'This build did not finish. The builder shows what happened; start_build can try again.',
              }),
        builderUrl: deps.appOrigin,
      };
    }

    case 'get_preview_url':
      return previewUrl(args, deps);

    default:
      throw new ToolError(`There is no tool called "${name}".`);
  }
}

async function startBuild(
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<unknown> {
  const prompt = stringArg(args, 'prompt', {
    required: true,
    max: MAX_PROMPT_CHARS,
  })!;
  // Checked before a place is taken, so a malformed call costs nothing.
  const named = stringArg(args, 'projectId', { pattern: PROJECT_ID });
  stringArg(args, 'templateId', { pattern: TEMPLATE_ID });
  if (!named) stringArg(args, 'projectName', { max: 80 });

  // The assistant's own limits, before anything is read or made. The
  // daily place is taken, not just counted, so two calls at once cannot
  // both have the last one; it is given back if no build starts.
  if (!(await deps.buildBurstAllowed())) {
    throw new ToolError(
      'Builds are being started too quickly. Wait a minute, then try again.',
    );
  }
  const place = await deps.reserveBuild();
  if (place === null) {
    throw new ToolError(
      `This account has started ${deps.dailyBuildLimit} builds from assistants in the last 24 hours, which is the most allowed. Builds started in the builder at ${deps.appOrigin} are not affected.`,
    );
  }
  let started: { runId: string; projectId: string };
  try {
    started = await startReserved(prompt, args, deps);
  } catch (error) {
    // Given back only when no build can have started; a build that may be
    // running keeps its place, or retries would escape the cap.
    if (!(error instanceof UncertainStart)) {
      await deps.releaseBuild(place).catch((failure: unknown) => {
        console.error('could not give back an assistant build place', failure);
      });
    }
    throw error;
  }

  // A failure to name the build is not a reason to tell the assistant it
  // did not start, because it did; the place stays taken either way.
  await deps
    .confirmBuild(place, started.runId, started.projectId)
    .catch((error: unknown) => {
      console.error('could not record an assistant build', error);
    });

  return {
    runId: started.runId,
    projectId: started.projectId,
    state: 'running',
    next: 'Call get_build_status with this runId about every 15 seconds until it ends.',
    builderUrl: deps.appOrigin,
  };
}

/** Everything `start_build` does once it holds a daily place. */
async function startReserved(
  request: string,
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<{ runId: string; projectId: string }> {
  let prompt = request;
  const projectId = stringArg(args, 'projectId', { pattern: PROJECT_ID });
  const templateId = stringArg(args, 'templateId', { pattern: TEMPLATE_ID });
  // Ignored with `projectId`, as the schema says, so it is not read then.
  const projectName = projectId
    ? undefined
    : stringArg(args, 'projectName', { max: 80 });

  // A template is added to the message as the builder's Templates option
  // adds it (D148): the brief after the request, a blank line between.
  if (templateId) {
    const brief = await deps.api(
      'GET',
      `/api/templates/brief?id=${encodeURIComponent(templateId)}`,
    );
    const text = record(brief.body).brief;
    if (brief.status !== 200 || typeof text !== 'string' || text === '') {
      throw new ToolError(errorOf(brief, 'That template could not be loaded.'));
    }
    if (prompt.length + 2 + text.length > MAX_PROMPT_CHARS) {
      throw new ToolError(
        `The request and the template's brief together are longer than ${MAX_PROMPT_CHARS} characters. Shorten the request.`,
      );
    }
    prompt = `${prompt}\n\n${text}`;
  }

  // Which project, and the code the build starts from. A new project
  // unless one is named, so an assistant never builds over whatever the
  // person last had open.
  let target: string;
  let base: { revision: string } | undefined;
  if (projectId) {
    const opened = await deps.api(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}`,
    );
    if (opened.status !== 200) {
      throw new ToolError(errorOf(opened, 'That project could not be opened.'));
    }
    const body = record(opened.body);
    if (body.build) {
      throw new ToolError(
        'A build is already running in this project. Wait for it to end (get_build_status), then try again.',
      );
    }
    const snapshot = body.snapshot ? record(body.snapshot) : null;
    if (snapshot && typeof snapshot.revision === 'string') {
      base = { revision: snapshot.revision };
    }
    target = projectId;
  } else {
    const made = await deps.api('POST', '/api/projects', {
      ...(projectName ? { name: projectName } : {}),
    });
    const project = record(record(made.body).project);
    if (made.status !== 201 || typeof project.id !== 'string') {
      throw new ToolError(errorOf(made, 'A new project could not be made.'));
    }
    target = project.id;
  }

  let started: BuildStart;
  try {
    started = await deps.startBuild({
      prompt,
      projectId: target,
      ...(base ? { base } : {}),
    });
  } catch (error) {
    console.error('could not ask /api/plan for a build', error);
    throw new UncertainStart(
      'The build may or may not have started. Check list_projects before trying again.',
    );
  }
  if (!started.ok) {
    // A 4xx is the builder refusing before any build began (no allowance,
    // the invite gate), so the project made for it is empty and goes, or a
    // few refused tries would fill a plan's project limit. Anything else
    // may have started a build, so the project and the daily place stay.
    if (started.status < 400 || started.status >= 500) {
      throw new UncertainStart(started.error);
    }
    if (!projectId && !(await removeProject(deps, target))) {
      // Still there, so the daily place stays taken too: refusals that
      // each leave a project behind are bounded by the cap.
      throw new UncertainStart(
        `${started.error} The empty project ${target} could not be removed.`,
      );
    }
    throw new ToolError(started.error);
  }
  return { runId: started.runId, projectId: target };
}

/** Whether a project made for a refused build is gone. */
async function removeProject(deps: McpDeps, id: string): Promise<boolean> {
  try {
    const removed = await deps.api(
      'DELETE',
      `/api/projects/${encodeURIComponent(id)}`,
    );
    if (removed.status < 300 || removed.status === 404) return true;
    console.error('could not remove an unused project', removed.status);
  } catch (error) {
    console.error('could not remove an unused project', error);
  }
  return false;
}

async function previewUrl(
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<unknown> {
  const projectId = stringArg(args, 'projectId', {
    required: true,
    pattern: PROJECT_ID,
  })!;
  const opened = await deps.api(
    'GET',
    `/api/projects/${encodeURIComponent(projectId)}`,
  );
  if (opened.status !== 200) {
    throw new ToolError(errorOf(opened, 'That project could not be opened.'));
  }
  const snapshot = record(opened.body).snapshot
    ? record(record(opened.body).snapshot)
    : null;
  if (
    !snapshot ||
    typeof snapshot.revision !== 'string' ||
    !Array.isArray(snapshot.files)
  ) {
    throw new ToolError(
      'This project has no finished build yet, so there is nothing to preview.',
    );
  }
  const revision = snapshot.revision;

  // An account has one preview. One already on this revision is answered
  // as it is. One on another revision is moved to this one (D74), or,
  // failing that, stopped and started again: `POST` alone would hand back
  // the other preview unchanged. One still waiting for a sandbox holds no
  // files yet, so `POST` keeps its place in the queue and gives it these.
  const current = await deps.api('GET', '/api/preview');
  const status = record(current.body);
  const live =
    current.status === 200 &&
    ['ready', 'installing', 'starting'].includes(String(status.status));
  if (live && status.revision === revision) return previewAnswer(status);
  // A move to this revision still installing (D74): left to finish.
  if (status.status === 'installing' && status.updatingTo === revision) {
    return previewAnswer(status);
  }
  const body = { files: snapshot.files, revision };
  if (live && status.status === 'ready') {
    // `{ outcome, status? }` (D74): applied serves this revision now, and
    // installing is on its way to it. Busy or restart moves nothing.
    const moved = await deps.api('PATCH', '/api/preview', body);
    const result = record(moved.body);
    if (moved.status === 200 && result.outcome === 'applied') {
      return previewAnswer(record(result.status));
    }
    if (moved.status === 200 && result.outcome === 'installing') {
      return previewAnswer({ status: 'installing' });
    }
  }
  if (live) await stopPreview(deps);

  let started = await startPreview(deps, body);
  // `POST` answers a preview already running with that preview, whatever
  // it serves; one the first look missed is stopped and started once more.
  if (servesOther(started, revision)) {
    await stopPreview(deps);
    started = await startPreview(deps, body);
    if (servesOther(started, revision)) {
      throw new ToolError(
        'The preview of another project is still running. Try again shortly.',
      );
    }
  }
  return previewAnswer(started);
}

function servesOther(
  status: Record<string, unknown>,
  revision: string,
): boolean {
  return typeof status.revision === 'string' && status.revision !== revision;
}

async function stopPreview(deps: McpDeps): Promise<void> {
  const stopped = await deps.api('DELETE', '/api/preview');
  if (stopped.status >= 400) {
    throw new ToolError(
      errorOf(stopped, 'The preview of another project could not be stopped.'),
    );
  }
}

async function startPreview(
  deps: McpDeps,
  body: { files: unknown; revision: string },
): Promise<Record<string, unknown>> {
  const started = await deps.api('POST', '/api/preview', body);
  if (started.status !== 200) {
    throw new ToolError(errorOf(started, 'The preview could not be started.'));
  }
  return record(started.body);
}

function previewAnswer(status: Record<string, unknown>) {
  if (status.status === 'ready') {
    return {
      status: 'ready',
      url: status.url,
      expiresAt:
        typeof status.expiresAt === 'number'
          ? new Date(status.expiresAt).toISOString()
          : undefined,
    };
  }
  if (status.status === 'failed') {
    throw new ToolError(
      typeof status.error === 'string' && status.error
        ? status.error
        : 'The preview failed to start.',
    );
  }
  return {
    status: status.status,
    ...(typeof status.position === 'number'
      ? { position: status.position }
      : {}),
    next: 'Starting. Call get_preview_url again in about 20 seconds.',
  };
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? {} : { structuredContent: value }),
    isError,
  };
}

async function dispatch(
  message: JsonRpcRequest,
  deps: McpDeps,
): Promise<Response> {
  const { id, method } = message;
  const params = record(message.params);
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') {
        return rpcError(id, INVALID_PARAMS, 'A tool name is required.');
      }
      if (!TOOLS.some((tool) => tool.name === name)) {
        return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      }
      try {
        return rpcResult(
          id,
          toolResult(await runTool(name, record(params.arguments), deps)),
        );
      } catch (error) {
        if (error instanceof ToolError) {
          return rpcResult(id, toolResult({ error: error.message }, true));
        }
        console.error('MCP tool failed', name, error);
        return rpcResult(
          id,
          toolResult(
            { error: 'Something went wrong in vibld. Try again shortly.' },
            true,
          ),
        );
      }
    }
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * One POST to `/mcp`, from an already authenticated caller.
 *
 * A notification (no id) or a response from the client is acknowledged
 * with 202 and no body, as the transport says. Batches are refused:
 * current versions of the protocol removed them.
 */
export async function handleMcpMessage(
  request: Request,
  deps: McpDeps,
): Promise<Response> {
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return rpcError(null, PARSE_ERROR, 'Body must be valid JSON.', 400);
  }
  if (Array.isArray(message)) {
    return rpcError(null, INVALID_REQUEST, 'Batches are not supported.', 400);
  }
  const rpc = record(message);
  if (rpc.jsonrpc !== '2.0') {
    return rpcError(null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 message.', 400);
  }
  if (typeof rpc.method !== 'string') {
    // A response to something we asked. We ask nothing, so it is noted
    // and dropped.
    return new Response(null, { status: 202 });
  }
  if (!('id' in rpc) || rpc.id === undefined) {
    return new Response(null, { status: 202 });
  }
  if (
    rpc.id !== null &&
    typeof rpc.id !== 'string' &&
    typeof rpc.id !== 'number'
  ) {
    return rpcError(null, INVALID_REQUEST, 'Invalid id.', 400);
  }
  return dispatch(rpc as unknown as JsonRpcRequest, deps);
}

/**
 * `/api/plan`'s answer, read only as far as the build's id.
 *
 * A refusal is JSON with its own status. A build that started is a stream
 * whose first event names it (`run`); reading stops there, which the route
 * takes as its caller leaving, and a build outlives that by design (keep
 * building). An `error` event before it is the build failing to start.
 */
export async function readBuildStart(
  response: Response,
  timeoutMs: number,
): Promise<BuildStart> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream') || !response.body) {
    let error = 'The build could not be started.';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error) error = body.error;
    } catch {
      // The fallback above says it.
    }
    return { ok: false, status: response.status, error };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => {
          timer = setTimeout(
            () => resolve(null),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
      clearTimeout(timer);
      if (next === null || next.done) break;
      buffered += decoder.decode(next.value, { stream: true });
      let end: number;
      while ((end = buffered.indexOf('\n\n')) !== -1) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === 'run' && typeof payload.runId === 'string') {
          return { ok: true, runId: payload.runId };
        }
        if (event === 'error') {
          return {
            ok: false,
            status: 502,
            error:
              typeof payload.message === 'string' && payload.message
                ? payload.message
                : typeof payload.error === 'string' && payload.error
                  ? payload.error
                  : 'The build could not be started.',
          };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return {
    ok: false,
    status: 504,
    error:
      'The build did not report starting in time. Check list_projects before trying again.',
  };
}

/** RFC 9728 metadata for `/mcp`, at its path-suffixed well-known address. */
export function protectedResourceMetadata(
  appOrigin: string,
  issuer: string,
): Record<string, unknown> {
  return {
    resource: `${appOrigin}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [MCP_SCOPE],
    resource_name: 'vibld',
  };
}

export const MCP_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

/** The 401 that sends an MCP client to sign the person in (RFC 9728 s5.1). */
export function mcpUnauthorized(
  appOrigin: string,
  reason: 'missing' | 'invalid' | 'insufficient_scope',
): Response {
  // RFC 6750 section 3, with the RFC 9728 pointer and the scope to ask for.
  const metadata = `resource_metadata="${appOrigin}${MCP_METADATA_PATH}"`;
  const scope = `scope="${MCP_SCOPE}"`;
  const [status, challenge, error] =
    reason === 'missing'
      ? [
          401,
          `Bearer ${metadata}, ${scope}`,
          'Sign in to vibld to use this server.',
        ]
      : reason === 'invalid'
        ? [
            401,
            `Bearer error="invalid_token", ${metadata}, ${scope}`,
            'This token is not valid for vibld. Sign in again.',
          ]
        : [
            403,
            `Bearer error="insufficient_scope", ${metadata}, ${scope}`,
            `This sign-in did not grant "${MCP_SCOPE}". Connect vibld again and approve it.`,
          ];
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...JSON_HEADERS, 'WWW-Authenticate': challenge },
  });
}
