/**
 * The palettes a person can choose from, as seeds.
 *
 * Everything here is a hue, a saturation, a mode and a scheme. The fifteen
 * tokens each one becomes are solved by `palette-derive.ts`, which is what
 * makes a library this size safe to ship: the taste lives in these lines and
 * the correctness lives in the solver, so adding an entry cannot introduce an
 * unreadable pair. `palette-library.test.ts` derives every one and walks
 * every required pair.
 *
 * Where these came from: the hues are chosen here, and the relationships
 * between them are ordinary colour theory (analogous, complementary, split
 * complementary, triadic). No third-party palette set is reproduced,
 * bundled or redistributed, so nothing in this file depends on anyone else's
 * terms. Whether to also draw on a commercial palette library is a decision
 * for the project owner, not one this file quietly makes.
 *
 * The scheme is picked per hue rather than applied uniformly, because the
 * same rotation flatters some hues and not others: split complementary off a
 * lime lands on magenta, which is a real relationship and a loud one. Choosing
 * it deliberately per entry is the difference between a library and a sweep.
 */

import { derivePalette } from './palette-derive.ts';
import type { DerivedPalette, PaletteSeed } from './palette-derive.ts';

/** A seed plus the words that make it a sensible default for a request. */
interface LibrarySeed extends PaletteSeed {
  /** Lowercase words matched against the request text. Optional. */
  triggers?: readonly string[];
}

