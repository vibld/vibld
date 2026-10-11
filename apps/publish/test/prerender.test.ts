import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { serve, type Env, type Render } from '../worker/index.ts';
import {
  NAVIGATION_TIMEOUT_MS,
  drawnByScripts,
  isRenderBot,
  RENDER_HEADER,
  RENDER_PREFIX,
  RENDER_SLOTS,
  keepRender,
  keptRender,
  renderPage,
  renderSlot,
  type RenderBrowser,
  type RenderRequest,
} from '../worker/prerender.ts';
import {
  RENDER_BUDGET_NAME,
  RENDER_BUDGET_PER_MINUTE,
  RenderBudget,
  type BudgetStorage,
} from '../worker/render-budget.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'web', 'migrations');
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');
const SECRET = 'test-secret';

const GOOGLEBOT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SLACKBOT = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const HEADLESS =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36';

const SHELL =
  '<!doctype html><html><head><title>Acme</title>' +
  '<script type="module" src="/assets/app.js"></script></head>' +
  '<body><div id="root"></div></body></html>';
const DRAWN =
  '<!doctype html><html><head><title>Menu | Acme</title>' +
  '<link rel="canonical" href="https://acme.vibld-preview.dev/menu">' +
  '<script type="module" src="/assets/app.js"></script></head>' +
  '<body><div id="root"><h1>Menu</h1></div></body></html>';

