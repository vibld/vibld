/**
 * The site's content and structure in one place, the same pattern the
 * marketing template this site is built from (`templates/marketing`) uses.
 *
 * Every prerendered route and its metadata live here so a route cannot be
 * added to the build without also getting a title, a description and a
 * place in the legal index.
 */

import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';

import { LAYERS } from './layers.ts';
import { USE_CASES } from './use-cases.ts';

export interface SiteRoute {
  path: string;
  title: string;
  description: string;
}

/** The builder's origin. Named once so the sign-in and sign-up links cannot drift apart. */
const APP_URL = 'https://app.vibld.com';

export const SITE = {
  /**
   * Lowercase, everywhere, with no exceptions (Chris, 2026-09-16). It is the
   * wordmark, so it is set the way the wordmark is set: in titles, in the
   * header, in body copy, mid-sentence.
   *
   * `legalName` below is the capitalised form, which exists for one job:
   * schema.org needs an `alternateName` a search engine can match against the
   * way people actually type it. BRAND-01 is about consistency, and giving a
   * crawler both spellings of one entity serves that better than pretending
   * only one exists.
   */
  name: 'vibld',
  legalName: 'Vibld',
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
  /**
   * Google Analytics 4's measurement ID (docs/decisions.md). Public by
   * design: it ships in every page's HTML and identifies the property, not a
   * person. Unlike the first-party counter in worker/analytics.ts, GA4 sets
   * cookies and assigns a client identifier, which is why the Cookie Notice,
   * the Privacy Policy and the Subprocessors page all say so.
   */
  ga4MeasurementId: 'G-JCWXRRM8R9',
  /**
   * The only hostnames that report to that property.
   *
   * Everything else, the workers.dev preview and `pnpm dev` included, loads
   * no analytics at all and is not asked for consent, because a question
   * whose answer cannot change anything is noise. Without this the preview
   * and a laptop both fed the production numbers.
   */
  analyticsHosts: ['vibld.com', 'www.vibld.com'] as readonly string[],
  /** internal issue 7 -- link the repository and the open-source, portable-code promise. */
  repoUrl: 'https://github.com/vibld/vibld',
  /**
   * The builder (docs/decisions.md L20). A separate host, so this is a plain
   * anchor rather than a router Link.
   *
   * It exists here because until now this site had no link to the product at
   * all: four calls to join the waitlist, nine legal pages, and no way in for
   * someone who already has an account. `test/prerender.test.ts` asserts every
   * page carries it, since "the front door has no handle" is exactly the kind
   * of absence nobody notices by looking at the page.
   */
  appUrl: APP_URL,
  /**
   * The builder's sign-up form (the open beta, Chris 2026-09-27). Every call
   * to action that used to say "Join the waitlist" links here now: anybody
   * can sign up, and the form is what signing up is. A path in the builder
   * (`SIGN_UP_PATH` in apps/web/src/auth/clerk-token.ts) rather than Clerk's
   * hosted page, so a visitor stays on vibld's own domain throughout;
   * apps/web's `sign-up-path.test.ts` holds the two to the same address.
   */
  signUpUrl: `${APP_URL}/sign-up`,
  /**
   * What the product is called while it is in beta, in the one place every
   * page reads it from. The label Chris chose (2026-09-27).
   */
  stage: 'Public beta',
  /** Decisions L16 -- the exact values that must appear on every legal page. */
  legalEntity: 'Chris Brock LLC',
  /**
   * The date every legal page shows as "Last updated", and the date the
   * Terms, the policies and the notices take effect. One value for all of
   * them: they were rewritten together for the open paid beta and take
   * effect together (Chris, 2026-09-28).
   *
   * It is the launch day, the day the beta opened (Chris, 2026-09-28). A
   * later revision of any one document changes this for all of them, since
   * they are one set.
   */
  legalEffectiveDate: '2026-09-28',
  /**
   * Decisions BRAND-01 -- searching "vibld" returns Bible-study sites, because
   * Google reads the word as a misspelling of "Bible". Nothing on-page fixes
   * that directly; what does help is publishing an unambiguous entity, so the
   * name, the logo, the source repository and the description below are the
   * same everywhere they appear. `sameAs` is the strongest signal available,
   * so it lists only profiles that actually exist -- an invented URL is worse
   * than an omitted one.
   */
  sameAs: [
    'https://github.com/vibld/vibld',
    // The company page docs/social-launch.md describes. Checked on
    // 2026-09-29: it exists, is named vibld, and links to https://vibld.com/.
    'https://www.linkedin.com/company/vibld',
  ] as readonly string[],
  /** The social card built by the brand system (internal issue 7). Absolute URL is filled in against SITE.url; see `metaFor`. */
  ogImage: '/og-image.png',
  ogImageAlt:
    'vibld: an AI application builder that generates conventional, portable projects.',
  /** One sentence, reused verbatim in schema, llms.txt and the OG card. */
  summary:
    'vibld is an AI application builder that turns a conversation into a working project and generates a conventional, portable codebase you can read, own and take with you.',
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
      'The agreement between you and Chris Brock LLC for using vibld, its plans and credit, and what you build and publish with it.',
  },
  {
    slug: 'privacy',
    label: 'Privacy Policy',
    title: `Privacy Policy | ${SITE.name}`,
    description:
      'What vibld collects on this site and in the builder, which services receive it, how long it is kept, and how to ask for access or deletion.',
  },
  {
    slug: 'acceptable-use',
    label: 'Acceptable Use Policy',
    title: `Acceptable Use Policy | ${SITE.name}`,
    description:
      'What may and may not be built, published, shared or sent through vibld, and how to report abuse.',
  },
  {
    slug: 'security',
    label: 'Security & Vulnerability Disclosure',
    title: `Security & Vulnerability Disclosure | ${SITE.name}`,
    description:
      'How to report a vulnerability, what is in scope, and the safe harbor for good-faith research.',
  },
  {
    slug: 'subprocessors',
    label: 'Subprocessors',
    title: `Subprocessors | ${SITE.name}`,
    description:
      'The services that process data for vibld, and what each one receives.',
  },
  {
    slug: 'cookies',
    label: 'Cookie Notice',
    title: `Cookie Notice | ${SITE.name}`,
    description:
      'What vibld.com, the builder and shared previews store in your browser, and why.',
  },
  {
    slug: 'refunds',
    label: 'Refund Policy',
    title: `Refund Policy | ${SITE.name}`,
    description:
      'Cancelling a plan, refunds for plans and top-ups, and what happens after a refund or a dispute.',
  },
  {
    slug: 'licenses',
    label: 'Open-Source Notices',
    title: `Open-Source Notices | ${SITE.name}`,
    description:
      'The license terms covering vibld’s core and its starter templates.',
  },
];

