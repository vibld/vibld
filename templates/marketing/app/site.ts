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
  name: 'Northwind Supply',
  tagline: 'Parts, sourced properly.',
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
    title: ` | ${SITE.tagline}`,
    description:
      'Industrial parts sourcing for maintenance teams who need the right component this week, not next quarter.',
  },
  {
    path: '/what-we-do',
    label: 'What we do',
    title: `What we do | `,
    description:
      'Sourcing, verification and logistics for hard-to-find industrial components, handled end to end.',
  },
  {
    path: '/pricing',
    label: 'Pricing',
    title: `Pricing | `,
    description:
      'Transparent per-order and retainer pricing, with no minimum commitment and no charge for a sourcing quote.',
  },
  {
    path: '/faq',
    label: 'FAQ',
    title: `Frequently asked questions | `,
    description:
      'Lead times, verification, returns and how sourcing works when a part is discontinued.',
  },
  {
    path: '/contact',
    label: 'Contact',
    title: `Contact | `,
    description:
      'Send a part number and a deadline. A sourcing specialist replies within one business day.',
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
