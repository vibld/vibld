import { Link } from 'react-router';

import { SITE } from '../site';

/**
 * Prerendered to `/404.html`, which `not_found_handling: "404-page"` in
 * wrangler.jsonc serves -- with a real 404 status -- for any path that does
 * not match an asset.
 *
 * Before this existed the site answered 200 with the home page for every
 * unknown URL, which made robots.txt, sitemap.xml and any invented path look
 * like real pages to a crawler.
 */
export function meta() {
  return [
    { title: `Page not found | ${SITE.name}` },
    { name: 'robots', content: 'noindex' },
    {
      name: 'description',
      content: 'That page does not exist on vibld.com.',
    },
  ];
}

export default function NotFound() {
  return (
    <article className="mx-auto max-w-5xl px-5 py-16">
      <p className="font-mono text-sm font-medium tracking-wide text-[var(--color-accent-ink)] uppercase">
        404
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)] text-pretty">
        That page does not exist. It may have moved, or the link may be out of
        date.
      </p>
      <p className="mt-6">
        <Link
          to="/"
          className="font-medium text-[var(--color-accent)] underline underline-offset-4"
        >
          Go to the home page
        </Link>
      </p>
    </article>
  );
}