/**
 * The two documentation tracks (docs/decisions.md, resolved 2026-09-16).
 *
 * Separate rather than one set of pages with "if you are self-hosting"
 * asides, because the two readers are answering different questions. Somebody
 * using app.vibld.com never has to know what a Durable Object is; somebody
 * running their own copy needs to know exactly which bindings exist and which
 * secrets have to be set, and is not helped by being told what their credit
 * balance means.
 */
export type DocTrack = 'hosted' | 'self-hosted';

export interface DocTrackInfo {
  id: DocTrack;
  label: string;
  lead: string;
}

export const DOC_TRACKS: DocTrackInfo[] = [
  {
    id: 'hosted',
    label: 'Using vibld',
    lead: 'The hosted builder at app.vibld.com: what each part of it does, what it costs, and where your project goes when you are finished with it.',
  },
  {
    id: 'self-hosted',
    label: 'Running vibld yourself',
    lead: 'The published source, run on your own Cloudflare account and your own model keys. What it needs, what you have to set, and what differs from the hosted service.',
  },
];

export interface DocGuide {
  slug: string;
  track: DocTrack;
  label: string;
  title: string;
  description: string;
}

export const DOC_GUIDES: DocGuide[] = [
  {
    slug: 'getting-started',
    track: 'hosted',
    label: 'Getting started',
    title: `Getting started | ${SITE.name} docs`,
    description: 'Sign in, describe what you want, and watch your first build.',
  },
  {
    slug: 'the-builder',
    track: 'hosted',
    label: 'The builder, pane by pane',
    title: `The builder, pane by pane | ${SITE.name} docs`,
    description:
      'What Preview, Code, Console, Problems and Runs each show, and what they do not.',
  },
  {
    slug: 'running-your-project',
    track: 'hosted',
    label: 'Running and sharing your project',
    title: `Running and sharing your project | ${SITE.name} docs`,
    description:
      'Run a real installed copy in a sandbox, share it with a link, and revoke it.',
  },
  {
    slug: 'taking-your-code',
    track: 'hosted',
    label: 'Taking your code with you',
    title: `Taking your code with you | ${SITE.name} docs`,
    description:
      'Download the project, push it to GitHub, or publish it, and what each one produces.',
  },
  {
    slug: 'credits-and-plans',
    track: 'hosted',
    label: 'Credits and plans',
    title: `Credits and plans | ${SITE.name} docs`,
    description:
      'What a run costs, what a plan includes, and the order the three layers of credit are spent in.',
  },
  {
    slug: 'self-hosting',
    track: 'self-hosted',
    label: 'What self-hosting involves',
    title: `What self-hosting involves | ${SITE.name} docs`,
    description:
      'The three Workers, the stored state behind them, and the accounts you need before starting.',
  },
  {
    slug: 'configuration',
    track: 'self-hosted',
    label: 'Settings and secrets',
    title: `Settings and secrets | ${SITE.name} docs`,
    description:
      'Every variable and secret the Worker reads, what happens without each one, and where it belongs.',
  },
  {
    slug: 'deploying',
    track: 'self-hosted',
    label: 'Deploying your own copy',
    title: `Deploying your own copy | ${SITE.name} docs`,
    description:
      'From a clone to a running builder on your own Cloudflare account.',
  },
  {
    slug: 'hosted-vs-self-hosted',
    track: 'self-hosted',
    label: 'What differs from the hosted service',
    title: `What differs from the hosted service | ${SITE.name} docs`,
    description:
      'The parts of app.vibld.com that are operations rather than code, and what you take on by running your own.',
  },
];

