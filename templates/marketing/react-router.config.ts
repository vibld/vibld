import type { Config } from '@react-router/dev/config';

import { ROUTE_PATHS } from './app/site';

/**
 * Every marketing route is rendered to HTML at build time.
 *
 * `ssr: false` means there is no server to run: the build emits plain files a
 * static host can serve, which is what makes this project portable. A crawler
 * or a reader with JavaScript disabled gets the real page, not an empty shell
 * waiting to hydrate.
 *
 * The paths come from the same list the navigation is built from, so a route
 * cannot be added to the site and quietly left out of the prerender.
 */
export default {
  ssr: false,
  prerender: ROUTE_PATHS,
} satisfies Config;
