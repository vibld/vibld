/**
 * The site's content and structure in one place.
 *
 * Navigation, the prerender list and every page's metadata are derived from
 * this file rather than repeated. A route added here appears in the nav and in
 * the build output together; there is no way to ship one without the other.
 */

export interface SiteRoute {
  path: string;
  /** Nav label. Short by design -- it sits in a horizontal list. */
  label: string;
  title: string;
  description: string;
}

export const SITE = {
  name: 'Emberline',
  tagline: 'Listen. Group. Decide.',
  /**
   * Absolute URLs are required in social card metadata, so the origin has to
   * come from somewhere. The fallback keeps a fresh clone building; it is not
   * a working value.
   */
  url: import.meta.env?.VITE_SITE_URL ?? 'https://example.com',
} as const;

export const ROUTES: SiteRoute[] = [
  {
    path: '/',
    label: 'Home',
    title: `${SITE.name} | Every customer voice in one inbox`,
    description:
      'Emberline gathers customer feedback from email, chat and in-app widgets into one inbox, groups it into themes, and shows a product team what to build next.',
  },
  {
    path: '/features',
    label: 'Features',
    title: `Features | ${SITE.name}`,
    description:
      'Themes instead of tags, a ranking you can explain, replies to everyone who asked, and an export that takes all of it with you.',
  },
  {
    path: '/pricing',
    label: 'Pricing',
    title: `Pricing | ${SITE.name}`,
    description:
      'Three plans priced per workspace, not per message, with a free plan for a founder who still reads every message personally.',
  },
  {
    path: '/faq',
    label: 'FAQ',
    title: `Frequently asked questions | ${SITE.name}`,
    description:
      'How themes are formed, what happens to personal details, importing old feedback, and taking your data with you when you leave.',
  },
  {
    path: '/contact',
    label: 'Contact',
    title: `Contact | ${SITE.name}`,
    description:
      'Ask for a walkthrough of Emberline with your own sources, or ask a question about plans, security or migration.',
  },
];

/** The prerender list. Every declared route, and nothing that is not one. */
export const ROUTE_PATHS: string[] = ROUTES.map((route) => route.path);

export function routeFor(path: string): SiteRoute {
  const route = ROUTES.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`No route declared for ${path}`);
  return route;
}

/**
 * Page metadata, built once so every page gets a title, a description and a
 * complete social card rather than whichever tags were remembered that day.
 */
export function metaFor(path: string) {
  const route = routeFor(path);
  const url = new URL(path, SITE.url).toString();
  return [
    { title: route.title },
    { name: 'description', content: route.description },
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE.name },
    { property: 'og:title', content: route.title },
    { property: 'og:description', content: route.description },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: route.title },
    { name: 'twitter:description', content: route.description },
  ];
}