export function guidesIn(track: DocTrack): DocGuide[] {
  return DOC_GUIDES.filter((guide) => guide.track === track);
}

export function trackFor(guide: DocGuide): DocTrackInfo {
  const track = DOC_TRACKS.find((candidate) => candidate.id === guide.track);
  if (!track) throw new Error(`No track declared for ${guide.slug}`);
  return track;
}

export const ROUTES: SiteRoute[] = [
  {
    path: '/',
    // What the product is, in the title itself. The tagline alone said
    // nothing a searcher could match, and "vibld" on its own is read as a
    // misspelling (BRAND-01), so the title is where the words that
    // disambiguate it do the most work.
    title: `${SITE.name} | AI application builder | ${SITE.tagline}`,
    description:
      'vibld is an AI application builder that generates conventional, portable projects: no proprietary runtime and no lock-in. In public beta, open to anyone.',
  },
  {
    path: '/how-it-works',
    title: `How it works | ${SITE.name}`,
    description:
      'From a request to three directions, a written spec, a staged checkpoint, design checks, a private preview, and then export, a GitHub pull request or a publish.',
  },
  {
    path: '/features',
    title: `Features | ${SITE.name}`,
    description:
      'What the builder does today: the composer, style presets, checkpoints, a real sandbox, share links, design checks, export, GitHub pull requests and publishing.',
  },
  {
    path: '/pricing',
    title: `Pricing | ${SITE.name}`,
    description:
      'What the Free, Build and Ship plans cost, the model spend each one includes every month, what a top-up adds, and the order credit is spent in.',
  },
  {
    path: '/use-cases',
    title: `Use cases | ${SITE.name}`,
    description:
      'The kinds of project people build with vibld, what to ask for, what comes back, and real examples built from one sentence.',
  },
  ...USE_CASES.map((useCase) => ({
    path: `/use-cases/${useCase.slug}`,
    title: `${useCase.label} | ${SITE.name} use cases`,
    description: useCase.description,
  })),
  {
    path: '/styles',
    title: `Styles | ${SITE.name}`,
    description:
      'Every visual direction vibld can build in, from the builder\u2019s own list: full colour systems where a direction has one, surface treatments where it does not.',
  },
  {
    path: '/templates',
    title: `Templates | ${SITE.name}`,
    description: `${DESIGN_TEMPLATE_INDEX.length} app and website designs to start from, each with a layout, a checked palette, a type pairing and a build prompt, grouped by what you are building.`,
  },
  ...DESIGN_TEMPLATE_INDEX.map((template) => ({
    path: `/templates/${template.id}`,
    title: `${template.name}, ${template.summary.charAt(0).toLowerCase()}${template.summary.slice(1)} | ${SITE.name} templates`,
    description: `${template.name}: a ${template.kind === 'app' ? 'app' : 'website'} design for vibld, a ${template.summary.charAt(0).toLowerCase()}${template.summary.slice(1)}, with its layout, palette, type and full build prompt.`,
  })),
  ...LAYERS.map((layer) => ({
    path: `/templates/${layer.slug}`,
    title: `${layer.name}, a ${layer.kind === 'page' ? 'landing page' : 'page section'} from one prompt | ${SITE.name} templates`,
    description: `${layer.name}: ${layer.summary.charAt(0).toLowerCase()}${layer.summary.slice(1)} The live page and the prompt that made it.`,
  })),
  {
    path: '/inspiration',
    title: `Inspiration | ${SITE.name}`,
    description:
      'Palettes and type pairings from every design in the template catalog, each colour pair checked against WCAG AA, to borrow for your own project.',
  },
  {
    path: '/examples',
    title: `Examples | ${SITE.name}`,
    description:
      'Sites and apps vibld built, each shown exactly as generated from its prompt, with a live copy and the source to download, then the hand-built starter templates.',
  },
  {
    path: '/roadmap',
    title: `Roadmap | ${SITE.name}`,
    description:
      'What vibld is building now, what comes next, what is being considered and what has shipped, with a vote on anything not yet built.',
  },
  {
    path: '/legal',
    title: `Legal | ${SITE.name}`,
    description: 'Every policy governing vibld and this site, in one place.',
  },
  ...LEGAL_DOCS.map((doc) => ({
    path: `/legal/${doc.slug}`,
    title: doc.title,
    description: doc.description,
  })),
  {
    path: '/docs',
    title: `Docs | ${SITE.name}`,
    description:
      'Guides for the hosted builder and for running your own copy of vibld.',
  },
  ...DOC_GUIDES.map((guide) => ({
    path: `/docs/${guide.slug}`,
    title: guide.title,
    description: guide.description,
  })),
];

