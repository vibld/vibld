import type { Config } from '@react-router/dev/config';

import { ROUTE_PATHS } from './app/site';
import { STYLE_CARD_PATHS } from './app/style-cards';

/**
 * Every route is rendered to HTML at build time.
 *
 * `ssr: false` means there is no server for the site itself: the build emits
 * plain files a static host (here, a Worker's `assets` binding) can serve.
 * What this site does need a server for -- the page-view counter, and the
 * waitlist submission it still accepts though no page renders the form since
 * the open beta -- is separate `/api/*` routes handled by the Worker in
 * `worker/`, not by this app.
 */
export default {
  ssr: false,
  prerender: {
    // '/404' is prerendered but deliberately absent from ROUTE_PATHS, so it
    // stays out of the sitemap; postbuild.ts relocates it to /404.html.
    // The style cards' preview files (app/style-cards.ts) are prerendered
    // too, and are not pages either.
    paths: [...ROUTE_PATHS, '/404', ...STYLE_CARD_PATHS],
    // Each page is a request to a local preview server, and most of a
    // request's time is spent waiting on it rather than rendering. In
    // series, the style gallery's pages (D143) alone took five minutes.
    concurrency: 8,
  },
} satisfies Config;
