/**
 * Emits the crawler-facing files that cannot be React routes, and relocates
 * the prerendered 404.
 *
 * Everything here is derived from `app/site.ts`, the same single source of
 * truth the routes and their metadata come from. That is the point: a route
 * cannot be added to the build without also appearing in the sitemap, so the
 * sitemap cannot silently go stale.
 *
 * Run as part of `pnpm build` (see package.json), after `react-router build`.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { answers } from '../app/answers.ts';
import { readPlans, type Plans } from '../app/plans.ts';
import {
  DOC_GUIDES,
  DOC_TRACKS,
  LEGAL_DOCS,
  PRODUCT_PAGES,
  ROUTES,
  SITE,
  guidesIn,
  routeFor,
} from '../app/site.ts';
import { USE_CASES } from '../app/use-cases.ts';
import { zip } from './zip.ts';

const CLIENT = join(import.meta.dirname, '..', 'build', 'client');
const APP = join(import.meta.dirname, '..', 'app');

/**
 * The plans, read from the builder's source the same way the pricing page
 * reads them (app/plan-sources.ts does it through Vite, which this script
 * does not run under).
 */
function plans(): Plans {
  const worker = (file: string) =>
    readFileSync(
      join(import.meta.dirname, '..', '..', 'web', 'worker', file),
      'utf8',
    );
  return readPlans({
    entitlement: worker('entitlement.ts'),
    signupCredit: worker('signup-credit.ts'),
    stripeClient: worker('stripe-client.ts'),
    modelAccess: worker('model-access.ts'),
  });
}

/**
 * The files a page's content is written in, for its sitemap `lastmod`.
 *
 * The route module, plus the data only that page reads. Deliberately not
 * `site.ts` or the shared components: they touch every page, so counting
 * them would stamp the whole site with one date on every change, and a
 * lastmod that is always today is one a search engine learns to ignore.
 */
function sourcesFor(path: string): string[] {
  const module =
    path === '/'
      ? 'routes/home.tsx'
      : path.startsWith('/use-cases/')
        ? 'routes/use-case.tsx'
        : path.startsWith('/templates/')
          ? 'routes/template.tsx'
          : ['/legal', '/docs', '/use-cases'].includes(path)
            ? `routes/${path.slice(1)}.index.tsx`
            : `routes/${path.slice(1).replace(/\//g, '.')}.tsx`;
  const data: Record<string, string[]> = {
    '/': ['answers.ts'],
    '/pricing': [
      '../../web/worker/entitlement.ts',
      '../../web/worker/signup-credit.ts',
      '../../web/worker/stripe-client.ts',
    ],
    '/use-cases': ['use-cases.ts'],
    '/examples': ['examples.ts', '../../../examples/catalogue.json'],
    '/roadmap': ['roadmap.ts'],
  };
  // Every template page and the two galleries read the generated catalog.
  const catalog = '../../../packages/ai/data/design-templates.ts';
  const extra = path.startsWith('/use-cases/')
    ? ['use-cases.ts']
    : path.startsWith('/templates') || path === '/inspiration'
      ? [catalog]
      : (data[path] ?? []);
  const files = [module, ...extra].map((file) => join(APP, file));
  for (const file of files) {
    if (!existsSync(file)) {
      throw new Error(`sitemap: ${path} names ${file}, which does not exist`);
    }
  }
  return files;
}

/**
 * Whether git can date a file here. A shallow clone (actions/checkout's
 * default) knows one commit, so every file would carry that commit's date;
 * no `lastmod` is better than a wrong one.
 */
function gitCanDate(): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: APP,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'false'
    );
  } catch {
    return false;
  }
}

