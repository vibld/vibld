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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { LEGAL_DOCS, ROUTES, SITE } from '../app/site.ts';

const CLIENT = join(import.meta.dirname, '..', 'build', 'client');

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
  const urls = ROUTES.map((route) => {
    const home = route.path === '/';
    return [
      '  <url>',
      `    <loc>${absolute(route.path)}</loc>`,
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

function robots(): string {
  return `# https://vibld.com
# Every crawler is welcome; there is nothing here that should not be indexed.
User-agent: *
Allow: /

# The waitlist endpoint is not a page.
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
  return `# Vibld

> ${SITE.summary}

Vibld (pronounced "vibe-build") is a product of ${SITE.legalEntity}. It is not
related to Bible study software; the name is a contraction of "vibe" and
"build".

## Status

Vibld has not launched. ${absolute('/')} currently collects email addresses for
a waitlist ahead of an invitation-only alpha. There is no public product to
sign up for yet.

## What makes it different

Generated applications are conventional, portable software projects that keep
working without Vibld. Users can read and export the complete project. Git is
the canonical project history, and generated code is meant to be readable
enough to review, not merely exportable.

## Source

- [Source repository](${SITE.github}): the builder is open source.

## Legal

${legal}

## Contact

- General: ${SITE.emails.hello}
- Security: ${SITE.emails.security}
- Privacy: ${SITE.emails.privacy}
`;
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

console.log('postbuild:');
write('robots.txt', robots());
write('sitemap.xml', sitemap());
write('llms.txt', llms());
relocate404();