export const ROUTE_PATHS: string[] = ROUTES.map((route) => route.path);

/**
 * The product pages, in the order the header and footer list them. One list
 * so the two cannot disagree about what the site has.
 */
export const PRODUCT_PAGES: { path: string; label: string }[] = [
  { path: '/how-it-works', label: 'How it works' },
  { path: '/features', label: 'Features' },
  { path: '/styles', label: 'Styles' },
  { path: '/templates', label: 'Templates' },
  { path: '/use-cases', label: 'Use cases' },
  { path: '/examples', label: 'Examples' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/roadmap', label: 'Roadmap' },
];

export function routeFor(path: string): SiteRoute {
  const route = ROUTES.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`No route declared for ${path}`);
  return route;
}

/**
 * The trail from the home page to `path`, for BreadcrumbList schema.
 *
 * Each step's name is the label the site already gives that page in its
 * navigation, never a new one, and a path this cannot name is a build
 * failure rather than a guess.
 */
export function breadcrumbsFor(path: string): { name: string; path: string }[] {
  const labels = new Map<string, string>([
    ['/', SITE.name],
    ['/legal', 'Legal'],
    ['/docs', 'Docs'],
    ...PRODUCT_PAGES.map((page) => [page.path, page.label] as [string, string]),
    ...LEGAL_DOCS.map(
      (doc) => [`/legal/${doc.slug}`, doc.label] as [string, string],
    ),
    ...DOC_GUIDES.map(
      (guide) => [`/docs/${guide.slug}`, guide.label] as [string, string],
    ),
    ...USE_CASES.map(
      (useCase) =>
        [`/use-cases/${useCase.slug}`, useCase.label] as [string, string],
    ),
    ['/inspiration', 'Inspiration'],
    ...DESIGN_TEMPLATE_INDEX.map(
      (template) =>
        [`/templates/${template.id}`, template.name] as [string, string],
    ),
    ...LAYERS.map(
      (layer) => [`/templates/${layer.slug}`, layer.name] as [string, string],
    ),
  ]);
  const segments = path.split('/').filter(Boolean);
  const paths = [
    '/',
    ...segments.map((_, i) => `/${segments.slice(0, i + 1).join('/')}`),
  ];
  return paths.map((step) => {
    const name = labels.get(step);
    if (!name) throw new Error(`No breadcrumb label for ${step}`);
    return { name, path: step };
  });
}