describe('isRenderBot', () => {
  it('knows the crawlers and unfurlers a render is for', () => {
    for (const agent of [
      GOOGLEBOT,
      SLACKBOT,
      'Twitterbot/1.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    ]) {
      assert.equal(isRenderBot(agent), true, agent);
    }
  });

  it('leaves people, unknown agents and the renderer itself alone', () => {
    for (const agent of [CHROME, HEADLESS, 'curl/8.0', '', null]) {
      assert.equal(isRenderBot(agent), false, String(agent));
    }
    // The renderer never renders itself, whatever else its agent says.
    assert.equal(isRenderBot(`${HEADLESS} Googlebot`), false);
  });
});

describe('drawnByScripts', () => {
  it('is true only for a page that loads a script file', () => {
    assert.equal(drawnByScripts(SHELL), true);
    assert.equal(drawnByScripts('<h1>Hi</h1><script>1</script>'), false);
    assert.equal(drawnByScripts('<h1>Hi</h1>'), false);
  });
});

describe('renderPage', () => {
  function fakeBrowser(
    status: number,
    html: string,
    calls: string[],
    landed?: string,
  ): () => Promise<RenderBrowser> {
    return async () => ({
      newPage: async () => {
        let at = '';
        let onRequest: ((request: RenderRequest) => void) | undefined;
        const request = (url: string, navigation: boolean) =>
          onRequest?.({
            url: () => url,
            isNavigationRequest: () => navigation,
            headers: () => ({ accept: 'text/html' }),
            continue: async (overrides) => {
              calls.push(
                `${url} ${overrides?.headers?.[RENDER_HEADER] ?? '-'}`,
              );
            },
          });
        return {
          setRequestInterception: async () => undefined,
          on: (_event, handler) => {
            onRequest = handler;
          },
          goto: async (url, options) => {
            calls.push(`goto ${url} ${options.timeout}`);
            at = landed ?? url;
            request(url, true);
            request(`${new URL(url).origin}/assets/app.js`, false);
            request('https://other.example/frame', true);
            return { status: () => status };
          },
          waitForNetworkIdle: async () => {
            throw new Error('never quiet');
          },
          content: async () => html,
          url: () => at,
        };
      },
      close: async () => {
        calls.push('close');
      },
    });
  }

  it('returns the page as drawn, and closes the browser', async () => {
    const calls: string[] = [];
    const html = await renderPage(
      fakeBrowser(200, DRAWN, calls),
      'https://acme.vibld-preview.dev/menu',
    );
    assert.equal(html, DRAWN);
    // Only the page's own document is marked for the page as built.
    assert.deepEqual(calls, [
      `goto https://acme.vibld-preview.dev/menu ${NAVIGATION_TIMEOUT_MS}`,
      'https://acme.vibld-preview.dev/menu 1',
      'https://acme.vibld-preview.dev/assets/app.js -',
      'https://other.example/frame -',
      'close',
    ]);
  });

  it('returns nothing for a page that did not load as one', async () => {
    const calls: string[] = [];
    assert.equal(
      await renderPage(fakeBrowser(404, DRAWN, calls), 'https://x/'),
      undefined,
    );
    assert.equal(calls.at(-1), 'close');
  });

  it('returns nothing for a page its scripts sent to another origin', async () => {
    const calls: string[] = [];
    const landed = 'https://login.example/authorize';
    assert.equal(
      await renderPage(
        fakeBrowser(200, DRAWN, calls, landed),
        'https://acme.vibld-preview.dev/menu',
      ),
      undefined,
    );
    assert.equal(calls.at(-1), 'close');
  });
});

describe('renderSlot', () => {
  it('names a render by its key, in one of a bounded set of slots', async () => {
    const a = await renderSlot(['https://a/', { indexing: true }]);
    assert.match(a.path, /^__vibld\/prerender\/\d+\.txt$/);
    assert.ok(Number(/(\d+)\.txt$/.exec(a.path)![1]) < RENDER_SLOTS);
    assert.match(a.name, /^[0-9a-f]{64}$/);
    assert.deepEqual(a, await renderSlot(['https://a/', { indexing: true }]));
    const b = await renderSlot(['https://b/', { indexing: true }]);
    assert.notEqual(a.name, b.name);
    const kept = keepRender(a.name, '<p>a</p>');
    assert.equal(keptRender(a.name, kept), '<p>a</p>');
    assert.equal(keptRender(b.name, kept), undefined);
  });
});

function memoryKv(): BudgetStorage {
  const kept = new Map<string, unknown>();
  return {
    get: <T>(key: string) => kept.get(key) as T | undefined,
    put: (key, value) => {
      kept.set(key, structuredClone(value));
    },
  };
}

describe('RenderBudget', () => {
  it('lets a minute start its renders and no more, across restarts', () => {
    const kv = memoryKv();
    let budget = new RenderBudget({ storage: { kv } }, undefined);
    const minute = 60_000 * 1000;
    for (let i = 0; i < RENDER_BUDGET_PER_MINUTE; i += 1) {
      assert.equal(budget.take(minute + i), true);
    }
    // Evicted or redeployed mid-minute: the count is still there.
    budget = new RenderBudget({ storage: { kv } }, undefined);
    assert.equal(budget.take(minute + 59_999), false);
    assert.equal(budget.take(minute + 60_000), true);
  });
});

describe('serving a render to bots (D204)', () => {
  async function siteEnv(
    files = [
      { path: 'index.html', content: SHELL },
      { path: 'assets/app.js', content: 'render()' },
    ],
    overrides: Partial<Env> = {},
  ): Promise<Env> {
    const env: Env = {
      DB: new SqliteD1Database(SCHEMA),
      PROJECT_CONTENT: new InMemoryR2Bucket(),
      PUBLISH_INTERNAL_SECRET: SECRET,
      PUBLISH_HOSTNAME: 'vibld-preview.dev',
      ...overrides,
    };
    const published = await serve(
      new Request('https://internal.example/internal/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${SECRET}`,
        },
        body: JSON.stringify({
          userId: 'u1',
          projectId: 'p1',
          slug: 'acme',
          files,
        }),
      }),
      env,
      undefined,
    );
    assert.equal(published.status, 200);
    return env;
  }

  function recording(html: string | undefined = DRAWN): {
    render: Render;
    urls: string[];
  } {
    const urls: string[] = [];
    return {
      urls,
      render: async (url) => {
        urls.push(url);
        return html;
      },
    };
  }

  async function get(
    env: Env,
    render: Render | undefined,
    agent: string,
    path = '/menu',
  ) {
    const response = await serve(
      new Request(`https://acme.vibld-preview.dev${path}`, {
        headers: { accept: 'text/html', 'user-agent': agent },
      }),
      env,
      render,
    );
    return { response, body: await response.text() };
  }

  it('gives a bot the drawn page, rendered once and then kept', async () => {
    const env = await siteEnv();
    const { render, urls } = recording();
    const first = await get(env, render, GOOGLEBOT);
    assert.equal(first.response.status, 200);
    assert.match(first.body, /<h1>Menu<\/h1>/);
    assert.equal(first.response.headers.get('x-vibld-prerendered'), '1');
    assert.equal(first.response.headers.get('vary'), 'user-agent');
    // The canonical link the page already had is not added twice.
    assert.equal(first.body.match(/rel="canonical"/g)?.length, 1);
    assert.deepEqual(urls, ['https://acme.vibld-preview.dev/menu']);

    const again = await get(env, render, SLACKBOT, '/menu/');
    assert.match(again.body, /<h1>Menu<\/h1>/);
    assert.equal(urls.length, 1);
  });

  it('renders the query a bot asked for, and keeps each apart', async () => {
    const env = await siteEnv();
    const { render, urls } = recording();
    await get(env, render, GOOGLEBOT, '/product?id=42');
    await get(env, render, GOOGLEBOT, '/product?id=7');
    await get(env, render, GOOGLEBOT, '/product?id=42');
    assert.deepEqual(urls, [
      'https://acme.vibld-preview.dev/product?id=42',
      'https://acme.vibld-preview.dev/product?id=7',
    ]);
  });

  it("renders on the owner's domain when the bot asked there", async () => {
    const env = await siteEnv();
    await (env.DB as SqliteD1Database)
      .prepare(
        `INSERT INTO custom_domains
           (hostname, project_id, user_id, cloudflare_id, created_at)
         VALUES ('www.acme.com', 'p1', 'u1', 'ch1', '2026-10-10')`,
      )
      .run();
    const { render, urls } = recording();
    const response = await serve(
      new Request('https://www.acme.com/menu', {
        headers: { accept: 'text/html', 'user-agent': GOOGLEBOT },
      }),
      env,
      render,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(urls, ['https://www.acme.com/menu']);
  });

  it('keeps at most one render per slot', async () => {
    const env = await siteEnv();
    const { render, urls } = recording();
    for (let id = 0; id < RENDER_SLOTS * 2; id++) {
      await get(env, render, GOOGLEBOT, `/item?id=${id}`);
    }
    const listed = await env.PROJECT_CONTENT.list({
      prefix: 'published/',
      limit: 1000,
    });
    const renders = listed.objects.filter((o) =>
      o.key.includes('/__vibld/prerender/'),
    );
    assert.equal(urls.length, RENDER_SLOTS * 2);
    assert.equal(listed.truncated, false);
    assert.ok(renders.length > 0 && renders.length <= RENDER_SLOTS);
  });

  it("keeps the renders' corner out of a site's files and off the web", async () => {
    const env = await siteEnv([
      { path: 'index.html', content: SHELL },
      { path: `${RENDER_PREFIX}0.txt`, content: 'mine' },
    ]);
    const listed = await env.PROJECT_CONTENT.list({
      prefix: 'published/',
      limit: 1000,
    });
    assert.ok(listed.objects.every((o) => !o.key.includes(RENDER_PREFIX)));
    for (const slot of [0, 1]) {
      const { response, body } = await get(
        env,
        recording().render,
        CHROME,
        `/${RENDER_PREFIX}${slot}.txt`,
      );
      assert.notEqual(body, 'mine');
      assert.doesNotMatch(
        response.headers.get('content-type') ?? '',
        /text\/plain/,
      );
    }
  });

  it('answers the renderer with the page as built, and derives previews from the render', async () => {
    const env = await siteEnv();
    const raw = await serve(
      new Request('https://acme.vibld-preview.dev/menu', {
        headers: { accept: 'text/html', [RENDER_HEADER]: '1' },
      }),
      env,
      recording().render,
    );
    assert.equal(await raw.text(), SHELL);

    // What the browser drew from that: its scripts set the route's title.
    const drawn = SHELL.replace('<title>Acme</title>', '<title>Menu</title>');
    const { body } = await get(env, recording(drawn).render, SLACKBOT);
    assert.match(body, /<meta property="og:title" content="Menu">/);
    assert.doesNotMatch(body, /content="Acme"/);
  });

  it('gives people the site as built', async () => {
    const env = await siteEnv();
    const { render, urls } = recording();
    const { response, body } = await get(env, render, CHROME);
    assert.doesNotMatch(body, /<h1>Menu<\/h1>/);
    assert.match(body, /<div id="root"><\/div>/);
    assert.equal(response.headers.get('vary'), 'user-agent');
    assert.equal(response.headers.get('x-vibld-prerendered'), null);
    assert.deepEqual(urls, []);
  });

  it('does not render a page its scripts do not draw', async () => {
    const env = await siteEnv([{ path: 'index.html', content: '<h1>Hi</h1>' }]);
    const { render, urls } = recording();
    const { response, body } = await get(env, render, GOOGLEBOT, '/');
    assert.match(body, /<h1>Hi<\/h1>/);
    assert.equal(response.headers.get('vary'), null);
    assert.deepEqual(urls, []);
  });

  it('gives the bot the page as built when a render fails or is refused', async () => {
    const env = await siteEnv();
    const failing: Render = async () => {
      throw new Error('no browser');
    };
    const failed = await get(env, failing, GOOGLEBOT);
    assert.equal(failed.response.status, 200);
    assert.match(failed.body, /<div id="root"><\/div>/);

    const missing = await get(env, async () => undefined, GOOGLEBOT);
    assert.match(missing.body, /<div id="root"><\/div>/);

    const limited = await siteEnv(undefined, {
      PRERENDER_SITE_BURST: { limit: async () => ({ success: false }) },
    });
    const { render, urls } = recording();
    const refused = await get(limited, render, GOOGLEBOT);
    assert.match(refused.body, /<div id="root"><\/div>/);
    assert.deepEqual(urls, []);
  });

  it('counts every location against one budget, and refuses when it cannot ask', async () => {
    // One object, whichever location asks: two envs share it.
    const budget = new RenderBudget(
      { storage: { kv: memoryKv() } },
      undefined,
      () => 0,
    );
    const names: string[] = [];
    const namespace = (fail = false): Env['RENDER_BUDGET'] => ({
      idFromName: (name) => {
        names.push(name);
        return name as unknown as DurableObjectId;
      },
      get: () => ({
        fetch: async () => {
          if (fail) throw new Error('unreachable');
          return budget.fetch();
        },
      }),
    });
    const here = await siteEnv(undefined, { RENDER_BUDGET: namespace() });
    const there = await siteEnv(undefined, { RENDER_BUDGET: namespace() });
    const { render, urls } = recording();
    for (let i = 0; i < RENDER_BUDGET_PER_MINUTE; i += 1) {
      await get(i % 2 ? here : there, render, GOOGLEBOT, `/menu?n=${i}`);
    }
    assert.equal(urls.length, RENDER_BUDGET_PER_MINUTE);
    const over = await get(here, render, GOOGLEBOT, '/menu?n=over');
    assert.match(over.body, /<div id="root"><\/div>/);
    assert.equal(urls.length, RENDER_BUDGET_PER_MINUTE);
    assert.deepEqual(new Set(names), new Set([RENDER_BUDGET_NAME]));

    const down = await siteEnv(undefined, { RENDER_BUDGET: namespace(true) });
    const fresh = recording();
    const unasked = await get(down, fresh.render, GOOGLEBOT);
    assert.match(unasked.body, /<div id="root"><\/div>/);
    assert.deepEqual(fresh.urls, []);
  });

  it("puts the owner's title back over the one the page's scripts wrote", async () => {
    const env = await siteEnv();
    const db = env.DB as SqliteD1Database;
    await db
      .prepare(
        `INSERT INTO projects
           (id, user_id, name, created_at, updated_at, last_opened_at,
            seo_title)
         VALUES ('p1', 'u1', 'Acme', 'now', 'now', 'now', 'Acme Bakery')`,
      )
      .run();
    const { render } = recording(DRAWN.replace('Menu | Acme', 'Home | Acme'));
    const { body } = await get(env, render, GOOGLEBOT, '/');
    assert.match(body, /<title>Acme Bakery<\/title>/);
    assert.doesNotMatch(body, /Home \| Acme/);
  });

  it('does not render when there is no browser', async () => {
    const env = await siteEnv();
    const { response, body } = await get(env, undefined, GOOGLEBOT);
    assert.match(body, /<div id="root"><\/div>/);
    assert.equal(response.headers.get('vary'), null);
  });
});
