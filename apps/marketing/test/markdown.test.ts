import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dropHidden, toMarkdown } from '../scripts/markdown.ts';
import {
  estimateTokens,
  markdownFor,
  markdownPath,
  varyByAccept,
  wantsMarkdown,
} from '../worker/markdown.ts';
import worker from '../worker/index.ts';

const PAGE = `<!doctype html><html><head>
<title>Pricing | vibld</title>
<meta name="description" content="What the plans cost &amp; include."/>
<meta property="og:image" content="https://vibld.com/og-image.png"/>
</head><body><header><nav><a href="/">vibld</a></nav></header><main>
<h1>A price</h1>
<p class="lb-plan__p">$19<small>a month</small></p>
<div aria-hidden="true"><div><b>Preview</b></div><div>junk</div></div>
<ul><li><a href="/docs/getting-started"><span>Getting started</span><span>Sign in.</span>→</a></li></ul>
<a href="/templates/tallyroot"><h3>Tallyroot</h3><p>Net-worth tracker</p></a>
<pre><code>const a = 1;
const b = 2;</code></pre>
<script>alert(1)</script>
</main><footer>Footer</footer></body></html>`;

describe('a page as Markdown', () => {
  const markdown = toMarkdown(PAGE, 'https://vibld.com/pricing') ?? '';

  it('opens with front matter from the meta tags and the page URL', () => {
    assert.match(
      markdown,
      /^---\ntitle: "Pricing \| vibld"\ndescription: "What the plans cost & include."\nimage: "https:\/\/vibld.com\/og-image.png"\nurl: "https:\/\/vibld.com\/pricing"\n---\n\n/,
    );
  });

  it('keeps headings, links and code, and drops what is not content', () => {
    assert.match(markdown, /^# A price$/m);
    assert.match(markdown, /^\$19 a month$/m);
    assert.match(
      markdown,
      /^- \[Getting started Sign in\.\]\(https:\/\/vibld.com\/docs\/getting-started\)$/m,
    );
    assert.match(
      markdown,
      /^### \[Tallyroot\]\(https:\/\/vibld.com\/templates\/tallyroot\)$/m,
    );
    assert.match(markdown, /^```\nconst a = 1;\nconst b = 2;\n```$/m);
    for (const gone of ['Preview', 'junk', 'alert', 'Footer', 'vibld](']) {
      assert.ok(!markdown.includes(gone), `still has ${gone}`);
    }
  });

  it('skips a page marked noindex, and a page with no main', () => {
    assert.equal(
      toMarkdown(
        '<meta name="robots" content="noindex"/><main><h1>x</h1></main>',
        'https://vibld.com/x',
      ),
      null,
    );
    assert.equal(toMarkdown('<p>x</p>', 'https://vibld.com/x'), null);
  });

  it('escapes angle brackets in prose and keeps them literal in code', () => {
    const page = toMarkdown(
      '<main><p>A branch named vibld/&lt;revision&gt;, or <code>vibld/&lt;revision&gt;</code>.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(
      page ?? '',
      /^A branch named vibld\/\\<revision\\>, or `vibld\/<revision>`\.$/m,
    );
  });

  it('keeps ordered lists numbered and nested lists indented', () => {
    const page = toMarkdown(
      '<main><ol><li>Clone it.</li><li>Deploy it.</li></ol><ul><li>Rules<ul><li>No spam</li></ul></li><li>More</li></ul><p>After the list.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(
      page ?? '',
      /^1\. Clone it\.\n2\. Deploy it\.\n\n- Rules\n {2}- No spam\n- More\n\nAfter the list\.$/m,
    );
  });

  it('sets paragraphs apart with a blank line', () => {
    const page = toMarkdown(
      '<main><p>One.</p><p>Two.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(page ?? '', /^One\.\n\nTwo\.$/m);
  });

  it('keeps an item that starts with a heading numbered, its content indented', () => {
    const page = toMarkdown(
      '<main><ol><li><h3>First</h3><p>One.</p><p>Also one.</p></li><li><h3>Second</h3><p>Two.</p></li></ol><p>After.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(
      page ?? '',
      /^1\. ### First\n\n {3}One\.\n\n {3}Also one\.\n\n2\. ### Second\n\n {3}Two\.\n\nAfter\.$/m,
    );
  });

  it('keeps what a button drawn as a card says, and drops a control label', () => {
    const page = toMarkdown(
      '<main><ul><li><button><span>Glassmorphism</span><span>Blurred panels</span></button></li></ul><button>Copy</button><p>After.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(page ?? '', /^- Glassmorphism Blurred panels\n\nAfter\.$/m);
  });

  it('writes a table as a Markdown table', () => {
    const page = toMarkdown(
      '<main><table><thead><tr><th>Subprocessor</th><th>Purpose</th></tr></thead><tbody><tr><td><a href="https://www.cloudflare.com/">Cloudflare</a></td><td>Hosting | CDN</td></tr></tbody></table></main>',
      'https://vibld.com/x',
    );
    assert.match(
      page ?? '',
      /^\| Subprocessor \| Purpose \|\n\| --- \| --- \|\n\| \[Cloudflare\]\(https:\/\/www\.cloudflare\.com\/\) \| Hosting \\\| CDN \|$/m,
    );
  });

  it('ends every block element, a details summary included, on its own line', () => {
    const page = toMarkdown(
      '<main><details><summary>The prompt</summary><p>A site for my bakery.</p></details><aside>Aside</aside><p>After.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(
      page ?? '',
      /^The prompt\nA site for my bakery\.\n+Aside\nAfter\.$/m,
    );
  });

  it('marks a quotation with >', () => {
    const page = toMarkdown(
      '<main><p>Claude Opus</p><blockquote><p>A site for my bakery.</p><p>Show the menu.</p></blockquote><p>Note: it worked.</p></main>',
      'https://vibld.com/x',
    );
    assert.match(
      page ?? '',
      /Claude Opus\n\n> A site for my bakery\.\n>\n> Show the menu\.\n\nNote: it worked\./,
    );
  });

  it('removes nested hidden elements whole', () => {
    assert.equal(
      dropHidden(
        'a<div aria-hidden="true"><div>b</div><img src="x"/></div>c<i aria-hidden="true"></i>d',
      ),
      'acd',
    );
  });
});

describe('Markdown negotiation', () => {
  it('maps a page to its Markdown file', () => {
    assert.equal(markdownPath('/'), '/index.md');
    assert.equal(markdownPath('/pricing'), '/pricing.md');
    assert.equal(markdownPath('/docs/self-hosting/'), '/docs/self-hosting.md');
  });

  it('answers Markdown only when it is asked for and not ranked below HTML', () => {
    assert.equal(wantsMarkdown('text/markdown'), true);
    assert.equal(wantsMarkdown('text/markdown, text/html;q=0.9'), true);
    assert.equal(wantsMarkdown('text/html, text/markdown;q=0.5'), false);
    assert.equal(wantsMarkdown('text/markdown;q=0'), false);
    assert.equal(
      wantsMarkdown(
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ),
      false,
    );
    assert.equal(wantsMarkdown('*/*'), false);
    assert.equal(wantsMarkdown('text/*'), false);
    // Only the variant the build writes (RFC 7763).
    assert.equal(wantsMarkdown('text/markdown;variant=GFM'), true);
    assert.equal(wantsMarkdown('text/markdown; variant="gfm"'), true);
    assert.equal(
      wantsMarkdown('text/markdown;variant=Original;q=1, text/html;q=0.9'),
      false,
    );
    // Nor a charset or any other parameter it does not have.
    assert.equal(wantsMarkdown('text/markdown;charset=UTF-8'), true);
    assert.equal(
      wantsMarkdown('text/markdown;charset=iso-8859-1;q=1, text/html;q=0.9'),
      false,
    );
    assert.equal(wantsMarkdown('text/markdown;flavor=x'), false);
    // A wildcard counts toward HTML when it is the most specific match.
    assert.equal(wantsMarkdown('text/markdown;q=0.5, text/*;q=0.8'), false);
    assert.equal(wantsMarkdown('text/markdown;q=0.5, */*;q=0.8'), false);
    assert.equal(wantsMarkdown('text/markdown, */*'), true);
    // The most specific matching range decides, parameters included.
    assert.equal(
      wantsMarkdown(
        'text/markdown;q=0.5, text/markdown;variant=GFM;q=1, text/html;q=0.8',
      ),
      true,
    );
    assert.equal(
      wantsMarkdown('text/markdown;q=0.9, text/html;level=1;q=1'),
      true,
    );
    assert.equal(
      wantsMarkdown('text/markdown;q=0.9, text/html;charset=utf-8;q=1'),
      false,
    );
    assert.equal(
      wantsMarkdown('text/markdown;q=0.5, text/html;q=0.4, text/*;q=0.8'),
      true,
    );
    assert.equal(wantsMarkdown(null), false);
  });

  const assets = (files: Record<string, string>) => {
    const seen: string[] = [];
    return {
      seen,
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        seen.push(path);
        const body = files[path];
        return body === undefined
          ? new Response('<!doctype html><title>404</title>', {
              status: 404,
              headers: { 'content-type': 'text/html' },
            })
          : new Response(body, {
              status: 200,
              headers: {
                'content-type': path.endsWith('.md')
                  ? 'text/markdown'
                  : 'text/html; charset=utf-8',
                'cache-control': 'public, max-age=0, must-revalidate',
              },
            });
      },
    };
  };

  it('serves the page as Markdown to an agent that asks for it', async () => {
    const ASSETS = assets({ '/pricing.md': '# Pricing\n' });
    const response = await worker.fetch(
      new Request('https://vibld.com/pricing', {
        headers: { accept: 'text/markdown' },
      }),
      { ASSETS },
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'text/markdown; charset=utf-8; variant=GFM',
    );
    assert.equal(response.headers.get('vary'), 'accept');
    assert.equal(
      response.headers.get('x-markdown-tokens'),
      String(estimateTokens('# Pricing\n')),
    );
    assert.equal(
      response.headers.get('link'),
      '<https://vibld.com/pricing>; rel="canonical"',
    );
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=0, must-revalidate',
    );
    // The site's security headers still apply.
    assert.ok(response.headers.get('content-security-policy'));
    assert.equal(await response.text(), '# Pricing\n');
  });

  it('names the production page canonical, even from a preview', async () => {
    const response = await markdownFor(
      new Request(
        'https://vibld-marketing-preview.example.workers.dev/pricing',
        {
          headers: { accept: 'text/markdown' },
        },
      ),
      assets({
        '/pricing.md':
          '---\ntitle: "Pricing"\nurl: "https://vibld.com/pricing"\n---\n\n# Pricing\n',
      }),
    );
    assert.equal(
      response?.headers.get('link'),
      '<https://vibld.com/pricing>; rel="canonical"',
    );
  });

  it('serves the home page from /index.md', async () => {
    const ASSETS = assets({ '/index.md': '# vibld\n' });
    const response = await worker.fetch(
      new Request('https://vibld.com/', {
        headers: { accept: 'text/markdown' },
      }),
      { ASSETS },
    );
    assert.equal(await response.text(), '# vibld\n');
  });

  it('leaves a trailing slash to the redirect, so a page has one address', async () => {
    const ASSETS = assets({ '/pricing.md': '# Pricing\n' });
    assert.equal(
      await markdownFor(
        new Request('https://vibld.com/pricing/', {
          headers: { accept: 'text/markdown' },
        }),
        ASSETS,
      ),
      null,
    );
    assert.deepEqual(ASSETS.seen, []);
  });

  it('leaves an /index alias to the redirect', async () => {
    const ASSETS = assets({ '/index.md': '# vibld\n' });
    for (const path of ['/index', '/docs/index']) {
      assert.equal(
        await markdownFor(
          new Request(`https://vibld.com${path}`, {
            headers: { accept: 'text/markdown' },
          }),
          ASSETS,
        ),
        null,
        path,
      );
    }
    assert.deepEqual(ASSETS.seen, []);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await markdownFor(
      new Request('https://vibld.com/pricing', {
        method: 'HEAD',
        headers: { accept: 'text/markdown' },
      }),
      assets({ '/pricing.md': '# Pricing\n' }),
    );
    assert.equal(response?.status, 200);
    assert.equal(await response?.text(), '');
  });

  it('gives a browser the HTML, marked as varying by Accept', async () => {
    const ASSETS = assets({
      '/pricing': '<!doctype html>',
      '/pricing.md': '#',
    });
    const response = await worker.fetch(
      new Request('https://vibld.com/pricing', {
        headers: { accept: 'text/html,*/*;q=0.8' },
      }),
      { ASSETS },
    );
    assert.equal(await response.text(), '<!doctype html>');
    assert.equal(response.headers.get('vary'), 'accept');
    assert.deepEqual(ASSETS.seen, ['/pricing']);
  });

  it('falls back to HTML for a page with no Markdown, and leaves files alone', async () => {
    const ASSETS = assets({ '/layers/nocturne': '<!doctype html>' });
    const page = await worker.fetch(
      new Request('https://vibld.com/layers/nocturne', {
        headers: { accept: 'text/markdown' },
      }),
      { ASSETS },
    );
    assert.equal(await page.text(), '<!doctype html>');
    assert.equal(
      await markdownFor(
        new Request('https://vibld.com/llms.txt', {
          headers: { accept: 'text/markdown' },
        }),
        ASSETS,
      ),
      null,
    );
    assert.equal(
      await markdownFor(
        new Request('https://vibld.com/pricing', {
          method: 'POST',
          headers: { accept: 'text/markdown' },
        }),
        ASSETS,
      ),
      null,
    );
  });

  it('adds Accept to an existing Vary once, and only on HTML', () => {
    const html = (vary?: string) =>
      new Response('x', {
        headers: {
          'content-type': 'text/html',
          ...(vary ? { vary } : {}),
        },
      });
    assert.equal(
      varyByAccept(html('Accept-Encoding')).headers.get('vary'),
      'Accept-Encoding, accept',
    );
    assert.equal(varyByAccept(html('Accept')).headers.get('vary'), 'Accept');
    const css = new Response('x', { headers: { 'content-type': 'text/css' } });
    assert.equal(varyByAccept(css).headers.get('vary'), null);
  });
});
