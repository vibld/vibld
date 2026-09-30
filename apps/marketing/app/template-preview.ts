/**
 * What a template's card draws (D106): a mocked-up homepage, in the
 * design's own palette and typefaces, built from its own layout.
 *
 * A catalog design's `layout` lists its homepage top to bottom in words
 * ("Minimal top bar: ...", "Split hero: ...", "Three-column pricing ...").
 * Each of the first few lines becomes a block of that kind, in that order,
 * so a card shows this design's page rather than one drawing recoloured.
 * The text in it is the design's own: its name, its goal as a headline,
 * and its layout's section names.
 *
 * Computed at build time (the /templates loader), so a card ships only
 * this, never the catalog.
 */

export type PreviewBlock =
  | { kind: 'nav'; links: string[] }
  | { kind: 'hero'; layout: 'centered' | 'split' | 'media' }
  | { kind: 'grid'; columns: 2 | 3 | 4; label: string }
  | { kind: 'bento'; label: string }
  | { kind: 'stats'; label: string }
  | { kind: 'quote'; label: string }
  | { kind: 'list'; label: string }
  | { kind: 'timeline'; label: string }
  | { kind: 'form'; label: string }
  | { kind: 'pricing'; label: string }
  | { kind: 'gallery'; label: string }
  | { kind: 'text'; label: string }
  | { kind: 'footer' };

export interface PreviewSpec {
  name: string;
  headline: string;
  sub: string;
  cta: string;
  /** An app whose layout puts its navigation in a side rail. */
  shell: 'page' | 'sidebar';
  blocks: PreviewBlock[];
  colors: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    muted: string;
    mutedForeground: string;
    primary: string;
    onPrimary: string;
    accent: string;
    border: string;
  };
  radius: string;
  /** CSS font-family values: the design's display and body faces. */
  display: string;
  body: string;
}

interface TemplateLike {
  name: string;
  summary: string;
  kind: 'site' | 'app';
  category: string;
  layout: readonly string[];
  buildPrompt: string;
  style: {
    tokens: {
      colors: Record<string, string>;
      radius?: Record<string, string> | string;
    };
    typeSet: readonly { family: string; role: string }[];
  };
}

const has = (line: string, ...words: string[]) =>
  words.some((w) => new RegExp(`\\b${w}`, 'i').test(line));

/**
 * What a site of this kind would call a section of this sort. The layout's
 * own words describe the drawing ("Three numbered steps with icons"), not
 * what a visitor reads, so a card names its sections the way the site would.
 */
const SECTION_NAMES: Record<string, Record<string, string>> = {
  grid: {
    shop: 'Shop the range',
    food: 'On the menu',
    work: 'Selected work',
    app: 'Features',
    site: 'What we do',
  },
  bento: { app: 'At a glance', site: 'Highlights' },
  list: { news: 'Latest stories', app: 'Activity', site: 'Latest' },
  timeline: { site: 'How it works' },
  form: { food: 'Book a table', app: 'Try it now', site: 'Get in touch' },
  pricing: { site: 'Pricing' },
  gallery: { work: 'Selected work', shop: 'Lookbook', site: 'Gallery' },
  text: { work: 'About', app: 'Why it exists', site: 'Our story' },
  stats: { site: 'By the numbers' },
  quote: { app: 'Customers', site: 'Kind words' },
};

function flavourOf(category: string, kind: 'site' | 'app'): string {
  if (/ecommerce|shop|store/i.test(category)) return 'shop';
  if (/restaurant|food|cafe|bakery/i.test(category)) return 'food';
  if (/portfolio|resume|music|photograph|agency/i.test(category)) return 'work';
  if (/blog|editorial|news|magazine/i.test(category)) return 'news';
  return kind;
}

function sectionName(block: string, flavour: string, kind: 'site' | 'app') {
  const names = SECTION_NAMES[block] ?? {};
  return names[flavour] ?? names[kind] ?? names.site ?? 'More';
}