/** The date of the last commit that touched any of `files`, or null. */
function lastCommitDate(files: string[]): string | null {
  try {
    const date = execFileSync(
      'git',
      ['log', '-1', '--format=%cs', '--', ...files],
      { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

/** Absolute URL for a route path, matching what the host actually serves. */
function absolute(path: string): string {
  return new URL(path, SITE.url).toString();
}

function write(relativePath: string, body: string): void {
  const target = join(CLIENT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
  console.log(`  wrote ${relativePath}`);
}

/**
 * `html_handling: "drop-trailing-slash"` in wrangler.jsonc serves every page
 * at its slash-free path, which is also the form `metaFor` puts in the
 * canonical tag. The sitemap has to agree with both -- a sitemap entry that
 * redirects is a crawl budget leak and a canonical conflict.
 */
function sitemap(): string {
  const dated = gitCanDate();
  if (!dated) console.log('  (no git history to date pages; lastmod omitted)');
  const urls = ROUTES.map((route) => {
    const home = route.path === '/';
    const lastmod = dated ? lastCommitDate(sourcesFor(route.path)) : null;
    return [
      '  <url>',
      `    <loc>${absolute(route.path)}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      `    <changefreq>${home ? 'weekly' : 'yearly'}</changefreq>`,
      `    <priority>${home ? '1.0' : '0.3'}</priority>`,
      '  </url>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * The crawlers that feed AI assistants and AI search, named so the file says
 * on its face that they are welcome. Allowed by default on 2026-09-29, for
 * visibility in assistants; refusing any of them is Chris's call. They share the `*`
 * group's rules rather than having their own: a crawler obeys only the most
 * specific group that names it, so a separate group would silently drop the
 * `/api/` rule for exactly these crawlers.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'DuckAssistBot',
  'meta-externalagent',
  'CCBot',
] as const;

function robots(): string {
  return `# https://vibld.com
# Every crawler is welcome, including the ones that feed AI assistants and AI
# search; there is nothing here that should not be indexed or read.
User-agent: *
${AI_CRAWLERS.map((agent) => `User-agent: ${agent}`).join('\n')}
Allow: /

# The API is not a page.
Disallow: /api/

Sitemap: ${absolute('/sitemap.xml')}
`;
}

/**
 * A plain-language summary for assistants that read llms.txt.
 *
 * This matters more than usual here: "vibld" is read by search engines as a
 * misspelling of "Bible", so an unambiguous, machine-readable statement of
 * what the word means is one of the few levers available.
 */
function llms(): string {
  const legal = LEGAL_DOCS.map(
    (doc) =>
      `- [${doc.label}](${absolute(`/legal/${doc.slug}`)}): ${doc.description}`,
  ).join('\n');
  const pages = PRODUCT_PAGES.map(
    (page) =>
      `- [${page.label}](${absolute(page.path)}): ${routeFor(page.path).description}`,
  ).join('\n');
  const useCases = USE_CASES.map(
    (useCase) =>
      `- [${useCase.label}](${absolute(`/use-cases/${useCase.slug}`)}): ${useCase.description}`,
  ).join('\n');
  const docs = DOC_TRACKS.map((track) =>
    [
      `### ${track.label}`,
      '',
      ...guidesIn(track.id).map(
        (guide) =>
          `- [${guide.label}](${absolute(`/docs/${guide.slug}`)}): ${guide.description}`,
      ),
    ].join('\n'),
  ).join('\n\n');
  const questions = answers(plans())
    .map((item) => `### ${item.question}\n\n${item.answer}`)
    .join('\n\n');
  return `# vibld

> ${SITE.summary}

vibld (pronounced "vibe-build") is a product of ${SITE.legalEntity}. It is not
related to Bible study software; the name is a contraction of "vibe" and
"build".

## Status

vibld is in public beta. Anyone can sign up at ${SITE.signUpUrl}, and the
builder itself is at ${SITE.appUrl}. Plans and prices are at
${absolute('/pricing')}.

## What makes it different

Generated applications are conventional, portable software projects that keep
working without vibld. Users can read and export the complete project, or push
it to GitHub as a branch and a pull request. The builder keeps each project's
history as revisions in its own storage; Git comes in when a project is
pushed. Generated code is meant to be readable enough to review, not merely
exportable.

## Running it yourself

- With your own model key and no deployment: in a clone of ${SITE.repoUrl},
  \`pnpm generate "<prompt>" --out ./site --build\` with one Anthropic,
  DeepSeek or OpenAI key runs the same bounded build as the hosted builder,
  writes the project, and builds it with npm, asking the model for one repair
  if the build fails. A weekly workflow proves this from a clean clone.
- \`pnpm --filter @vibld/web dev\` runs the builder's interface locally with a
  deterministic fake provider. No model is called.
- Self-hosting the whole service on Cloudflare is documented, and a workflow
  checks that a separately named copy deploys from the docs and refuses a
  signed-out caller. Nobody outside the project has deployed their own copy
  yet, and sign-in and generation on a copy are not checked. See
  ${absolute('/docs/self-hosting')}.

## Questions

${questions}

## Pages

${pages}

## Use cases

${useCases}

## Docs

${docs}

The full text of the product pages, the docs and the policies is at
${absolute('/llms-full.txt')}.

## Source

- [Source repository](${SITE.repoUrl}): the builder is open source.
- [The builder](${SITE.appUrl}): the product itself.
- [Sign up](${SITE.signUpUrl}): create an account.

## Legal

${legal}

## Contact

- General: ${SITE.emails.hello}
- Security: ${SITE.emails.security}
- Privacy: ${SITE.emails.privacy}
`;
}

/**
 * The readable text of one prerendered page's `<main>`, as Markdown-ish
 * plain text: headings keep their level, list items become bullets, and
 * everything else (scripts, SVG, the demo builder's controls) is dropped.
 */
function pageText(path: string): string {
  const file =
    path === '/'
      ? join(CLIENT, 'index.html')
      : join(CLIENT, path.slice(1), 'index.html');
  const html = readFileSync(file, 'utf8');
  const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#x27': "'",
    '#39': "'",
    nbsp: ' ',
  };
  return (
    main
      .replace(/<(script|style|svg|button|form)\b[\s\S]*?<\/\1>/g, '')
      // One level down, so the page's own title stays the only top heading.
      .replace(
        /<h([1-6])\b[^>]*>/g,
        (_, level) => `\n\n${'#'.repeat(Math.min(+level + 1, 6))} `,
      )
      // Inline pieces set side by side ("$29" and "a month") need a space.
      .replace(/<\/(span|b|strong|em|code|a|small)>/g, '</$1> ')
      .replace(/<small\b/g, ' <small')
      .replace(/<li\b[^>]*>/g, '\n- ')
      .replace(/<\/(p|h[1-6]|li|dt|dd|tr|div|section|article|header)>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&([#\w]+);/g, (whole, name: string) => entities[name] ?? whole)
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      // A list item whose content is a heading leaves an empty bullet.
      .replace(/^-\n+/gm, '')
      .replace(/ +([,.;:)])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * llms.txt's longer companion: every page an assistant might be asked
 * about, as text, in one file. The home page is left out, because its text
 * is mostly the demonstration builder; its questions are in llms.txt.
 */
function llmsFull(): string {
  const paths = [
    ...PRODUCT_PAGES.map((page) => page.path),
    ...USE_CASES.map((useCase) => `/use-cases/${useCase.slug}`),
    '/docs',
    ...DOC_GUIDES.map((guide) => `/docs/${guide.slug}`),
    ...LEGAL_DOCS.map((doc) => `/legal/${doc.slug}`),
  ];
  const sections = paths.map((path) =>
    [
      `# ${routeFor(path).title}`,
      '',
      `Source: ${absolute(path)}`,
      '',
      pageText(path),
    ].join('\n'),
  );
  return [
    `# vibld: the full text`,
    '',
    `> ${SITE.summary}`,
    '',
    `The short version, with answers to common questions, is ${absolute('/llms.txt')}.`,
    '',
    ...sections.flatMap((section) => [section, '', '---', '']),
  ].join('\n');
}

/**
 * React Router emits `__spa-fallback.html` for a client-rendered route. This
 * site prerenders every route and serves 404.html for anything else, so the
 * file is never used, and the asset store served it at `/__spa-fallback` as
 * a 200 page with no title: a thin duplicate a crawler could find.
 */
function removeSpaFallback(): void {
  rmSync(join(CLIENT, '__spa-fallback.html'), { force: true });
  console.log('  removed __spa-fallback.html');
}

/**
 * React Router prerenders `/404` to `404/index.html`. Cloudflare's
 * `not_found_handling: "404-page"` looks for `404.html`, so move it -- and
 * remove the directory, or `/404` stays reachable as its own 200 page.
 */
function relocate404(): void {
  const source = join(CLIENT, '404', 'index.html');
  writeFileSync(join(CLIENT, '404.html'), readFileSync(source, 'utf8'), 'utf8');
  rmSync(join(CLIENT, '404'), { recursive: true, force: true });
  console.log('  wrote 404.html (and removed the /404 route directory)');
}

/**
 * Each example's source, as the download the examples page links to.
 *
 * Packed at build time from examples/generated/<slug>/ rather than committed
 * as archives, so the download cannot drift from the source the repository
 * holds. Files sit under a `<slug>/` folder so unzipping makes one directory.
 */
function exampleArchives(): void {
  const root = join(import.meta.dirname, '..', '..', '..', 'examples');
  const catalogue = JSON.parse(
    readFileSync(join(root, 'catalogue.json'), 'utf8'),
  ) as { examples: { slug: string }[] };
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  for (const { slug } of catalogue.examples) {
    const source = join(root, 'generated', slug);
    const files = walk(source)
      .sort()
      .map((path) => ({
        path: `${slug}/${relative(source, path).split(sep).join('/')}`,
        data: readFileSync(path),
      }));
    const target = join(CLIENT, 'examples', `${slug}.zip`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zip(files));
    console.log(`  wrote examples/${slug}.zip (${files.length} files)`);
  }
}

console.log('postbuild:');
write('robots.txt', robots());
write('sitemap.xml', sitemap());
write('llms.txt', llms());
write('llms-full.txt', llmsFull());
relocate404();
removeSpaFallback();
exampleArchives();
