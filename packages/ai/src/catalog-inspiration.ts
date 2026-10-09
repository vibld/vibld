/**
 * The template catalog as inspiration for a typed request.
 *
 * The catalog holds several hundred original designs, eight of them wedding
 * sites alone, but until now a build saw one only when somebody picked it by
 * hand. A typed "a wedding website for Chris and Jordan" got none of them,
 * and the design-quality review of 2026-10-09 found builds reading as dated
 * for want of exactly this: a considered art direction for the subject.
 *
 * So the closest few designs are retrieved by what the request says and
 * passed as directions to choose from. Matching runs on the light index
 * (`design-template-index.ts`), which is all the Worker carries; the
 * directions themselves are a few hundred characters each, read from the
 * catalog by the caller (the command line imports it, the Worker reads the
 * file `apps/web/scripts/template-assets.ts` writes for each design).
 */
import type { DesignTemplateName } from './design-template-index.ts';
import type { DesignTemplate } from './design-templates.ts';

/** How many directions a request is offered. */
export const INSPIRATION_LIMIT = 3;

/** What a build is told about one catalog design. */
export interface CatalogInspiration {
  id: string;
  name: string;
  summary: string;
  mood: string;
  imagery: string;
  spacing: string;
  layout: readonly string[];
  interactions: readonly string[];
  type: readonly { family: string; role: string; use: string }[];
  typeWhy: string;
  palette: readonly { role: string; hex: string }[];
}

export const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'our',
  'your',
  'their',
  'that',
  'this',
  'from',
  'into',
  'about',
  'some',
  'make',
  'build',
  'create',
  'want',
  'need',
  'like',
  'page',
  'pages',
  'site',
  'website',
  'web',
  'app',
  'section',
  'form',
  'link',
  'links',
  'one',
  'two',
  'three',
  'all',
  'get',
  'getting',
  'has',
  'have',
  'are',
  'will',
  'can',
  'use',
  'new',
  'more',
  'style',
  'general',
]);

/**
 * Words that say what form or finish a page takes, not what it is about. They
 * add to a design's score but never qualify one on their own: "a landing
 * page" names no subject, and every design whose summary says "landing" would
 * otherwise tie for it.
 */
export const FORM_WORDS = new Set([
  'landing',
  'dashboard',
  'homepage',
  'home',
  'starter',
  'hero',
  'marketing',
  'showcase',
  'pager',
  'single',
  'template',
  'design',
  'layout',
  'dark',
  'light',
  'minimal',
  'modern',
  'clean',
  'simple',
  'bold',
]);

/**
 * Generic words that are no subject on their own, in a label ("tools") or a
 * summary ("sticky tool list", "small-group"). A compound label still needs
 * them named: "small business", "business tools".
 */
const LABEL_FILLER = new Set([
  'product',
  'tool',
  'general',
  'platform',
  'service',
  'solution',
  'system',
  'hub',
  'online',
  'digital',
  'work',
  'business',
  'small',
]);

/**
 * Words that name a whole catalog label on their own: "a CRM" is
 * "crm-sales" and so is "a sales app", "an HR tool" is "hr-people". ("saa"
 * and "sale" are "SaaS" and "sales", plurals folded.)
 */
const DOMAIN_TERMS = new Set(['ai', 'crm', 'hr', 'saa', 'sale', 'internal']);

/**
 * How closely the request names a catalog label: 0 not at all; 1 a broad
 * one-word label ("events", "music"); 2 a specific one, by a domain term in
 * it or by every word of a compound ("small business", "business tools").
 * "small" alone is not "small-business", nor "business" "business-tools", and
 * a label that is only form or one generic noun ("landing-page", "tools") is
 * never named.
 */
function namesLabel(asked: Set<string>, label: string): 0 | 1 | 2 {
  const words = [...contentWords(label)].filter(
    (word) => !FORM_WORDS.has(word),
  );
  if (words.length === 0) return 0;
  if (words.length === 1 && LABEL_FILLER.has(words[0]!)) return 0;
  if (words.some((word) => DOMAIN_TERMS.has(word) && asked.has(word))) {
    return 2;
  }
  if (!words.every((word) => asked.has(word))) return 0;
  return words.length > 1 ? 2 : 1;
}

/** A person's trade and its craft are one subject: "photographer", "photography". */
const SAME_SUBJECT: Record<string, string> = {
  photographer: 'photography',
  photograph: 'photography',
  baker: 'bakery',
  architect: 'architecture',
  florist: 'floral',
  flower: 'floral',
  musician: 'music',
  writer: 'writing',
  author: 'writing',
  filmmaker: 'film',
};

/** Words under three letters that still name a subject ("an AI tool"). */
const SHORT_WORDS = new Set(['ai', 'ar', 'vr', '3d', 'hr', 'tv', 'dj', 'pr']);

/**
 * Lowercase content words, plurals folded, the request's or a design's. A
 * hyphen splits words, so a catalog label like "small-business" meets
 * "small business".
 */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (SHORT_WORDS.has(raw)) {
      words.add(raw);
      continue;
    }
    if (raw.length < 3 || !/^[a-z]/.test(raw) || STOP_WORDS.has(raw)) continue;
    const word =
      raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    words.add(SAME_SUBJECT[word] ?? word);
  }
  return words;
}

/** A stable number for a request, to rotate among equally good matches. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/**
 * Whether a message is, or holds, a catalog design's brief: the catalog's
 * own preamble, or a build prompt pasted from a template page, which has the
 * catalog's Goal, Design system and Guardrails sections. A person's own
 * "### Goal" heading is not one.
 */