/** Named by `previewSpec`, which knows what kind of site it is. */
function labelOf(_line: string): string {
  return '';
}

/** What one layout line draws as, or null when it is not a page block. */
export function blockFor(line: string): PreviewBlock | null {
  const label = labelOf(line);
  if (has(line, 'header', 'nav', 'top bar', 'topbar', 'menu bar', 'masthead'))
    return { kind: 'nav', links: [] };
  if (has(line, 'footer')) return { kind: 'footer' };
  if (has(line, 'hero', 'splash', 'cover', 'landing view', 'launcher')) {
    if (
      has(
        line,
        'full-bleed',
        'full bleed',
        'video',
        'photo',
        'image background',
        'background image',
      )
    )
      return { kind: 'hero', layout: 'media' };
    if (
      has(
        line,
        'split',
        'left half',
        'two-column',
        'two column',
        'right half',
        'beside',
        'side-by-side',
      )
    )
      return { kind: 'hero', layout: 'split' };
    return { kind: 'hero', layout: 'centered' };
  }
  if (has(line, 'pricing', 'plans', 'tiers', 'purchase'))
    return { kind: 'pricing', label };
  if (has(line, 'testimonial', 'quote', 'review'))
    return { kind: 'quote', label };
  if (has(line, 'stat', 'metric', 'numbers', 'kpi', 'figures'))
    return { kind: 'stats', label };
  if (
    has(
      line,
      'timeline',
      'steps',
      'step ',
      'how it works',
      'process',
      'stepper',
    )
  )
    return { kind: 'timeline', label };
  if (has(line, 'bento', 'tiles', 'mosaic')) return { kind: 'bento', label };
  if (has(line, 'gallery', 'portfolio', 'photos', 'lookbook', 'masonry'))
    return { kind: 'gallery', label };
  if (
    has(
      line,
      'form',
      'calculator',
      'estimator',
      'booking',
      'sign-up',
      'signup',
      'newsletter',
      'input',
      'editor',
      'wizard',
    )
  )
    return { kind: 'form', label };
  if (
    has(line, 'table', 'list', 'rows', 'feed', 'inbox', 'queue', 'log', 'menu')
  )
    return { kind: 'list', label };
  if (has(line, 'grid', 'cards', 'columns', 'features', 'card'))
    return {
      kind: 'grid',
      columns: has(line, 'four', '4-column', '4 column')
        ? 4
        : has(line, 'two', '2-column', '2 column')
          ? 2
          : 3,
      label,
    };
  return { kind: 'text', label };
}

