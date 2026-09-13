/**
 * The site's content and structure in one place, the same pattern the
 * marketing template this site is built from (`templates/marketing`) uses.
 *
 * Every prerendered route and its metadata live here so a route cannot be
 * added to the build without also getting a title, a description and a
 * place in the legal index.
 */

export interface SiteRoute {
  path: string;
  title: string;
  description: string;
}

export const SITE = {
  name: 'Vibld',
  tagline: 'Vibe. Build. Ship.',
  /**
   * Absolute URLs are required in social card metadata, so the origin has to
   * come from somewhere. The fallback keeps a fresh clone building; it is not
   * the production value.
   */
  url: import.meta.env?.VITE_SITE_URL ?? 'https://vibld.com',
  /**
   * Cloudflare Turnstile's site key -- public by design, meant to sit in
   * every page's HTML (docs/decisions.md L29). The matching secret key
   * verifies tokens server-side in worker/waitlist.ts and is never
   * committed; it lives on the `marketing` GitHub environment.
   */
  turnstileSiteKey: '0x4AAAAAAEvZ-7lTZ_uSHPoH',
  /** Issue #7 -- link the repository and the open-source, portable-code promise. */
  repoUrl: 'https://github.com/vibld/vibld',
  /** Decisions L16 -- the exact values that must appear on every legal page. */
  legalEntity: 'Chris Brock LLC',
  mailingAddress: '285 W Wieuca Rd NE STE 62715, Atlanta, GA 30342',
  governingLaw: 'the State of Georgia, USA, with venue in Gwinnett County',
  emails: {
    support: 'support@vibld.com',
    privacy: 'privacy@vibld.com',
    security: 'security@vibld.com',
    abuse: 'abuse@vibld.com',
    legal: 'legal@vibld.com',
    billing: 'billing@vibld.com',
    hello: 'hello@vibld.com',
  },
} as const;

/** One entry per legal document. Drives the footer, the `/legal` index and the prerender list. */
export interface LegalDoc {
  slug: string;
  label: string;
  title: string;
  description: string;
}

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: 'terms',
    label: 'Terms of Service',
    title: `Terms of Service | ${SITE.name}`,
    description:
      'The agreement between you and Chris Brock LLC for using Vibld and its waitlist.',
  },
  {
    slug: 'privacy',
    label: 'Privacy Policy',
    title: `Privacy Policy | ${SITE.name}`,
    description:
      'What Vibld collects, why, how long it is kept, and how to request access or deletion.',
  },
  {
    slug: 'acceptable-use',
    label: 'Acceptable Use Policy',
    title: `Acceptable Use Policy | ${SITE.name}`,
    description: 'What may and may not be built, sent or hosted through Vibld.',
  },
  {
    slug: 'security',
    label: 'Security & Vulnerability Disclosure',
    title: `Security & Vulnerability Disclosure | ${SITE.name}`,
    description:
      'How to report a vulnerability, and the safe harbor for good-faith research.',
  },
  {
    slug: 'subprocessors',
    label: 'Subprocessors',
    title: `Subprocessors | ${SITE.name}`,
    description:
      'The services Vibld uses to operate, and what each one is used for.',
  },
  {
    slug: 'cookies',
    label: 'Cookie Notice',
    title: `Cookie Notice | ${SITE.name}`,
    description: 'What this site stores in your browser today, and why.',
  },
  {
    slug: 'refunds',
    label: 'Refund Policy',
    title: `Refund Policy | ${SITE.name}`,
    description: 'How refunds work for paid Vibld plans.',
  },
  {
    slug: 'licenses',
    label: 'Open-Source Notices',
    title: `Open-Source Notices | ${SITE.name}`,
    description:
      'The license terms covering Vibld’s core and its starter templates.',
  },
];

export const ROUTES: SiteRoute[] = [
  {
    path: '/',
    title: `${SITE.name} | ${SITE.tagline}`,
    description:
      'Vibld is an AI application builder that generates conventional, portable projects -- no proprietary runtime, no lock-in. Join the waitlist.',
  },
  {
    path: '/legal',
    title: `Legal | ${SITE.name}`,
    description: 'Every policy governing Vibld and this site, in one place.',
  },
  ...LEGAL_DOCS.map((doc) => ({
    path: `/legal/${doc.slug}`,
    title: doc.title,
    description: doc.description,
  })),
];

export const ROUTE_PATHS: string[] = ROUTES.map((route) => route.path);

export function routeFor(path: string): SiteRoute {
  const route = ROUTES.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`No route declared for ${path}`);
  return route;
}

export function metaFor(path: string) {
  const route = routeFor(path);
  const url = new URL(path, SITE.url).toString();
  const image = new URL('/og-image.png', SITE.url).toString();
  return [
    { title: route.title },
    { name: 'description', content: route.description },
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE.name },
    { property: 'og:title', content: route.title },
    { property: 'og:description', content: route.description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: route.title },
    { name: 'twitter:description', content: route.description },
    { name: 'twitter:image', content: image },
  ];
}
