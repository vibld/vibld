import type { Config } from '@react-router/dev/config';

import { ROUTE_PATHS } from './app/site';

/**
 * Every route is rendered to HTML at build time.
 *
 * `ssr: false` means there is no server for the site itself: the build emits
 * plain files a static host (here, a Worker's `assets` binding) can serve.
 * The one thing this site does need a server for -- the waitlist submission
 * -- is a separate `/api/waitlist` route handled by the Worker in `worker/`,
 * not by this app.
 */
export default {
  ssr: false,
  prerender: ROUTE_PATHS,
} satisfies Config;