function carriesDesignBrief(prompt: string): boolean {
  if (/^### How to use these prompts$/m.test(prompt)) return true;
  return ['Goal', 'Design system', 'Guardrails'].every((section) =>
    new RegExp(`^### ${section}\\s*$`, 'm').test(prompt),
  );
}

/**
 * The ids of the designs closest to this request, best first, or none.
 *
 * A design scores for each word of the request its one-line summary holds
 * (3), its category or use case holds (2), or its name holds (1). It is
 * offered only when the request names its subject: all of its category or
 * use case, two words of its summary, one subject word of its summary with
 * the form it names ("event" and "dashboard" for "Event-based usage insights
 * dashboard"), or the one subject word of a short summary ("Editorial wedding
 * website"). One word out of a longer summary is a coincidence ("real
 * estate" is not "Real-time collaborative notes"), a name is not a subject,
 * and a page's form ("landing", "dashboard") never counts on its own. Only
 * whole designs on their own count: a screen pattern is a part of a product,
 * and a design merged into another is shown there.
 *
 * Between designs that score the same, the one whose summary says less
 * that the request did not ask for comes first: "Editorial wedding website"
 * before "Horizontal-scroll wedding photography site" for a couple's site.
 * Designs still level are taken in an order the request decides, so two
 * couples asking for a wedding site are not both handed the same three, and
 * the same request is always handed the same ones.
 */
export function matchCatalogDesigns(
  prompt: string,
  index: readonly DesignTemplateName[],
  limit = INSPIRATION_LIMIT,
): string[] {
  // A message that already carries a design's brief (the Templates option,
  // D106, D148) has its direction; a second set would compete with it.
  if (carriesDesignBrief(prompt)) return [];
  const asked = contentWords(prompt);
  if (asked.size === 0) return [];
  const scored: { id: string; score: number; extra: number; tie: number }[] =
    [];
  for (const design of index) {
    if (design.format !== 'design' || design.mergedInto) continue;
    const summary = contentWords(design.summary);
    const kind = contentWords(`${design.category} ${design.useCase}`);
    const name = contentWords(design.name);
    const named = Math.max(
      namesLabel(asked, design.category),
      namesLabel(asked, design.useCase),
    );
    const kindHit = named > 0;
    // Naming a design's specific category ("CRM") outranks one word of
    // another design's summary ("Workshop sales landing page").
    let score = named === 2 ? 3 : 0;
    let summaryHits = 0;
    let formHits = 0;
    for (const word of asked) {
      const points = summary.has(word)
        ? 3
        : kind.has(word)
          ? 2
          : name.has(word)
            ? 1
            : 0;
      score += points;
      if (!summary.has(word)) continue;
      if (FORM_WORDS.has(word)) formHits += 1;
      else if (!LABEL_FILLER.has(word)) summaryHits += 1;
    }
    let summarySubject = 0;
    for (const word of summary) {
      if (!FORM_WORDS.has(word) && !LABEL_FILLER.has(word)) summarySubject += 1;
    }
    const qualifies =
      kindHit ||
      summaryHits >= 2 ||
      (summaryHits === 1 && (summarySubject <= 2 || formHits > 0));
    if (qualifies) {
      let extra = 0;
      for (const word of summary) if (!asked.has(word)) extra += 1;
      scored.push({
        id: design.id,
        score,
        extra,
        tie: hashOf(`${prompt}\n${design.id}`),
      });
    }
  }
  scored.sort(
    (a, b) => b.score - a.score || a.extra - b.extra || a.tie - b.tie,
  );
  return scored.slice(0, limit).map((entry) => entry.id);
}

/** The part of a catalog design a build is shown. */
export function inspirationOf(template: DesignTemplate): CatalogInspiration {
  const { style } = template;
  return {
    id: template.id,
    name: template.name,
    summary: template.summary,
    mood: style.mood,
    imagery: style.imagery,
    spacing: style.spacing,
    layout: template.layout.slice(0, 6),
    interactions: template.interactions.slice(0, 4),
    type: style.typeSet.map(({ family, role, use }) => ({ family, role, use })),
    typeWhy: style.typeWhy,
    palette: style.palette.map(({ role, hex }) => ({ role, hex })),
  };
}

function direction(entry: CatalogInspiration, position: number): string {
  const lines = [
    `${position}. ${entry.name}: ${entry.summary}`,
    `Mood: ${entry.mood}`,
    `Imagery: ${entry.imagery}`,
    `Spacing: ${entry.spacing}`,
    `Type: ${entry.type
      .map((face) => `${face.family} (${face.role}: ${face.use})`)
      .join('; ')}. ${entry.typeWhy}`,
    `Palette: ${entry.palette
      .map((swatch) => `${swatch.role} ${swatch.hex}`)
      .join(', ')}`,
    `Layout: ${entry.layout.join('; ')}`,
  ];
  if (entry.interactions.length > 0) {
    lines.push(`Interactions: ${entry.interactions.join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * The section a request is given when designs in the catalog match it, or
 * null when none do.
 *
 * Directions to choose from rather than one to follow, because the request
 * knows its subject better than a keyword match does, and an art direction
 * the model chose is one it commits to. The names and sample content stay
 * in the catalog: the brand, the people and the facts are the request's.
 */
export function catalogInspirationGuidance(
  entries: readonly CatalogInspiration[],
): string | null {
  if (entries.length === 0) return null;
  return `ART DIRECTION FROM THE TEMPLATE CATALOG
These original designs from vibld's catalog are the closest to this request. Choose the one that suits it best as the art direction for this build and commit to it: its mood, type pairing, palette, spacing and layout ideas, adapted to what the request asks for. Use its palette and typefaces for the spec's tokens unless the request names its own. Do not copy a design's name or sample content; the brand, the people and the facts are the request's. Where anything here conflicts with the request above, follow the request.

${entries.map((entry, index) => direction(entry, index + 1)).join('\n\n')}`;
}
