import { matchCatalogDesigns } from '@vibld/ai/catalog-inspiration';
import type { DesignTemplateName } from '@vibld/ai/design-template-index';
import { MAX_BASE_CONTENT_CHARS, MAX_PROMPT_CHARS } from '@vibld/ai/limits';

import { EDIT_SCOPE, MCP_SCOPE, type McpCaller } from './mcp-auth.ts';

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
 * The editing tools (D190) work on a project's files without a build:
 * read them, write them, type-check them, and go back to a checkpoint.
 * They spend no model and nothing is billed for them (D201); each call
 * takes one of the plan's calls a day instead (`EDIT_TOOLS` below). They
 * need the `edit` scope as well as `build`, and a token without it is
 * challenged to step up before anything is counted or read (`mcpStepUp`).
 * take_screenshot is one of them, offered only where Browser Rendering is
 * bound (`McpDeps.screenshot`).
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
  "vibld builds websites and web apps from a description. Find a starting design with search_templates, start a build with start_build, then poll get_build_status until it ends (a build takes several minutes). Open the result with get_preview_url. Builds are billed to the signed-in account, as they are in the builder at https://app.vibld.com. To change a project's code yourself instead, read it with list_files and read_files, change it with write_files (naming the revision you read as baseRevision), then run check_types. list_checkpoints and restore_checkpoint go back to earlier code, get_logs reports the preview and the project's recent builds, and take_screenshot, when it is listed, shows the preview at a desktop, tablet or phone width. The editing tools need the account to approve editing when it connects vibld, cost no credit, and each call counts toward a daily number set by the account's plan.";

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
  /**
   * Takes one of the account's calls to the editing tools for the last 24
   * hours (D201), atomically, for `tool` in `projectId`. `limit` is the
   * plan's cap, which a refusal names.
   */
  takeEditCall: (
    tool: string,
    projectId: string,
  ) => Promise<{ taken: boolean; limit: number }>;
  /**
   * Cloudflare Browser Rendering, for take_screenshot. Absent where the
   * Worker has no `BROWSER` binding (a self-hosted copy under Docker), and
   * then the tool is not listed.
   */
  screenshot?: ScreenshotDeps;
}

/** The widths take_screenshot offers: the builder's Desktop, Tablet and Phone (D192). */
export const SCREENSHOT_WIDTHS = [1280, 768, 390] as const;
export type ScreenshotWidth = (typeof SCREENSHOT_WIDTHS)[number];

export interface ScreenshotDeps {
  /** False when this account is taking screenshots too fast: browser time is billed. */
  burstAllowed: () => Promise<boolean>;
  /** One page loaded in a headless browser and captured (`screenshot.ts`). */
  capture: (
    url: string,
    options: { width: ScreenshotWidth; fullPage: boolean },
  ) => Promise<Screenshot>;
}

