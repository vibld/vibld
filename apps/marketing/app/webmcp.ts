/**
 * WebMCP: tools an agent in the visitor's browser can call on
 * vibld.com (https://webmachinelearning.github.io/webmcp/). Searching the
 * template catalog, listing the guides, reading a page as Markdown and
 * opening a page: what a person does here with the mouse, and nothing that
 * signs in, writes or spends.
 *
 * Registered only where the browser has the API (`document.modelContext`,
 * or `navigator.modelContext` in older Chrome builds); everywhere else this
 * does nothing.
 */

import { DOC_GUIDES } from './site.ts';

/** The catalog the template search reads, written by the build. */
export const TEMPLATE_CATALOG_PATH = '/templates/index.json';

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  kind: 'site' | 'app';
  category: string;
  url: string;
}

interface ToolResult {
  content: { type: 'text'; text: string }[];
}

export interface SiteTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

interface SiteEnv {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  navigate(path: string): void;
}

function text(value: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value),
      },
    ],
  };
}

/**
 * A path on this site, or null. Only a same-site path: `//host` and any
 * scheme are refused, so a tool cannot be steered off vibld.com.
 */
export function sitePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.includes('\\')) return null;
  const url = new URL(value, 'https://vibld.com');
  return url.origin === 'https://vibld.com' ? url.pathname + url.search : null;
}

/** Catalog entries matching every word of `query`, best name matches first. */
export function searchCatalog(
  catalog: readonly CatalogEntry[],
  query: string,
  kind?: string,
  limit = 10,
): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return catalog
    .filter((entry) => !kind || entry.kind === kind)
    .map((entry) => {
      const name = entry.name.toLowerCase();
      const all = `${name} ${entry.summary} ${entry.category}`.toLowerCase();
      if (!words.every((word) => all.includes(word))) return null;
      return {
        entry,
        score: words.filter((word) => name.includes(word)).length,
      };
    })
    .filter((hit): hit is { entry: CatalogEntry; score: number } => !!hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map((hit) => hit.entry);
}

export function siteTools(env: SiteEnv): SiteTool[] {
  let catalog: Promise<CatalogEntry[]> | null = null;
  const loadCatalog = () =>
    (catalog ??= env.fetch(TEMPLATE_CATALOG_PATH).then((response) => {
      if (!response.ok) {
        catalog = null;
        throw new Error('The template catalog could not be loaded.');
      }
      return response.json() as Promise<CatalogEntry[]>;
    }));
  const readOnly = { readOnlyHint: true } as const;

  return [
    {
      name: 'search_templates',
      description:
        "Search vibld's design template catalog by keywords (for example 'bakery', 'dashboard', 'portfolio dark'). Returns matching designs with a one-line summary and the URL of each design's page.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for.' },
          kind: {
            type: 'string',
            enum: ['site', 'app'],
            description: 'Only websites, or only web apps.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'How many to return. Defaults to 10.',
          },
        },
        required: ['query'],
      },
      annotations: readOnly,
      async execute(input) {
        const results = searchCatalog(
          await loadCatalog(),
          String(input.query ?? ''),
          typeof input.kind === 'string' ? input.kind : undefined,
          typeof input.limit === 'number' ? input.limit : 10,
        );
        return text(results);
      },
    },
    {
      name: 'list_docs',
      description:
        "List vibld's documentation guides: using the hosted builder, and running vibld yourself. Returns each guide's title, summary and path.",
      inputSchema: { type: 'object', properties: {} },
      annotations: readOnly,
      async execute() {
        return text(
          DOC_GUIDES.map((guide) => ({
            title: guide.label,
            summary: guide.description,
            track: guide.track,
            path: `/docs/${guide.slug}`,
          })),
        );
      },
    },
    {
      name: 'read_page',
      description:
        "Read a page of vibld.com as Markdown, for example '/pricing', '/docs/getting-started' or a template's page. Returns the page's text without navigation.",
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: "A path on vibld.com, starting with '/'.",
          },
        },
        required: ['path'],
      },
      annotations: readOnly,
      async execute(input) {
        const path = sitePath(input.path);
        if (!path) return text('Give a path on vibld.com, starting with /.');
        const response = await env.fetch(path, {
          headers: { accept: 'text/markdown' },
        });
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.startsWith('text/markdown')) {
          return text(`No page at ${path}.`);
        }
        return text(await response.text());
      },
    },
    {
      name: 'open_page',
      description:
        "Open a page of vibld.com in this tab, for example '/templates', '/pricing' or '/docs'.",
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: "A path on vibld.com, starting with '/'.",
          },
        },
        required: ['path'],
      },
      // Navigating changes the tab's page and history, so it is not read-only.
      annotations: { readOnlyHint: false },
      async execute(input) {
        const path = sitePath(input.path);
        if (!path) return text('Give a path on vibld.com, starting with /.');
        env.navigate(path);
        return text(`Opening ${path}.`);
      },
    },
  ];
}

interface ModelContext {
  registerTool(tool: SiteTool, options?: { signal?: AbortSignal }): unknown;
}

/**
 * Registers the tools where the browser offers WebMCP, and returns the
 * function that removes them. Does nothing in any other browser.
 */
export function registerSiteTools(
  navigate: (path: string) => void,
): () => void {
  const context =
    (document as unknown as { modelContext?: ModelContext }).modelContext ??
    (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (!context || typeof context.registerTool !== 'function') return () => {};
  const controller = new AbortController();
  const tools = siteTools({
    fetch: (path, init) => fetch(path, init),
    navigate,
  });
  for (const tool of tools) {
    try {
      // A Promise in current builds; a failure there is not the page's.
      Promise.resolve(
        context.registerTool(tool, { signal: controller.signal }),
      ).catch(() => {});
    } catch {
      // An older or partial implementation: the page works without it.
    }
  }
  return () => controller.abort();
}