const SEEDS: readonly LibrarySeed[] = [
  // --- warm reds and oranges ---------------------------------------------
  {
    id: 'ember-dark',
    name: 'Ember',
    hue: 22,
    saturation: 88,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Near-black warmed with orange. Developer tools, terminals, anything that should feel lit from within.',
    triggers: ['developer tool', 'terminal', 'cli', 'devtool'],
  },
  {
    id: 'ember-light',
    name: 'Ember Day',
    hue: 22,
    saturation: 84,
    mode: 'light',
    scheme: 'analogous',
    note: 'The same orange on warm paper. Confident without going dark.',
  },
  {
    id: 'clay',
    name: 'Clay',
    hue: 14,
    saturation: 52,
    mode: 'light',
    scheme: 'analogous',
    note: 'Terracotta and sand. Craft, food, physical products.',
    triggers: ['pottery', 'ceramic', 'craft', 'artisan', 'bakery'],
  },
  {
    id: 'brick',
    name: 'Brick',
    hue: 8,
    saturation: 62,
    mode: 'dark',
    scheme: 'split',
    note: 'Deep red-brown with a cool counterweight. Bold and a little severe.',
  },
  {
    id: 'coral',
    name: 'Coral',
    hue: 6,
    saturation: 78,
    mode: 'light',
    scheme: 'triadic',
    note: 'Bright coral with two supporting hues. Consumer apps, something friendly.',
    triggers: ['social', 'community', 'consumer app'],
  },
  {
    id: 'rust',
    name: 'Rust',
    hue: 18,
    saturation: 66,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Oxidised orange on charcoal. Industrial, hardware, logistics.',
    triggers: ['logistics', 'manufacturing', 'hardware', 'industrial'],
  },

  // --- ambers and golds ---------------------------------------------------
  {
    id: 'amber',
    name: 'Amber',
    hue: 38,
    saturation: 90,
    mode: 'dark',
    scheme: 'complementary',
    note: 'Gold against deep blue-black. Finance, trading, dashboards after dark.',
    triggers: ['trading', 'finance dashboard', 'crypto'],
  },
  {
    id: 'honey',
    name: 'Honey',
    hue: 42,
    saturation: 74,
    mode: 'light',
    scheme: 'analogous',
    note: 'Warm gold on cream. Hospitality, food, anything welcoming.',
    triggers: ['restaurant', 'cafe', 'coffee', 'hotel', 'hospitality'],
  },
  {
    id: 'brass',
    name: 'Brass',
    hue: 46,
    saturation: 44,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Muted metal on near-black. Understated luxury.',
    triggers: ['luxury', 'jewellery', 'watch'],
  },
  {
    id: 'wheat',
    name: 'Wheat',
    hue: 50,
    saturation: 38,
    mode: 'light',
    scheme: 'complementary',
    note: 'Pale gold with a blue counterpoint. Editorial, long reading.',
    triggers: ['magazine', 'editorial', 'essay', 'newsletter'],
  },

  // --- limes and greens ---------------------------------------------------
  {
    id: 'lime',
    name: 'Lime',
    hue: 74,
    saturation: 88,
    mode: 'light',
    scheme: 'analogous',
    note: 'Acid green on off-white. Loud, young, hard to ignore.',
    triggers: ['energy drink', 'esports', 'streetwear'],
  },
  {
    id: 'lime-dark',
    name: 'Lime After Dark',
    hue: 74,
    saturation: 90,
    mode: 'dark',
    scheme: 'analogous',
    note: 'The same acid green as a signal colour on black.',
  },
  {
    id: 'moss',
    name: 'Moss',
    hue: 96,
    saturation: 40,
    mode: 'light',
    scheme: 'analogous',
    note: 'Soft olive. Gardening, sustainability, slow products.',
    triggers: ['garden', 'plant', 'sustainab', 'organic'],
  },
  {
    id: 'fern',
    name: 'Fern',
    hue: 132,
    saturation: 48,
    mode: 'light',
    scheme: 'analogous',
    note: 'Fresh green on pale ground. Health, wellbeing, food.',
    triggers: ['wellness', 'nutrition', 'fitness', 'health'],
  },
  {
    id: 'forest',
    name: 'Forest',
    hue: 152,
    saturation: 54,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Deep green, low light. Outdoors, conservation, maps.',
    triggers: ['outdoor', 'hiking', 'conservation', 'map'],
  },
  {
    id: 'mint',
    name: 'Mint',
    hue: 162,
    saturation: 62,
    mode: 'light',
    scheme: 'complementary',
    note: 'Cool mint with a warm counterweight. Clean, clinical, calm.',
    triggers: ['clinic', 'dental', 'medical', 'pharmacy'],
  },
  {
    id: 'jade',
    name: 'Jade',
    hue: 168,
    saturation: 70,
    mode: 'dark',
    scheme: 'split',
    note: 'Saturated green-teal on charcoal. Fintech that does not want to be blue.',
  },

  // --- teals and cyans ----------------------------------------------------
  {
    id: 'teal',
    name: 'Teal',
    hue: 184,
    saturation: 66,
    mode: 'light',
    scheme: 'complementary',
    note: 'Blue-green with a warm accent. The safe professional choice done properly.',
    triggers: ['saas', 'b2b', 'platform'],
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    hue: 192,
    saturation: 78,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Bright cyan on deep blue-black. Data, telemetry, monitoring.',
    triggers: ['analytics', 'monitoring', 'telemetry', 'observability'],
  },
  {
    id: 'glacier',
    name: 'Glacier',
    hue: 198,
    saturation: 34,
    mode: 'light',
    scheme: 'analogous',
    note: 'Pale ice blue. Quiet, spacious, unhurried.',
    triggers: ['meditation', 'sleep', 'calm', 'spa'],
  },

  // --- blues --------------------------------------------------------------
  {
    id: 'harbour',
    name: 'Harbour',
    hue: 212,
    saturation: 62,
    mode: 'light',
    scheme: 'complementary',
    note: 'Working blue with an amber accent. Business software that has to be trusted.',
    triggers: ['insurance', 'bank', 'accounting', 'enterprise'],
  },
  {
    id: 'slate-blue',
    name: 'Slate',
    hue: 214,
    saturation: 28,
    mode: 'light',
    scheme: 'triadic',
    note: 'Desaturated blue-grey. Recedes, so the content carries the page.',
    triggers: ['documentation', 'docs', 'knowledge base', 'wiki'],
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    hue: 224,
    saturation: 84,
    mode: 'light',
    scheme: 'complementary',
    note: 'Strong blue, orange counterweight. Direct and energetic.',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    hue: 228,
    saturation: 58,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Deep navy. Security, infrastructure, things that run at night.',
    triggers: ['security', 'infrastructure', 'devops', 'cloud'],
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    hue: 234,
    saturation: 76,
    mode: 'dark',
    scheme: 'split',
    note: 'Rich blue with two supporting hues pulled apart.',
  },

  // --- indigos and violets ------------------------------------------------
  {
    id: 'indigo',
    name: 'Indigo',
    hue: 250,
    saturation: 76,
    mode: 'light',
    scheme: 'complementary',
    note: 'Violet-blue against gold. Creative tools, design software.',
    triggers: ['design tool', 'creative', 'studio', 'portfolio'],
  },
  {
    id: 'indigo-dark',
    name: 'Indigo Night',
    hue: 250,
    saturation: 72,
    mode: 'dark',
    scheme: 'complementary',
    note: 'The same pairing with the lights off.',
  },
  {
    id: 'iris',
    name: 'Iris',
    hue: 266,
    saturation: 64,
    mode: 'light',
    scheme: 'analogous',
    note: 'Soft violet. Education, learning, children.',
    triggers: ['education', 'course', 'learning', 'school', 'tutor'],
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    hue: 278,
    saturation: 58,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Purple on near-black. Music, nightlife, entertainment.',
    triggers: ['music', 'podcast', 'nightlife', 'streaming'],
  },
  {
    id: 'orchid',
    name: 'Orchid',
    hue: 292,
    saturation: 62,
    mode: 'light',
    scheme: 'triadic',
    note: 'Magenta-violet with two companions. Playful without being childish.',
  },

  // --- pinks --------------------------------------------------------------
  {
    id: 'fuchsia',
    name: 'Fuchsia',
    hue: 322,
    saturation: 78,
    mode: 'dark',
    scheme: 'split',
    note: 'Hot pink on black. Fashion, events, anything that wants to be looked at.',
    triggers: ['fashion', 'event', 'festival', 'nightclub'],
  },
  {
    id: 'blush',
    name: 'Blush',
    hue: 340,
    saturation: 52,
    mode: 'light',
    scheme: 'analogous',
    note: 'Soft pink on warm white. Beauty, care, gentle products.',
    triggers: ['beauty', 'skincare', 'salon', 'wedding'],
  },
  {
    id: 'ruby',
    name: 'Ruby',
    hue: 350,
    saturation: 72,
    mode: 'light',
    scheme: 'complementary',
    note: 'Deep pink-red with a green counterweight. Confident retail.',
    triggers: ['ecommerce', 'shop', 'retail', 'store'],
  },

  // --- near-neutrals ------------------------------------------------------
  {
    id: 'graphite',
    name: 'Graphite',
    hue: 220,
    saturation: 10,
    mode: 'dark',
    scheme: 'analogous',
    note: 'Almost no colour at all. Lets photography or code be the only colour on the page.',
    triggers: ['photography', 'gallery', 'archive'],
  },
  {
    id: 'paper',
    name: 'Paper',
    hue: 40,
    saturation: 16,
    mode: 'light',
    scheme: 'complementary',
    note: 'Warm off-white, minimal colour. Reading first, everything else second.',
    triggers: ['blog', 'writing', 'book', 'journal'],
  },
  {
    id: 'concrete',
    name: 'Concrete',
    hue: 205,
    saturation: 8,
    mode: 'light',
    scheme: 'triadic',
    note: 'Cool grey with three restrained accents. Architectural, precise.',
    triggers: ['architect', 'construction', 'engineering'],
  },
];

