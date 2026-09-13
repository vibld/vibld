/**
 * Deterministic prompt -> project brief derivation.
 *
 * This is a local stand-in for a planning model. It is intentionally small,
 * pure and free of randomness or clocks so the whole builder shell can be
 * exercised in tests and in CI without model credentials (ADR-0007: use a
 * fake provider in normal CI).
 */

export type SectionKind =
  'hero' | 'features' | 'pricing' | 'faq' | 'testimonials' | 'contact';

export interface SectionSpec {
  kind: SectionKind;
  heading: string;
  body: string;
  items: string[];
}

export interface ProjectBrief {
  /** Human-readable project name, safe for HTML and JSX text. */
  title: string;
  /** Package-name-safe slug derived from the title. */
  slug: string;
  tagline: string;
  sections: SectionSpec[];
}

/** Keyword triggers, checked in a fixed order so output is stable. */
const SECTION_TRIGGERS: {
  kind: Exclude<SectionKind, 'hero'>;
  patterns: string[];
}[] = [
  {
    kind: 'features',
    patterns: ['feature', 'benefit', 'capabilit', 'what it does'],
  },
  {
    kind: 'pricing',
    patterns: ['pricing', 'price', 'plan', 'tier', 'subscription'],
  },
  {
    kind: 'testimonials',
    patterns: ['testimonial', 'review', 'customer', 'social proof'],
  },
  { kind: 'faq', patterns: ['faq', 'question', 'q&a'] },
  {
    kind: 'contact',
    patterns: ['contact', 'get in touch', 'email us', 'demo request'],
  },
];

const SECTION_CONTENT: Record<
  Exclude<SectionKind, 'hero'>,
  { heading: string; body: string; items: string[] }
> = {
  features: {
    heading: 'Features',
    body: 'Everything included in the first release.',
    items: [
      'Fast, accessible pages built from conventional React components',
      'Typed, portable source you can edit in any editor',
      'No proprietary runtime required to build or deploy',
    ],
  },
  pricing: {
    heading: 'Pricing',
    body: 'Straightforward plans. Placeholder figures for review.',
    items: [
      'Starter -- $0 / month',
      'Team -- $29 / month',
      'Scale -- Contact us',
    ],
  },
  testimonials: {
    heading: 'What people say',
    body: 'Placeholder quotes. Replace them before publishing.',
    items: [
      '"Shipped our marketing site in an afternoon." -- Placeholder Name',
      '"The exported project was just a normal Vite app." -- Placeholder Name',
    ],
  },
  faq: {
    heading: 'Frequently asked questions',
    body: 'Answers you can edit directly in the generated source.',
    items: [
      'Can I export this project? Yes -- it is a conventional npm project.',
      'Do I need Vibld to build it? No. npm install and npm run build are enough.',
    ],
  },
  contact: {
    heading: 'Contact',
    body: 'This form is a demonstration and does not submit anywhere yet.',
    items: ['Name', 'Email', 'How can we help?'],
  },
};

/** Words that carry no signal when naming a project. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'build',
  'called',
  'create',
  'for',
  'generate',
  'make',
  'me',
  'my',
  'page',
  'please',
  'site',
  'that',
  'the',
  'to',
  'with',
]);

/**
 * Reduce arbitrary user text to characters that are safe to place in HTML
 * text, JSX text and Markdown without escaping surprises.
 */
export function sanitizeText(value: string): string {
  return value
    .replace(/[^\p{L}\p{N} .,!?'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Capitalize a plain lowercase word; leave existing casing (SaaS, API) alone. */
function titleCase(word: string): string {
  if (word !== word.toLowerCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function deriveTitle(prompt: string): string {
  const words = sanitizeText(prompt)
    .split(' ')
    .map((word) => word.replace(/[.,!?']/g, ''))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word.toLowerCase()));

  const chosen = words.slice(0, 3).map(titleCase);
  return chosen.length > 0 ? chosen.join(' ') : 'Vibld Project';
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'vibld-project';
}

export function deriveBrief(prompt: string): ProjectBrief {
  const normalized = sanitizeText(prompt).toLowerCase();
  const title = deriveTitle(prompt);

  const sections: SectionSpec[] = [
    {
      kind: 'hero',
      heading: title,
      body: `A prerendered marketing page generated from your description.`,
      items: [],
    },
  ];

  for (const trigger of SECTION_TRIGGERS) {
    if (trigger.patterns.some((pattern) => normalized.includes(pattern))) {
      sections.push({ kind: trigger.kind, ...SECTION_CONTENT[trigger.kind] });
    }
  }

  // Every page needs something below the fold, even for a bare prompt.
  if (sections.length === 1) {
    sections.push({ kind: 'features', ...SECTION_CONTENT.features });
  }

  return {
    title,
    slug: slugify(title),
    tagline:
      sanitizeText(prompt).slice(0, 140) ||
      'Describe your application to begin.',
    sections,
  };
}