export interface Screenshot {
  /** The image, base64. */
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** True when a full-page capture was cut at its height limit. */
  clipped: boolean;
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
/** Server-defined: the token lacks a scope the call needs (`mcpStepUp`). */
const INSUFFICIENT_SCOPE = -32001;

/** The newest version both sides speak, or ours when the client's is unknown. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
}

const ID_PATTERN = '^[0-9a-f-]{36}$';
/** A revision, as `project-handlers.ts` holds one. */
const REVISION_PATTERN = '^[A-Za-z0-9_-]{1,64}$';
/** The longest path a project file may have (`DEFAULT_LIMITS`). */
const MAX_PATH_CHARS = 256;

/** The most files one read_files or write_files call names. */
export const MAX_TOOL_FILES = 20;
/**
 * The most file content one read_files answers with. A file past it is
 * named with its size and left for another call, so one answer never
 * fills an assistant's context with a whole project.
 */
export const MAX_READ_CHARS = 100_000;
/** The most of a failed type check's output check_types passes on. */
export const MAX_TYPECHECK_CHARS = 20_000;
/** The longest page path take_screenshot loads. */
const MAX_SCREENSHOT_PATH_CHARS = 512;
/** How tall a full-page screenshot may be, in CSS pixels, before it is cut. */
export const MAX_SCREENSHOT_HEIGHT = 8_000;

const PROJECT_ID_INPUT = {
  type: 'string',
  pattern: ID_PATTERN,
  description: 'The project (from list_projects).',
} as const;

const PATH_INPUT = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_PATH_CHARS,
  description:
    'A path relative to the project root, with forward slashes: "src/App.tsx".',
} as const;

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
  {
    name: 'list_files',
    title: 'List files',
    description:
      "The files in a project's current code: each path and its size in characters, and the revision they are at, which write_files names as baseRevision. Counts toward the plan's daily editing calls.",
    inputSchema: {
      type: 'object',
      properties: { projectId: PROJECT_ID_INPUT },
      required: ['projectId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_files',
    title: 'Read files',
    description: `The contents of up to ${MAX_TOOL_FILES} files in a project's current code, or in one of its checkpoints with revision (from list_checkpoints). At most ${MAX_READ_CHARS} characters of content come back. A file that does not fit beside the others is named with its size and left out, to read in another call; one file longer than that comes back in parts: read it alone, then again with offset set to the nextOffset each part reports. Counts toward the plan's daily editing calls.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_INPUT,
        paths: {
          type: 'array',
          items: PATH_INPUT,
          minItems: 1,
          maxItems: MAX_TOOL_FILES,
          description: 'The files to read (from list_files).',
        },
        revision: {
          type: 'string',
          pattern: REVISION_PATTERN,
          description:
            'A checkpoint to read from instead of the current code. Leave out for the current code.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description:
            'With one path only: the character to start reading from, the nextOffset a part of a long file reported. Defaults to 0.',
        },
      },
      required: ['projectId', 'paths'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'write_files',
    title: 'Write files',
    description: `Write up to ${MAX_TOOL_FILES} files into a project's current code, and delete up to ${MAX_TOOL_FILES}, with no build. The change becomes the project's code at once, as a new revision and a checkpoint restore_checkpoint can undo. baseRevision is the revision the change was made against (from list_files or read_files): if the project has changed since, nothing is written and the error names the current revision to read again. Refused while a build runs. Costs no credit; counts toward the plan's daily editing calls. Run check_types afterwards. With dryRun true nothing is written: the answer is a line diff of each changed file and a type check of the changed code, run by moving the account's one preview onto it (call again with the same arguments while the preview starts); check_types or get_preview_url moves the preview back.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_INPUT,
        baseRevision: {
          type: 'string',
          pattern: REVISION_PATTERN,
          description:
            'The revision list_files or read_files reported for the code this change was made against.',
        },
        files: {
          type: 'array',
          maxItems: MAX_TOOL_FILES,
          description:
            'Files to write: each one replaces the file at its path, or is added.',
          items: {
            type: 'object',
            properties: {
              path: PATH_INPUT,
              content: {
                type: 'string',
                maxLength: MAX_BASE_CONTENT_CHARS,
                description: "The file's whole new content.",
              },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
        delete: {
          type: 'array',
          items: PATH_INPUT,
          maxItems: MAX_TOOL_FILES,
          description: 'Paths of files to delete. Each must be in the project.',
        },
        dryRun: {
          type: 'boolean',
          description:
            'True to see the diff and type check of this change without writing it. Defaults to false.',
        },
      },
      required: ['projectId', 'baseRevision'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It replaces the project's current code with a new revision.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'check_types',
    title: 'Check types',
    description:
      "Type-check a project's current code in its live preview, starting the preview if it is not running, which takes a minute or two: call again until the status is ready. Says whether the check passed and, if not, what the compiler reported. Uses the account's one preview, as get_preview_url does. Counts toward the plan's daily editing calls.",
    inputSchema: {
      type: 'object',
      properties: { projectId: PROJECT_ID_INPUT },
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
  {
    name: 'list_checkpoints',
    title: 'List checkpoints',
    description:
      "A project's checkpoints, newest first: each revision its code has been at, what made it (a build, a repair, an edit, a restore) and when, and which is current. Counts toward the plan's daily editing calls.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_INPUT,
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'How many to return. Defaults to 20.',
        },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'restore_checkpoint',
    title: 'Restore checkpoint',
    description:
      "Make one of a project's checkpoints (from list_checkpoints) its current code again. baseRevision is the current revision list_checkpoints reported: if the project has changed since, nothing moves. The code being replaced stays in the history. Refused while a build runs. Costs no credit; counts toward the plan's daily editing calls.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_INPUT,
        revision: {
          type: 'string',
          pattern: REVISION_PATTERN,
          description: 'The checkpoint to restore.',
        },
        baseRevision: {
          type: 'string',
          pattern: REVISION_PATTERN,
          description: 'The current revision list_checkpoints reported.',
        },
      },
      required: ['projectId', 'revision', 'baseRevision'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_logs',
    title: 'Get logs',
    description:
      "What vibld records about a project's code running: the account's live preview (its state, and its type check when it is serving this project's current code) and how the project's recent builds ended. Server output, runtime errors and the browser console are not captured, so they are not here. Starts nothing. Counts toward the plan's daily editing calls.",
    inputSchema: {
      type: 'object',
      properties: { projectId: PROJECT_ID_INPUT },
      required: ['projectId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'take_screenshot',
    title: 'Take screenshot',
    description:
      "A picture of a project's current code running in its live preview, as a desktop (1280), tablet (768) or phone (390) browser sees it. Starts the preview if it is not running, which takes a minute or two: call again until the image comes back. Uses the account's one preview, as get_preview_url does. Counts toward the plan's daily editing calls.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_INPUT,
        path: {
          type: 'string',
          pattern: '^/',
          maxLength: MAX_SCREENSHOT_PATH_CHARS,
          description:
            'The page to load in the preview, from its root: "/" or "/pricing". Defaults to "/".',
        },
        width: {
          type: 'integer',
          enum: [...SCREENSHOT_WIDTHS],
          description:
            'The browser width: 1280 (desktop), 768 (tablet) or 390 (phone). Defaults to 1280.',
        },
        fullPage: {
          type: 'boolean',
          description: `The whole page, to at most ${MAX_SCREENSHOT_HEIGHT} pixels tall, rather than what fits in the window. Defaults to false.`,
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

/** Tools only listed and served where their dependency is lent. */
function toolsFor(deps: McpDeps) {
  return deps.screenshot
    ? TOOLS
    : TOOLS.filter((tool) => tool.name !== 'take_screenshot');
}

/**
 * The editing tools (D190). Every call to one, a read as much as a write,
 * takes one of the plan's calls a day (D201); the five tools before them
 * do not, and builds have their own cap. Each needs the `edit` scope.
 */
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
  'list_files',
  'read_files',
  'write_files',
  'check_types',
  'list_checkpoints',
  'restore_checkpoint',
  'get_logs',
  'take_screenshot',
]);

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
const REVISION = /^[A-Za-z0-9_-]{1,64}$/;
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

    case 'list_files':
    case 'read_files':
    case 'write_files':
    case 'check_types':
    case 'list_checkpoints':
    case 'restore_checkpoint':
    case 'get_logs':
    case 'take_screenshot':
      return runEditTool(name, args, deps);

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
  return previewAnswer(await ensurePreview(projectId, deps));
}

/**
 * The account's one preview, started on or moved to the project's
 * accepted code if it is not already serving it, as far as it has got:
 * its status, which `get_preview_url` and `check_types` each read their
 * own way.
 */
async function ensurePreview(
  projectId: string,
  deps: McpDeps,
): Promise<Record<string, unknown>> {
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
  return previewOn(
    { files: snapshot.files, revision: snapshot.revision },
    deps,
  );
}

/**
 * The account's one preview, started on or moved to `code` if it is not
 * already serving it: the project's accepted code, or a write_files dry
 * run's draft.
 */
async function previewOn(
  code: { files: unknown; revision: string },
  deps: McpDeps,
): Promise<Record<string, unknown>> {
  const revision = code.revision;

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
  if (live && status.revision === revision) return status;
  // A move to this revision still installing (D74): left to finish.
  if (status.status === 'installing' && status.updatingTo === revision) {
    return status;
  }
  const body = { files: code.files, revision };
  if (live && status.status === 'ready') {
    // `{ outcome, status? }` (D74): applied serves this revision now, and
    // installing is on its way to it. Busy or restart moves nothing.
    const moved = await deps.api('PATCH', '/api/preview', body);
    const result = record(moved.body);
    if (moved.status === 200 && result.outcome === 'applied') {
      return record(result.status);
    }
    if (moved.status === 200 && result.outcome === 'installing') {
      return { status: 'installing' };
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
  return started;
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

// -------------------------------------------------------------------------
// The editing tools (D190), each call counted against the plan (D201).
// -------------------------------------------------------------------------

/**
 * One call to an editing tool: its arguments checked, then one of the
 * plan's daily calls taken, then the work. In that order, so a malformed
 * call costs nothing and a refused one has read nothing.
 */
async function runEditTool(
  name: string,
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<unknown> {
  const projectId = stringArg(args, 'projectId', {
    required: true,
    pattern: PROJECT_ID,
  })!;
  const project = encodeURIComponent(projectId);
  switch (name) {
    case 'list_files': {
      await takeEditCall(name, projectId, deps);
      const snapshot = await readCode(deps, project);
      return {
        projectId,
        revision: snapshot.revision,
        files: snapshot.files.map((file) => ({
          path: file.path,
          chars: file.content.length,
        })),
      };
    }

    case 'read_files': {
      const paths = pathsArg(args, 'paths', { required: true });
      const revision = stringArg(args, 'revision', { pattern: REVISION });
      const offset = offsetArg(args, paths);
      await takeEditCall(name, projectId, deps);
      const snapshot = await readCode(deps, project, revision);
      return readAnswer(projectId, snapshot, paths, offset);
    }

    case 'write_files': {
      const base = stringArg(args, 'baseRevision', {
        required: true,
        pattern: REVISION,
      })!;
      const files = filesArg(args);
      const remove = pathsArg(args, 'delete');
      if (files.length === 0 && remove.length === 0) {
        throw new ToolError('Name at least one file to write or delete.');
      }
      const raw = args.dryRun;
      if (raw !== undefined && typeof raw !== 'boolean') {
        throw new ToolError('"dryRun" must be true or false.');
      }
      const dryRun = raw === true;
      await takeEditCall(name, projectId, deps);
      const answer = await deps.api('PUT', `/api/projects/${project}/files`, {
        base,
        files,
        ...(remove.length > 0 ? { delete: remove } : {}),
        ...(dryRun ? { dryRun: true } : {}),
      });
      if (dryRun) return dryRunAnswer(projectId, answer, deps);
      const snapshot = snapshotOf(answer, 'The files could not be written.');
      return {
        projectId,
        revision: snapshot.revision,
        written: files.map((file) => file.path),
        deleted: remove,
        files: snapshot.files.length,
        next: 'Call check_types to type-check the new code, or get_preview_url to open it.',
      };
    }

    case 'check_types': {
      await takeEditCall(name, projectId, deps);
      return typecheckAnswer(await ensurePreview(projectId, deps));
    }

    case 'list_checkpoints': {
      const raw = args.limit;
      if (
        raw !== undefined &&
        raw !== null &&
        (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1)
      ) {
        throw new ToolError('"limit" must be a whole number from 1 to 100.');
      }
      const limit = typeof raw === 'number' ? Math.min(100, raw) : 20;
      await takeEditCall(name, projectId, deps);
      const answer = await deps.api(
        'GET',
        `/api/projects/${project}/checkpoints`,
      );
      if (answer.status !== 200) {
        throw new ToolError(
          errorOf(answer, "That project's history could not be read."),
        );
      }
      const body = record(answer.body);
      const checkpoints = Array.isArray(body.checkpoints)
        ? (body.checkpoints as unknown[])
        : [];
      return {
        projectId,
        current: body.current ?? null,
        checkpoints: checkpoints.slice(0, limit).map((entry) => {
          const checkpoint = record(entry);
          return {
            revision: checkpoint.revision,
            kind: checkpoint.kind,
            acceptedAt: checkpoint.acceptedAt,
          };
        }),
        ...(checkpoints.length > limit ? { more: true } : {}),
      };
    }

    case 'restore_checkpoint': {
      const revision = stringArg(args, 'revision', {
        required: true,
        pattern: REVISION,
      })!;
      const base = stringArg(args, 'baseRevision', {
        required: true,
        pattern: REVISION,
      })!;
      await takeEditCall(name, projectId, deps);
      const answer = await deps.api(
        'POST',
        `/api/projects/${project}/checkpoints/restore`,
        { revision, base },
      );
      const snapshot = snapshotOf(
        answer,
        'That checkpoint could not be restored.',
      );
      return {
        projectId,
        revision: snapshot.revision,
        files: snapshot.files.length,
        next: 'Call check_types or get_preview_url to see the restored code.',
      };
    }

    case 'get_logs':
      await takeEditCall(name, projectId, deps);
      return logs(projectId, deps);

    case 'take_screenshot':
      return takeScreenshot(projectId, args, deps);

    default:
      throw new ToolError(`There is no tool called "${name}".`);
  }
}

async function takeEditCall(
  name: string,
  projectId: string,
  deps: McpDeps,
): Promise<void> {
  const { taken, limit } = await deps.takeEditCall(name, projectId);
  if (!taken) {
    throw new ToolError(
      `This account's assistants have made ${limit} calls to vibld's editing tools in the last 24 hours, which is the most its plan allows. Try again later. Editing in the builder at ${deps.appOrigin} is not affected.`,
    );
  }
}

/**
 * read_files' `offset`: where in its one file a read starts. A part of a
 * file longer than one call's budget names the next as `nextOffset`, so
 * every file a project may hold can be read, however long.
 */
function offsetArg(args: Record<string, unknown>, paths: string[]): number {
  const raw = args.offset;
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new ToolError('"offset" must be a whole number, 0 or more.');
  }
  if (paths.length !== 1) {
    throw new ToolError(
      '"offset" reads part of one file: name a single path with it.',
    );
  }
  return raw;
}

/**
 * The files read_files names, within the budget of one call. A file that
 * does not fit beside the ones before it is named and left for another
 * call. One that does not fit even alone, read first, comes back in parts.
 */
function readAnswer(
  projectId: string,
  snapshot: Code,
  paths: string[],
  offset: number,
) {
  const byPath = new Map(
    snapshot.files.map((file) => [file.path, file.content]),
  );
  const files: {
    path: string;
    content: string;
    offset?: number;
    nextOffset?: number;
    chars?: number;
  }[] = [];
  const omitted: { path: string; chars: number }[] = [];
  const missing: string[] = [];
  let budget = MAX_READ_CHARS;
  let part: { path: string; nextOffset: number } | undefined;
  for (const path of paths) {
    const content = byPath.get(path);
    if (content === undefined) {
      missing.push(path);
      continue;
    }
    if (offset > content.length) {
      throw new ToolError(
        `"offset" is past the end of ${path}, which has ${content.length} characters.`,
      );
    }
    const rest = content.length - offset;
    if (rest <= budget) {
      files.push({
        path,
        content: offset === 0 ? content : content.slice(offset),
        ...(offset > 0 ? { offset, chars: content.length } : {}),
      });
      budget -= rest;
    } else if (files.length === 0 && part === undefined) {
      const nextOffset = offset + budget;
      files.push({
        path,
        content: content.slice(offset, nextOffset),
        offset,
        nextOffset,
        chars: content.length,
      });
      part = { path, nextOffset };
      budget = 0;
    } else {
      omitted.push({ path, chars: content.length });
    }
  }
  const next = part
    ? `Only part of ${part.path} came back. Call read_files with paths ["${part.path}"] and offset ${part.nextOffset} for the next part.`
    : omitted.length > 0
      ? `Over the ${MAX_READ_CHARS} characters one call returns. Read the omitted files in another call.`
      : undefined;
  return {
    projectId,
    revision: snapshot.revision,
    files,
    ...(omitted.length > 0 ? { omitted } : {}),
    ...(next ? { next } : {}),
    ...(missing.length > 0 ? { missing } : {}),
  };
}

/** A list of project paths, each checked as the schema says. */
function pathsArg(
  args: Record<string, unknown>,
  name: string,
  options: { required?: boolean } = {},
): string[] {
  const value = args[name];
  if (value === undefined || value === null) {
    if (options.required) throw new ToolError(`"${name}" is required.`);
    return [];
  }
  if (!Array.isArray(value)) throw new ToolError(`"${name}" must be a list.`);
  if (options.required && value.length === 0) {
    throw new ToolError(`"${name}" must name at least one file.`);
  }
  if (value.length > MAX_TOOL_FILES) {
    throw new ToolError(
      `"${name}" may name at most ${MAX_TOOL_FILES} files at once.`,
    );
  }
  return value.map((path) => checkedPath(path, name));
}

function checkedPath(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.length > MAX_PATH_CHARS
  ) {
    throw new ToolError(
      `Every path in "${name}" must be a string of 1 to ${MAX_PATH_CHARS} characters.`,
    );
  }
  return value;
}

/** write_files' `files`, each a path and its whole content. */
function filesArg(
  args: Record<string, unknown>,
): { path: string; content: string }[] {
  const value = args.files;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ToolError('"files" must be a list.');
  if (value.length > MAX_TOOL_FILES) {
    throw new ToolError(
      `"files" may name at most ${MAX_TOOL_FILES} files at once.`,
    );
  }
  return value.map((entry) => {
    const file = record(entry);
    if (typeof file.content !== 'string') {
      throw new ToolError('Every file in "files" needs a string "content".');
    }
    if (file.content.length > MAX_BASE_CONTENT_CHARS) {
      throw new ToolError(
        `A file's content must be ${MAX_BASE_CONTENT_CHARS} characters or fewer.`,
      );
    }
    return { path: checkedPath(file.path, 'files'), content: file.content };
  });
}

interface Code {
  revision: string;
  files: { path: string; content: string }[];
}

/** The project's accepted code, or one checkpoint's. */
async function readCode(
  deps: McpDeps,
  project: string,
  revision?: string,
): Promise<Code> {
  const answer = await deps.api(
    'GET',
    `/api/projects/${project}/files${
      revision ? `?revision=${encodeURIComponent(revision)}` : ''
    }`,
  );
  return snapshotOf(answer, "That project's files could not be read.");
}

/**
 * The code a files route or a restore answered with. A refusal because the
 * project moved on names the revision it is at now, so the assistant can
 * read it again rather than guess.
 */
function snapshotOf(answer: ApiAnswer, fallback: string): Code {
  const body = record(answer.body);
  if (answer.status !== 200) {
    const message = errorOf(answer, fallback);
    throw new ToolError(
      body.code === 'checkpoint-moved' && typeof body.current === 'string'
        ? `${message} The current revision is ${body.current}.`
        : message,
    );
  }
  const snapshot = record(body.snapshot);
  const files = Array.isArray(snapshot.files)
    ? (snapshot.files as unknown[]).map(record)
    : null;
  if (
    typeof snapshot.revision !== 'string' ||
    !files ||
    files.some(
      (file) =>
        typeof file.path !== 'string' || typeof file.content !== 'string',
    )
  ) {
    throw new ToolError(fallback);
  }
  return {
    revision: snapshot.revision,
    files: files as unknown as Code['files'],
  };
}

/**
 * write_files with dryRun: the files route checked the change and wrote
 * nothing. Its draft is type-checked on the preview, and every file it
 * adds, changes or deletes is shown as a line diff against the base.
 */
async function dryRunAnswer(
  projectId: string,
  answer: ApiAnswer,
  deps: McpDeps,
): Promise<unknown> {
  const draft = snapshotOf(answer, 'The change could not be checked.');
  const base = snapshotOf(
    { ...answer, body: { snapshot: record(answer.body).base } },
    'The change could not be checked.',
  );
  const before = new Map(base.files.map((file) => [file.path, file.content]));
  const after = new Map(draft.files.map((file) => [file.path, file.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
  let diff = paths
    .map((path) => fileDiff(path, before.get(path), after.get(path)))
    .join('');
  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n[cut at ${MAX_DIFF_CHARS} characters]\n`;
  }
  const checked = typecheckAnswer(await previewOn(draft, deps), {
    fix: 'Change the files and call write_files with dryRun again, or write them without dryRun.',
    again:
      'The preview is starting so the change can be checked. Call write_files again with the same arguments in about 20 seconds.',
  });
  return {
    projectId,
    dryRun: true,
    baseRevision: base.revision,
    changed: paths,
    diff,
    ...checked,
    ...(checked.typecheck === 'passed'
      ? {
          next: 'Nothing was written. Call write_files again without dryRun to write the change.',
        }
      : {}),
  };
}

/** The most characters of diff one dry run answers with. */
export const MAX_DIFF_CHARS = 100_000;

/** Lines compared with a full LCS; a longer differing middle is one hunk. */
const MAX_DIFF_CELLS = 4_000_000;

/**
 * One file's change as a unified diff with three lines of context, from
 * `undefined` (added) or to `undefined` (deleted).
 */
export function fileDiff(
  path: string,
  before: string | undefined,
  after: string | undefined,
): string {
  const a = before === undefined ? [] : splitLines(before);
  const b = after === undefined ? [] : splitLines(after);
  const header = `--- ${before === undefined ? '/dev/null' : diffName('a', path)}\n+++ ${
    after === undefined ? '/dev/null' : diffName('b', path)
  }\n`;
  const ops = lineOps(a, b);
  const context = 3;
  let out = header;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === ' ') {
      i += 1;
      continue;
    }
    // A hunk runs from `context` lines before a change to `context` lines
    // after the last change closer than twice that to the next one.
    let start = i;
    while (start > 0 && i - start < context && ops[start - 1].kind === ' ') {
      start -= 1;
    }
    let end = i;
    let quiet = 0;
    while (end < ops.length && quiet <= 2 * context) {
      quiet = ops[end].kind === ' ' ? quiet + 1 : 0;
      end += 1;
    }
    end -= Math.max(0, quiet - context);
    const hunk = ops.slice(start, end);
    const first = ops[start];
    const oldCount = hunk.filter((op) => op.kind !== '+').length;
    const newCount = hunk.filter((op) => op.kind !== '-').length;
    out += `@@ -${oldCount === 0 ? first.a : first.a + 1},${oldCount} +${
      newCount === 0 ? first.b : first.b + 1
    },${newCount} @@\n`;
    // Lines keep their newline, so a last line without one differs from
    // the same line with one, and is marked as git marks it.
    for (const op of hunk) {
      out += op.line.endsWith('\n')
        ? `${op.kind}${op.line}`
        : `${op.kind}${op.line}\n\\ No newline at end of file\n`;
    }
    i = end;
  }
  return out;
}

/**
 * A path as a diff header names it: as it is when it is plain printable
 * ASCII, else quoted and escaped as a JSON string (as git C-quotes it), so
 * a newline in a path cannot read as another header.
 */
function diffName(side: 'a' | 'b', path: string): string {
  const name = `${side}/${path}`;
  return /^[\x21-\x7e]+$/.test(name) && !/["\\]/.test(name)
    ? name
    : JSON.stringify(name);
}

/** Each line with its newline, if it has one. */
function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/);
}

interface LineOp {
  kind: ' ' | '-' | '+';
  line: string;
  /** Lines of `a` and `b` before this one. */
  a: number;
  b: number;
}

/** The edit from `a` to `b`, line by line. */
function lineOps(a: string[], b: string[]): LineOp[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const ops: LineOp[] = [];
  for (let k = 0; k < head; k += 1) {
    ops.push({ kind: ' ', line: a[k], a: k, b: k });
  }
  const push = (kind: LineOp['kind'], line: string, x: number, y: number) =>
    ops.push({ kind, line, a: head + x, b: head + y });
  if ((midA.length + 1) * (midB.length + 1) > MAX_DIFF_CELLS) {
    midA.forEach((line, x) => push('-', line, x, 0));
    midB.forEach((line, y) => push('+', line, midA.length, y));
  } else {
    // lcs[x][y]: the longest common run of midA from x and midB from y.
    const width = midB.length + 1;
    const lcs = new Uint32Array((midA.length + 1) * width);
    for (let x = midA.length - 1; x >= 0; x -= 1) {
      for (let y = midB.length - 1; y >= 0; y -= 1) {
        lcs[x * width + y] =
          midA[x] === midB[y]
            ? lcs[(x + 1) * width + y + 1] + 1
            : Math.max(lcs[(x + 1) * width + y], lcs[x * width + y + 1]);
      }
    }
    let x = 0;
    let y = 0;
    while (x < midA.length || y < midB.length) {
      if (x < midA.length && y < midB.length && midA[x] === midB[y]) {
        push(' ', midA[x], x, y);
        x += 1;
        y += 1;
      } else if (
        y >= midB.length ||
        (x < midA.length && lcs[(x + 1) * width + y] >= lcs[x * width + y + 1])
      ) {
        push('-', midA[x], x, y);
        x += 1;
      } else {
        push('+', midB[y], x, y);
        y += 1;
      }
    }
  }
  for (let k = 0; k < tail; k += 1) {
    ops.push({
      kind: ' ',
      line: a[a.length - tail + k],
      a: a.length - tail + k,
      b: b.length - tail + k,
    });
  }
  return ops;
}

/** A preview's status, read for its type check. */
function typecheckAnswer(
  status: Record<string, unknown>,
  hints: { fix: string; again: string } = {
    fix: 'Fix what it reports with write_files, then call check_types again.',
    again:
      'The preview is starting so the code can be checked. Call check_types again in about 20 seconds.',
  },
): Record<string, unknown> {
  if (status.status === 'ready') {
    const failure =
      typeof status.typecheckFailure === 'string'
        ? status.typecheckFailure
        : '';
    return failure === ''
      ? { status: 'ready', typecheck: 'passed' }
      : {
          status: 'ready',
          typecheck: 'failed',
          output:
            failure.length > MAX_TYPECHECK_CHARS
              ? `${failure.slice(0, MAX_TYPECHECK_CHARS)}\n[cut at ${MAX_TYPECHECK_CHARS} characters]`
              : failure,
          next: hints.fix,
        };
  }
  if (status.status === 'failed') {
    throw new ToolError(
      typeof status.error === 'string' && status.error
        ? status.error
        : 'The preview failed to start, so the code could not be checked.',
    );
  }
  return {
    status: status.status,
    ...(typeof status.position === 'number'
      ? { position: status.position }
      : {}),
    next: hints.again,
  };
}

/**
 * get_logs: what is recorded, read without starting anything. The
 * preview is the account's one, so its state is this project's only when
 * it serves this project's current code; otherwise the answer says it is
 * serving something else rather than passing another project's on.
 */
async function logs(projectId: string, deps: McpDeps): Promise<unknown> {
  const project = encodeURIComponent(projectId);
  const [history, preview, runs] = await Promise.all([
    deps.api('GET', `/api/projects/${project}/checkpoints`),
    deps.api('GET', '/api/preview').catch(() => null),
    deps.api('GET', `/api/runs?project=${project}`).catch(() => null),
  ]);
  if (history.status !== 200) {
    throw new ToolError(errorOf(history, 'That project could not be read.'));
  }
  const current = record(history.body).current;
  const revision = typeof current === 'string' ? current : null;

  const status = preview?.status === 200 ? record(preview.body) : null;
  let previewState: Record<string, unknown>;
  if (!status) {
    previewState = { status: 'unknown' };
  } else if (status.status === 'failed') {
    previewState = {
      status: 'failed',
      ...(typeof status.error === 'string' ? { error: status.error } : {}),
    };
  } else if (
    !['ready', 'installing', 'starting'].includes(String(status.status))
  ) {
    previewState = { status: 'not-running' };
  } else if (revision === null || status.revision !== revision) {
    previewState = {
      status: 'serving-other-code',
      note: "The account's preview is not serving this project's current code. check_types or get_preview_url starts it on this code.",
    };
  } else if (status.status === 'ready') {
    const checked = typecheckAnswer(status);
    previewState = {
      status: 'ready',
      typecheck: checked.typecheck,
      ...('output' in checked ? { typecheckOutput: checked.output } : {}),
    };
  } else {
    previewState = { status: status.status };
  }

  const traces =
    runs?.status === 200 && Array.isArray(record(runs.body).runs)
      ? (record(runs.body).runs as unknown[]).map(record)
      : null;
  return {
    projectId,
    revision,
    preview: previewState,
    builds: traces
      ? traces.slice(0, 10).map((trace) => ({
          runId: trace.runId,
          outcome: trace.stop,
          model: trace.model,
          endedAt: trace.endedAt,
          seconds:
            typeof trace.elapsedMs === 'number'
              ? Math.round(trace.elapsedMs / 1000)
              : undefined,
        }))
      : 'unavailable',
    notCaptured:
      "vibld does not record a running project's server output, runtime errors or browser console, so they are not here. The type check is the preview's.",
  };
}

/**
 * take_screenshot: the preview brought to the project's current code, as
 * check_types brings it, then one page of it loaded in a headless browser.
 *
 * The browser opens the preview's own URL, which `/api/preview` hands only
 * to the account it belongs to and which carries the preview's token; it
 * is given no other access. The page path is resolved against that URL and
 * must stay on its origin.
 */
async function takeScreenshot(
  projectId: string,
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<unknown> {
  const browser = deps.screenshot;
  if (!browser) {
    throw new ToolError('Screenshots are not available on this server.');
  }
  const path =
    stringArg(args, 'path', { max: MAX_SCREENSHOT_PATH_CHARS }) ?? '/';
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ToolError('"path" must start with a single "/": "/pricing".');
  }
  const width = args.width ?? 1280;
  if (!(SCREENSHOT_WIDTHS as readonly unknown[]).includes(width)) {
    throw new ToolError('"width" must be 1280, 768 or 390.');
  }
  const fullPage = args.fullPage ?? false;
  if (typeof fullPage !== 'boolean') {
    throw new ToolError('"fullPage" must be true or false.');
  }

  // Before the daily call, so a burst refused costs nothing: each capture
  // holds a browser, whose time is billed.
  if (!(await browser.burstAllowed())) {
    throw new ToolError(
      'Screenshots are being taken too quickly. Wait a minute, then try again.',
    );
  }
  await takeEditCall('take_screenshot', projectId, deps);
  const status = await ensurePreview(projectId, deps);
  if (status.status === 'failed') {
    throw new ToolError(
      typeof status.error === 'string' && status.error
        ? status.error
        : 'The preview failed to start, so there is nothing to take a picture of.',
    );
  }
  if (status.status !== 'ready' || typeof status.url !== 'string') {
    return {
      status: status.status,
      ...(typeof status.position === 'number'
        ? { position: status.position }
        : {}),
      next: 'The preview is starting. Call take_screenshot again in about 20 seconds.',
    };
  }
  let page: URL;
  try {
    const base = new URL(status.url);
    page = new URL(path, base);
    if (page.origin !== base.origin) throw new Error('another origin');
  } catch {
    throw new ToolError('"path" is not a page of this preview.');
  }
  let shot: Screenshot;
  try {
    shot = await browser.capture(page.href, {
      width: width as ScreenshotWidth,
      fullPage,
    });
  } catch (error) {
    console.error('could not take a screenshot', error);
    throw new ToolError(
      'The page could not be captured: it may not have loaded in time. Try again, or open it with get_preview_url.',
    );
  }
  return new ImageResult(shot, {
    projectId,
    path,
    width: shot.width,
    height: shot.height,
    format: shot.mimeType === 'image/png' ? 'png' : 'jpeg',
    ...(shot.clipped
      ? { clipped: `Cut at ${MAX_SCREENSHOT_HEIGHT} pixels tall.` }
      : {}),
  });
}

/** A tool's answer that is a picture, with a few words about it. */
class ImageResult {
  readonly image: Screenshot;
  readonly details: Record<string, unknown>;
  constructor(image: Screenshot, details: Record<string, unknown>) {
    this.image = image;
    this.details = details;
  }
}

function toolResult(value: unknown, isError = false) {
  if (value instanceof ImageResult) {
    return {
      content: [
        { type: 'text', text: JSON.stringify(value.details, null, 2) },
        {
          type: 'image',
          data: value.image.data,
          mimeType: value.image.mimeType,
        },
      ],
      isError: false,
    };
  }
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
      return rpcResult(id, { tools: toolsFor(deps) });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') {
        return rpcError(id, INVALID_PARAMS, 'A tool name is required.');
      }
      if (!toolsFor(deps).some((tool) => tool.name === name)) {
        return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      }
      // Before the arguments are read, a daily call is taken or anything
      // is read: a token granted `build` alone is asked to step up.
      if (EDIT_TOOLS.has(name) && !deps.caller.scopes.includes(EDIT_SCOPE)) {
        return mcpStepUp(deps.appOrigin, id);
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
    scopes_supported: [MCP_SCOPE, EDIT_SCOPE],
    resource_name: 'vibld',
  };
}

export const MCP_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

/** The 401 that sends an MCP client to sign the person in (RFC 9728 s5.1). */
export function mcpUnauthorized(
  appOrigin: string,
  reason: 'missing' | 'invalid' | 'insufficient_scope',
): Response {
  // RFC 6750 section 3, with the RFC 9728 pointer and the scopes to ask
  // for. Both: clients ask for what this names and keep that token, and
  // some (claude.ai) never follow `mcpStepUp`'s 403, so naming `build`
  // alone left every editing tool refused for good. The person still
  // approves each scope on the consent screen.
  const metadata = `resource_metadata="${appOrigin}${MCP_METADATA_PATH}"`;
  const scope = `scope="${MCP_SCOPE} ${EDIT_SCOPE}"`;
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

/**
 * A call to an editing tool on a token granted `build` but not `edit`:
 * the MCP authorization spec's step-up (2025-11-25, "Scope Challenge
 * Handling"), a 403 whose challenge names every scope the call needs, so
 * the client signs the person in again asking for both. A client that
 * does not step up still has the JSON-RPC error to show, which says what
 * to do by hand.
 */
export function mcpStepUp(
  appOrigin: string,
  id: JsonRpcRequest['id'] | undefined,
): Response {
  const metadata = `resource_metadata="${appOrigin}${MCP_METADATA_PATH}"`;
  const response = rpcError(
    id,
    INSUFFICIENT_SCOPE,
    `Editing a project's files needs the "${EDIT_SCOPE}" permission, which this connection was not given. Connect vibld again and approve editing.`,
    403,
  );
  response.headers.set(
    'WWW-Authenticate',
    `Bearer error="insufficient_scope", scope="${MCP_SCOPE} ${EDIT_SCOPE}", ${metadata}, error_description="Editing needs the ${EDIT_SCOPE} scope"`,
  );
  return response;
}