/**
 * Every library palette, solved.
 *
 * Derived once at module load rather than written out as data. The arithmetic
 * is a few hundred floating-point operations for the whole set, which is
 * nothing next to keeping fifteen hand-written hex values per entry honest,
 * and it means the seeds above are the only thing anyone has to edit.
 */
export const PALETTE_LIBRARY: readonly DerivedPalette[] = SEEDS.map((seed) => {
  const derived = derivePalette(seed);
  if (!derived) {
    // Unreachable while the test suite passes, and thrown rather than
    // skipped so that if it ever is reached the seed is fixed instead of
    // silently vanishing from the chooser.
    throw new Error(`palette seed "${seed.id}" does not derive`);
  }
  return derived;
});

const BY_ID = new Map(PALETTE_LIBRARY.map((palette) => [palette.id, palette]));

/**
 * A trigger matched on word boundaries rather than as a bare substring.
 *
 * `includes` is what the older catalogue in `palettes.ts` uses, and it is
 * wrong in a way that is invisible until it bites: the first version of this
 * file gave "a dental clinic booking site" the Ember palette, because Ember
 * lists "cli" and "clinic" contains it. A wrong palette is not an error
 * anyone sees, it is just the wrong colours, so the matching rule has to be
 * right rather than carefully worded around.
 *
 * Boundaries on both ends, which means a trigger matches the word and not
 * the words that merely contain it. Variants that should match are listed as
 * their own triggers, so what matches is readable in the seed rather than
 * inferred from a regex.
 */
const TRIGGER_PATTERNS = new Map<string, RegExp>();
function triggerMatches(trigger: string, haystack: string): boolean {
  let pattern = TRIGGER_PATTERNS.get(trigger);
  if (!pattern) {
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    TRIGGER_PATTERNS.set(trigger, pattern);
  }
  return pattern.test(haystack);
}

/** The palette with this id, or null. Ids come from the chooser. */
export function findLibraryPalette(id: string): DerivedPalette | null {
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
}

/** The seeds' own trigger words, for keyword matching against a request. */
export function matchLibraryPalette(promptText: string): DerivedPalette | null {
  for (const seed of SEEDS) {
    if (seed.triggers?.some((trigger) => triggerMatches(trigger, promptText))) {
      return findLibraryPalette(seed.id);
    }
  }
  return null;
}

/** Just enough of each palette to draw a chooser, without its internals. */
export function paletteSummaries(): {
  id: string;
  name: string;
  note: string;
  mode: string;
  swatches: string[];
}[] {
  return PALETTE_LIBRARY.map((palette) => ({
    id: palette.id,
    name: palette.name,
    note: palette.note,
    mode: palette.mode,
    swatches: [
      palette.colors.background,
      palette.colors.primary,
      palette.colors.secondary,
      palette.colors.accent,
      palette.colors.foreground,
    ],
  }));
}
