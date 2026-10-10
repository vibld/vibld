import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type CatalogEntry,
  registerSiteTools,
  searchCatalog,
  siteTools,
  sitePath,
} from '../app/webmcp.ts';

const CATALOG: CatalogEntry[] = [
  {
    id: 'crumb',
    name: 'Crumb Bakery',
    summary: 'A neighborhood bakery with a weekly menu.',
    kind: 'site',
    category: 'Food',
    url: '/templates/crumb',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    summary: 'A finance dashboard for a bakery chain.',
    kind: 'app',
    category: 'Fintech',
    url: '/templates/ledger',
  },
];

function env(pages: Record<string, Response> = {}) {
  const fetched: string[] = [];
  const opened: string[] = [];
  return {
    fetched,
    opened,
    fetch: async (path: string) => {
      fetched.push(path);
      return pages[path] ?? new Response('Not found', { status: 404 });
    },
    navigate: (path: string) => opened.push(path),
  };
}

const tool = (tools: ReturnType<typeof siteTools>, name: string) =>
  tools.find((candidate) => candidate.name === name)!;

describe('WebMCP tools', () => {
  it('are described, and read-only apart from navigation', () => {
    const tools = siteTools(env());
    assert.deepEqual(
      tools.map((t) => t.name),
      ['search_templates', 'list_docs', 'read_page', 'open_page'],
    );
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, t.name !== 'open_page');
      assert.ok(t.description.length > 20);
      assert.equal((t.inputSchema as { type: string }).type, 'object');
    }
  });

  it('search the catalog by every word, names first', () => {
    assert.deepEqual(
      searchCatalog(CATALOG, 'bakery').map((entry) => entry.id),
      ['crumb', 'ledger'],
    );
    assert.deepEqual(
      searchCatalog(CATALOG, 'bakery dashboard').map((entry) => entry.id),
      ['ledger'],
    );
    assert.deepEqual(
      searchCatalog(CATALOG, 'bakery', 'site').map((entry) => entry.id),
      ['crumb'],
    );
  });

  it('load the catalog once', async () => {
    const site = env({
      '/templates/index.json': Response.json(CATALOG),
    });
    const search = tool(siteTools(site), 'search_templates');
    await search.execute({ query: 'bakery' });
    const result = await search.execute({ query: 'ledger' });
    assert.deepEqual(JSON.parse(result.content[0]!.text), [CATALOG[1]]);
    assert.deepEqual(site.fetched, ['/templates/index.json']);
  });

  it('read a page as Markdown, and only a page on this site', async () => {
    const site = env({
      '/pricing': new Response('# Pricing\n', {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      }),
    });
    const read = tool(siteTools(site), 'read_page');
    assert.equal(
      (await read.execute({ path: '/pricing' })).content[0]!.text,
      '# Pricing\n',
    );
    assert.match(
      (await read.execute({ path: '/nope' })).content[0]!.text,
      /No page/,
    );
    await read.execute({ path: 'https://example.com/' });
    await read.execute({ path: '//example.com/' });
    assert.deepEqual(site.fetched, ['/pricing', '/nope']);
  });

  it('open a page on this site only', async () => {
    const site = env();
    const open = tool(siteTools(site), 'open_page');
    await open.execute({ path: '/templates' });
    await open.execute({ path: 'javascript:alert(1)' });
    assert.deepEqual(site.opened, ['/templates']);
  });

  it('keep a path on vibld.com', () => {
    assert.equal(sitePath('/docs?x=1'), '/docs?x=1');
    for (const bad of ['docs', '//evil.com', '/\\evil.com', 1, null]) {
      assert.equal(sitePath(bad), null, String(bad));
    }
  });
});

describe('registering the tools', () => {
  it('does nothing in a browser without WebMCP', () => {
    const globals = globalThis as Record<string, unknown>;
    const had = { document: globals.document };
    globals.document = {};
    try {
      const remove = registerSiteTools(() => {});
      assert.equal(typeof remove, 'function');
      remove();
    } finally {
      globals.document = had.document;
    }
  });

  it('registers every tool with one signal, and removes them with it', () => {
    const globals = globalThis as Record<string, unknown>;
    const had = globals.document;
    const registered: { name: string; signal?: AbortSignal }[] = [];
    globals.document = {
      modelContext: {
        registerTool(
          tool: { name: string },
          options?: { signal?: AbortSignal },
        ) {
          registered.push({ name: tool.name, signal: options?.signal });
          return Promise.resolve();
        },
      },
    };
    try {
      const remove = registerSiteTools(() => {});
      assert.equal(registered.length, 4);
      assert.ok(
        registered.every((entry) => entry.signal === registered[0]!.signal),
      );
      remove();
      assert.equal(registered[0]!.signal?.aborted, true);
    } finally {
      globals.document = had;
    }
  });
});
