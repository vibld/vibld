/**
 * Every card the /templates gallery lists (D106, D161, D162), built once
 * per process: each category and subcategory page asks for it, as does its
 * `.data` and each style-cards file (app/style-cards.ts). Server-only: the
 * catalog is megabytes.
 */
import {
  styleSubcategory,
  templateGroup,
  templateSubcategories,
} from '@vibld/ai/design-categories';

import type { TemplateCard, TypeStyle } from './routes/templates';
import { STYLE_BATCH, STYLE_CARD_CHUNK } from './style-cards';

const TYPE_STYLE: Record<string, TypeStyle> = {
  serif: 'serif',
  'sans-serif': 'sans',
  monospace: 'mono',
  display: 'display',
  handwriting: 'script',
};

const GENERIC: Record<TypeStyle, string> = {
  serif: 'Georgia, serif',
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
  display: 'system-ui, sans-serif',
  script: 'cursive',
};

/** WCAG relative luminance of a hex colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function templateCatalog() {
  return (catalog ??= readCatalog());
}

let catalog: ReturnType<typeof readCatalog> | undefined;

async function readCatalog() {
  const {
    listedDesignTemplates,
    DESIGN_TEMPLATES,
    DESIGN_BATCHES,
    SCREEN_TYPES,
  } = await import('@vibld/ai/design-templates');
  const { TEMPLATE_FONTS } = await import('./template-fonts.gen');
  const { previewSpec, fontStack } = await import('./template-preview');
  const styleOf = (family: string): TypeStyle =>
    TYPE_STYLE[TEMPLATE_FONTS[family]?.category ?? ''] ?? 'sans';
  const genericOf = (family: string) => GENERIC[styleOf(family)];
  const cards = listedDesignTemplates().map((t, order): TemplateCard => {
    const display =
      t.style.typeSet.find((f) => f.role === 'display')?.family ??
      t.style.tokens.typography.headingFont;
    const roles = new Map<string, string[]>();
    for (const f of t.style.typeSet) {
      roles.set(f.family, [...(roles.get(f.family) ?? []), f.role]);
    }
    return {
      id: t.id,
      href: `/templates/${t.id}`,
      name: t.name,
      summary: t.summary,
      kind: t.kind,
      group: templateGroup(t),
      subcategories: templateSubcategories(t).map((sub) => sub.slug),
      category: t.category,
      complexity: t.complexity,
      format: t.format,
      batch: t.batch,
      screenTypes: [...(t.screenTypes ?? [])],
      addedOn: t.addedOn,
      order,
      tone:
        luminance(t.style.tokens.colors.background) < 0.2 ? 'dark' : 'light',
      typeStyle: styleOf(display),
      faces: [...roles].map(([family, played]) => ({
        family,
        roles: played,
        css: fontStack(family, genericOf(family)),
      })),
      preview: previewSpec(t, genericOf),
    };
  });
  // The style gallery's entries, each a website under the subcategory its
  // industry names, after the designs (D162). Their pages stay in the
  // gallery.
  const { styleGalleryCatalog } = await import('./style-gallery.server');
  const { styleTemplate } = await import('./template-preview');
  for (const [i, entry] of styleGalleryCatalog().entries.entries()) {
    // The prerender's preview server runs on this thread: drawing every
    // preview in one go held it long enough for a page request's
    // connection to time out in CI, so it gets a turn every 50 cards.
    if (i % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
    const sub = styleSubcategory(entry.group);
    if (!sub) continue;
    const { display, body } = entry.design_tokens.fonts;
    const families = display === body ? [display] : [display, body];
    cards.push({
      id: entry.id,
      href: `/styles/gallery/${entry.id}`,
      name: entry.name,
      summary: entry.kind,
      kind: 'site',
      group: 'websites',
      subcategories: [sub.slug],
      category: entry.group,
      complexity: entry.complexity,
      format: 'design',
      batch: STYLE_BATCH,
      screenTypes: [],
      // When the gallery was added to vibld (docs/decisions.md, D142).
      addedOn: '2026-10-02',
      order: cards.length,
      tone: entry.theme,
      visuals: Math.floor(i / STYLE_CARD_CHUNK),
      typeStyle: styleOf(display),
      faces: families.map((family) => ({
        family,
        roles:
          families.length === 1
            ? ['display', 'body']
            : [family === display ? 'display' : 'body'],
        css: fontStack(family, genericOf(family)),
      })),
      preview: previewSpec(styleTemplate(entry), genericOf),
    });
  }
  const nameOf = new Map(DESIGN_TEMPLATES.map((t) => [t.id, t.name]));
  const mergedOf = (collection: 'examples' | 'templates') =>
    DESIGN_TEMPLATES.filter((t) => t.mergedInto?.collection === collection).map(
      (t) => ({
        id: t.id,
        name: t.name,
        into: t.mergedInto!.slug,
        intoName: nameOf.get(t.mergedInto!.slug) ?? t.mergedInto!.slug,
      }),
    );
  // How many designs each category and subcategory holds, for the links
  // between them; the page itself carries only its own place's cards.
  const counts: Record<string, number> = {};
  for (const card of cards) {
    counts[card.group] = (counts[card.group] ?? 0) + 1;
    for (const sub of card.subcategories) {
      const key = `${card.group}/${sub}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return {
    counts,
    cards,
    merged: mergedOf('examples'),
    alternates: mergedOf('templates'),
    batches: [
      ...Object.entries(DESIGN_BATCHES).map(([id, b]) => [id, b.name]),
      [STYLE_BATCH, 'Style gallery'],
    ] as [string, string][],
    screenTypes: [...SCREEN_TYPES].sort(),
  };
}