/** BreadcrumbList schema for every page below the home page. */
export function breadcrumbSchema(path: string) {
  return {
    'script:ld+json': {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbsFor(path).map((step, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: step.name,
        item: new URL(step.path, SITE.url).toString(),
      })),
    },
  };
}

export function metaFor(path: string) {
  const route = routeFor(path);
  const url = new URL(path, SITE.url).toString();
  const image = new URL(SITE.ogImage, SITE.url).toString();
  return [
    { title: route.title },
    { name: 'description', content: route.description },
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE.name },
    { property: 'og:title', content: route.title },
    { property: 'og:description', content: route.description },
    { property: 'og:url', content: url },
    // twitter:card declares a large image, so one has to exist -- without
    // og:image every share renders an empty card.
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: SITE.ogImageAlt },
    { property: 'og:locale', content: 'en_US' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: route.title },
    { name: 'twitter:description', content: route.description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: SITE.ogImageAlt },
    ...(path === '/' ? [] : [breadcrumbSchema(path)]),
  ];
}

/**
 * Organization and WebSite schema for the home page.
 *
 * React Router renders a `script:ld+json` meta descriptor as a JSON-LD block,
 * so this rides along with the rest of the metadata rather than needing its
 * own component.
 */
export function organizationSchema() {
  return {
    'script:ld+json': {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${SITE.url}/#organization`,
          name: SITE.name,
          alternateName: ['Vibld', 'Vibld by Chris Brock LLC'],
          url: SITE.url,
          // A raster logo at a known size. Google asks for at least
          // 112x112 in a format Google Images indexes; the SVG favicon had
          // no size to read, and the touch icon is the same mark at 180.
          logo: {
            '@type': 'ImageObject',
            url: new URL('/apple-touch-icon.png', SITE.url).toString(),
            width: 180,
            height: 180,
          },
          description: SITE.summary,
          email: SITE.emails.hello,
          sameAs: [...SITE.sameAs],
          address: {
            '@type': 'PostalAddress',
            streetAddress: '285 W Wieuca Rd NE STE 62715',
            addressLocality: 'Atlanta',
            addressRegion: 'GA',
            postalCode: '30342',
            addressCountry: 'US',
          },
        },
        {
          '@type': 'WebSite',
          '@id': `${SITE.url}/#website`,
          name: SITE.name,
          url: SITE.url,
          description: SITE.summary,
          inLanguage: 'en-US',
          publisher: { '@id': `${SITE.url}/#organization` },
        },
      ],
    },
  };
}