/** The design's own one-line pitch, from its build prompt's goal. */
export function headlineFor(
  t: Pick<TemplateLike, 'name' | 'summary' | 'buildPrompt'>,
): string {
  const goal = t.buildPrompt.split('### Goal')[1]?.trim() ?? '';
  const match =
    /\*\*[^*]+\*\*,? (?:a |an |the )?([^.;:]+?)(?:\.|;|:| for | that | with | where | whose |$)/.exec(
      goal,
    );
  const phrase = (match?.[1] ?? t.summary).trim();
  const words = phrase.split(/\s+/);
  const short = words.length > 7 ? words.slice(0, 7).join(' ') : phrase;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

const CTA_BY_CATEGORY: [RegExp, string][] = [
  [/restaurant|food|cafe|bakery|bar/i, 'Reserve a table'],
  [/event|conference|festival|wedding/i, 'Get tickets'],
  [/portfolio|resume|music|photograph/i, 'View work'],
  [/ecommerce|shop|store/i, 'Shop now'],
  [/services|agency|clinic|health|legal/i, 'Book a call'],
  [/blog|editorial|news|magazine/i, 'Read the latest'],
  [/landing|saas|tools|app/i, 'Start free'],
];

export function ctaFor(category: string, kind: 'site' | 'app'): string {
  for (const [pattern, label] of CTA_BY_CATEGORY) {
    if (pattern.test(category)) return label;
  }
  return kind === 'app' ? 'Open app' : 'Get started';
}

/** A CSS font-family for a face: its self-hosted name, then a generic. */
export function fontStack(family: string, generic: string): string {
  return `"tf-${family}", ${generic}`;
}

export function previewSpec(
  t: TemplateLike,
  genericOf: (family: string) => string,
): PreviewSpec {
  const lines = t.layout.slice(0, 7);
  const blocks: PreviewBlock[] = [];
  for (const line of lines) {
    const block = blockFor(line);
    if (!block) continue;
    // One nav and one hero: a second is a detail page, not the homepage.
    if (block.kind === 'nav' && blocks.some((b) => b.kind === 'nav')) continue;
    if (block.kind === 'hero' && blocks.some((b) => b.kind === 'hero'))
      continue;
    blocks.push(block);
  }
  // A homepage opens with its nav and then its hero, whatever order the
  // layout lists them in.
  const nav = (blocks.find((b) => b.kind === 'nav') ?? {
    kind: 'nav',
    links: [],
  }) as Extract<PreviewBlock, { kind: 'nav' }>;
  const hero: PreviewBlock = blocks.find((b) => b.kind === 'hero') ?? {
    kind: 'hero',
    layout: 'centered',
  };
  // One section of each kind: a second "Features" reads as a mistake.
  const rest = blocks.filter(
    (b, i) =>
      b.kind !== 'nav' &&
      b.kind !== 'hero' &&
      blocks.findIndex((other) => other.kind === b.kind) === i,
  );
  blocks.splice(0, blocks.length, nav, hero, ...rest);
  const flavour = flavourOf(t.category, t.kind);
  for (const block of blocks) {
    if ('label' in block)
      block.label = sectionName(block.kind, flavour, t.kind);
  }
  const sections = rest
    .filter((b): b is Extract<PreviewBlock, { label: string }> => 'label' in b)
    .map((b) => b.label);
  nav.links = [...new Set(sections)].slice(0, 3);
  const fills =
    t.kind === 'app'
      ? ['Pricing', 'Docs', 'Sign in']
      : ['About', 'Contact', 'Journal'];
  for (const fill of fills) {
    if (nav.links.length >= 3) break;
    if (!nav.links.includes(fill)) nav.links.push(fill);
  }

  const c = t.style.tokens.colors;
  const pick = (...keys: string[]) =>
    keys.map((k) => c[k]).find((v): v is string => typeof v === 'string') ??
    '#888888';
  const display = t.style.typeSet.find((f) => f.role === 'display')?.family;
  const body =
    t.style.typeSet.find((f) => f.role === 'body')?.family ?? display;
  const radius = t.style.tokens.radius;
  const radiusValue =
    typeof radius === 'string'
      ? radius
      : (radius?.md ?? radius?.base ?? radius?.lg ?? '10px');
  return {
    name: t.name,
    headline: headlineFor(t),
    sub: t.summary,
    cta: ctaFor(t.category, t.kind),
    shell:
      t.kind === 'app' &&
      lines
        .slice(0, 3)
        .some((l) =>
          has(l, 'sidebar', 'side rail', 'left rail', 'left nav', 'rail'),
        )
        ? 'sidebar'
        : 'page',
    blocks: blocks.slice(0, 6),
    colors: {
      background: pick('background'),
      foreground: pick('foreground'),
      card: pick('card', 'background'),
      cardForeground: pick('cardForeground', 'foreground'),
      muted: pick('muted', 'card'),
      mutedForeground: pick('mutedForeground', 'foreground'),
      primary: pick('primary'),
      onPrimary: pick('onPrimary', 'background'),
      accent: pick('accent', 'primary'),
      border: pick('border', 'muted'),
    },
    radius: radiusValue,
    display: display
      ? fontStack(display, genericOf(display))
      : 'system-ui, sans-serif',
    body: body ? fontStack(body, genericOf(body)) : 'system-ui, sans-serif',
  };
}
