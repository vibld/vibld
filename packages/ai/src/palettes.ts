/**
 * Product-type colour palettes and font pairings (docs/decisions.md L50-L51,
 * the same "small, real catalogue... retrieved on demand" idea
 * `patterns.ts` already applies, extended from page structure to visual
 * defaults).
 *
 * Adapted from nextlevelbuilder/ui-ux-pro-max-skill (MIT License,
 * https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), which curates a
 * much larger set (192 product/palette combinations) via a local search
 * tool. That tool is Python and queried on demand at generation time --
 * neither fits this Worker (no Python runtime, no retrieval infrastructure
 * until #12/D13 exists). What is ported instead is a hand-picked subset of
 * the underlying values themselves -- real hex tokens and real Google Fonts
 * pairings, already vetted for contrast and pairing sense -- adapted to
 * Vibld's own closed-set, keyword-matched retrieval (`selectPalette` below)
 * and to its default stack: plain CSS custom properties and a
 * `@import`, not the source's Tailwind config strings.
 *
 * Same security shape as `style-presets.ts` and `patterns.ts`: the set is
 * closed, matched only against the request's own text, and nothing from a
 * caller crosses into a palette's actual values.
 */

export interface ProductPalette {
  id: string;
  name: string;
  /** Lowercase words/phrases matched against the request text. */
  triggers: readonly string[];
  /**
   * Semantic tokens (Primary/On Primary/Secondary/... — Material's naming),
   * not simply "brand colours": each pairing is already checked for
   * text-on-fill contrast, which is why they are given as pairs rather than
   * a flat swatch list a model would have to pair up itself.
   */
  colors: {
    primary: string;
    onPrimary: string;
    secondary: string;
    onSecondary: string;
    accent: string;
    onAccent: string;
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    muted: string;
    mutedForeground: string;
    border: string;
    destructive: string;
    onDestructive: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    /** A real, working Google Fonts stylesheet URL for exactly these two families. */
    googleFontsUrl: string;
  };
  /** One line on why this pairing, shown in the prompt so it reads as a default, not an accident. */
  rationale: string;
}

export const PRODUCT_PALETTES: readonly ProductPalette[] = [
  {
    id: 'saas',
    name: 'SaaS',
    triggers: ['saas', 'b2b software', 'cloud platform', 'software product'],
    colors: {
      primary: '#2563EB',
      onPrimary: '#FFFFFF',
      secondary: '#3B82F6',
      onSecondary: '#000000',
      accent: '#EA580C',
      onAccent: '#000000',
      background: '#F8FAFC',
      foreground: '#1E293B',
      card: '#FFFFFF',
      cardForeground: '#1E293B',
      muted: '#E9EFF8',
      mutedForeground: '#475569',
      border: '#E2E8F0',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Plus Jakarta Sans',
      bodyFont: 'Plus Jakarta Sans',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
    },
    rationale: 'Trust blue with an orange CTA for contrast against it.',
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    triggers: ['e-commerce', 'ecommerce', 'online store', 'shop', 'storefront'],
    colors: {
      primary: '#059669',
      onPrimary: '#000000',
      secondary: '#10B981',
      onSecondary: '#0F172A',
      accent: '#EA580C',
      onAccent: '#000000',
      background: '#ECFDF5',
      foreground: '#064E3B',
      card: '#FFFFFF',
      cardForeground: '#064E3B',
      muted: '#E8F1F3',
      mutedForeground: '#475569',
      border: '#A7F3D0',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Rubik',
      bodyFont: 'Nunito Sans',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&family=Rubik:wght@500;600;700&display=swap',
    },
    rationale:
      'Success green for trust, warm orange for urgency (sale/cart CTAs).',
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    triggers: ['portfolio', 'personal site', 'personal website'],
    colors: {
      primary: '#18181B',
      onPrimary: '#FFFFFF',
      secondary: '#3F3F46',
      onSecondary: '#FFFFFF',
      accent: '#2563EB',
      onAccent: '#FFFFFF',
      background: '#FAFAFA',
      foreground: '#09090B',
      card: '#FFFFFF',
      cardForeground: '#09090B',
      muted: '#E8ECF0',
      mutedForeground: '#475569',
      border: '#E4E4E7',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Space Grotesk',
      bodyFont: 'Archivo',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap',
    },
    rationale:
      'Near-monochrome so the work is the colour; one accent for links and CTAs.',
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    triggers: ['healthcare', 'health app', 'medical', 'clinic', 'telehealth'],
    colors: {
      primary: '#0891B2',
      onPrimary: '#000000',
      secondary: '#22D3EE',
      onSecondary: '#0F172A',
      accent: '#059669',
      onAccent: '#000000',
      background: '#ECFEFF',
      foreground: '#164E63',
      card: '#FFFFFF',
      cardForeground: '#164E63',
      muted: '#E8F1F6',
      mutedForeground: '#475569',
      border: '#A5F3FC',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Figtree',
      bodyFont: 'Noto Sans',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Figtree:wght@500;600;700&family=Noto+Sans:wght@400;500&display=swap',
    },
    rationale:
      'Calm cyan with a health-green accent. Accessibility is not optional for this product type -- re-check every pairing here against the DESIGN INTENT contrast rule, not just this file.',
  },
  {
    id: 'education',
    name: 'Education',
    triggers: [
      'educational app',
      'e-learning',
      'online course',
      'learning platform',
    ],
    colors: {
      primary: '#4F46E5',
      onPrimary: '#FFFFFF',
      secondary: '#818CF8',
      onSecondary: '#0F172A',
      accent: '#EA580C',
      onAccent: '#000000',
      background: '#EEF2FF',
      foreground: '#1E1B4B',
      card: '#FFFFFF',
      cardForeground: '#1E1B4B',
      muted: '#EBEEF8',
      mutedForeground: '#475569',
      border: '#C7D2FE',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Fredoka',
      bodyFont: 'Nunito',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600&display=swap',
    },
    rationale:
      'Playful indigo with an energetic accent, for engagement over formality.',
  },
  {
    id: 'fintech',
    name: 'Fintech / crypto',
    triggers: ['fintech', 'crypto', 'defi', 'web3 wallet', 'trading platform'],
    colors: {
      primary: '#F59E0B',
      onPrimary: '#0F172A',
      secondary: '#FBBF24',
      onSecondary: '#0F172A',
      accent: '#8B5CF6',
      onAccent: '#000000',
      background: '#0F172A',
      foreground: '#F8FAFC',
      card: '#222735',
      cardForeground: '#F8FAFC',
      muted: '#272F42',
      mutedForeground: '#94A3B8',
      border: '#334155',
      destructive: '#EF4444',
      onDestructive: '#000000',
    },
    typography: {
      headingFont: 'Orbitron',
      bodyFont: 'Exo 2',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600&family=Orbitron:wght@600;700&display=swap',
    },
    rationale:
      'Dark by default with a gold-trust primary and a purple tech accent.',
  },
  {
    id: 'real-estate',
    name: 'Real estate',
    triggers: ['real estate', 'property listing', 'property platform'],
    colors: {
      primary: '#0F766E',
      onPrimary: '#FFFFFF',
      secondary: '#14B8A6',
      onSecondary: '#0F172A',
      accent: '#0369A1',
      onAccent: '#FFFFFF',
      background: '#F0FDFA',
      foreground: '#134E4A',
      card: '#FFFFFF',
      cardForeground: '#134E4A',
      muted: '#E8F0F3',
      mutedForeground: '#475569',
      border: '#99F6E4',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Cinzel',
      bodyFont: 'Josefin Sans',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Josefin+Sans:wght@400;500&display=swap',
    },
    rationale:
      'Trust teal with a professional blue accent, reads as established rather than trendy.',
  },
  {
    id: 'restaurant',
    name: 'Restaurant / food service',
    triggers: ['restaurant', 'cafe', 'food delivery', 'menu site'],
    colors: {
      primary: '#DC2626',
      onPrimary: '#FFFFFF',
      secondary: '#F87171',
      onSecondary: '#0F172A',
      accent: '#A16207',
      onAccent: '#FFFFFF',
      background: '#FEF2F2',
      foreground: '#450A0A',
      card: '#FFFFFF',
      cardForeground: '#450A0A',
      muted: '#F0EDF1',
      mutedForeground: '#475569',
      border: '#FECACA',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Playfair Display SC',
      bodyFont: 'Karla',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600&family=Playfair+Display+SC:wght@700&display=swap',
    },
    rationale:
      'Appetite-red primary with a warm gold accent for menu highlights and pricing.',
  },
  {
    id: 'fitness',
    name: 'Fitness',
    triggers: ['fitness app', 'gym app', 'workout tracker'],
    colors: {
      primary: '#F97316',
      onPrimary: '#0F172A',
      secondary: '#FB923C',
      onSecondary: '#0F172A',
      accent: '#22C55E',
      onAccent: '#0F172A',
      background: '#1F2937',
      foreground: '#F8FAFC',
      card: '#313742',
      cardForeground: '#F8FAFC',
      muted: '#37414F',
      mutedForeground: '#CBD5E1',
      border: '#374151',
      destructive: '#EF4444',
      onDestructive: '#000000',
    },
    typography: {
      headingFont: 'Barlow Condensed',
      bodyFont: 'Barlow',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap',
    },
    rationale:
      'Dark background with energetic orange and a success-green accent for achievements.',
  },
  {
    id: 'nonprofit',
    name: 'Non-profit / charity',
    triggers: ['non-profit', 'nonprofit', 'charity', 'donation platform'],
    colors: {
      primary: '#0891B2',
      onPrimary: '#000000',
      secondary: '#22D3EE',
      onSecondary: '#0F172A',
      accent: '#EA580C',
      onAccent: '#000000',
      background: '#ECFEFF',
      foreground: '#164E63',
      card: '#FFFFFF',
      cardForeground: '#164E63',
      muted: '#E8F1F6',
      mutedForeground: '#475569',
      border: '#A5F3FC',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Lexend',
      bodyFont: 'Source Sans 3',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Lexend:wght@500;600;700&family=Source+Sans+3:wght@400;500&display=swap',
    },
    rationale:
      'Compassion blue with an action-orange donate CTA. Lexend was designed for reading proficiency -- a good default where accessibility matters most.',
  },
  {
    id: 'creative-agency',
    name: 'Creative agency',
    triggers: ['creative agency', 'design agency', 'ad agency'],
    colors: {
      primary: '#EC4899',
      onPrimary: '#000000',
      secondary: '#F472B6',
      onSecondary: '#0F172A',
      accent: '#0891B2',
      onAccent: '#000000',
      background: '#FDF2F8',
      foreground: '#831843',
      card: '#FFFFFF',
      cardForeground: '#831843',
      muted: '#F1EEF5',
      mutedForeground: '#475569',
      border: '#FBCFE8',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Bebas Neue',
      bodyFont: 'Source Sans 3',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Source+Sans+3:wght@400;500&display=swap',
    },
    rationale:
      'Bold pink against a cyan accent -- meant to be a differentiator, not a safe default.',
  },
  {
    id: 'marketplace',
    name: 'Marketplace (peer-to-peer)',
    triggers: ['marketplace', 'peer-to-peer platform', 'p2p platform'],
    colors: {
      primary: '#7C3AED',
      onPrimary: '#FFFFFF',
      secondary: '#A78BFA',
      onSecondary: '#0F172A',
      accent: '#16A34A',
      onAccent: '#000000',
      background: '#FAF5FF',
      foreground: '#4C1D95',
      card: '#FFFFFF',
      cardForeground: '#4C1D95',
      muted: '#ECEEF9',
      mutedForeground: '#475569',
      border: '#DDD6FE',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'Outfit',
      bodyFont: 'Work Sans',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Work+Sans:wght@400;500&display=swap',
    },
    rationale:
      'Trust purple with a transaction-green accent (buy/sell/confirm actions).',
  },
  {
    id: 'streaming',
    name: 'Video / audio streaming',
    triggers: [
      'streaming platform',
      'video streaming',
      'ott platform',
      'watch platform',
    ],
    colors: {
      primary: '#0F0F23',
      onPrimary: '#FFFFFF',
      secondary: '#1E1B4B',
      onSecondary: '#FFFFFF',
      accent: '#E11D48',
      onAccent: '#FFFFFF',
      background: '#000000',
      foreground: '#F8FAFC',
      card: '#0C0C0D',
      cardForeground: '#F8FAFC',
      muted: '#181818',
      mutedForeground: '#94A3B8',
      border: '#312E81',
      destructive: '#EF4444',
      onDestructive: '#000000',
    },
    typography: {
      headingFont: 'Inter',
      bodyFont: 'Inter',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    },
    rationale:
      'Cinema-dark background so poster art and thumbnails carry the colour, not the chrome.',
  },
  {
    id: 'legal',
    name: 'Legal services',
    triggers: ['law firm', 'legal services', 'attorney site'],
    colors: {
      primary: '#1E3A8A',
      onPrimary: '#FFFFFF',
      secondary: '#1E40AF',
      onSecondary: '#FFFFFF',
      accent: '#B45309',
      onAccent: '#FFFFFF',
      background: '#F8FAFC',
      foreground: '#0F172A',
      card: '#FFFFFF',
      cardForeground: '#0F172A',
      muted: '#E9EEF5',
      mutedForeground: '#475569',
      border: '#CBD5E1',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'EB Garamond',
      bodyFont: 'Lato',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=Lato:wght@400;700&display=swap',
    },
    rationale:
      'Authority navy with a restrained gold accent -- credibility over personality.',
  },
  {
    id: 'banking',
    name: 'Banking / traditional finance',
    triggers: ['banking app', 'bank site', 'traditional finance'],
    colors: {
      primary: '#0F172A',
      onPrimary: '#FFFFFF',
      secondary: '#1E3A8A',
      onSecondary: '#FFFFFF',
      accent: '#A16207',
      onAccent: '#FFFFFF',
      background: '#F8FAFC',
      foreground: '#020617',
      card: '#FFFFFF',
      cardForeground: '#020617',
      muted: '#E8ECF1',
      mutedForeground: '#475569',
      border: '#E2E8F0',
      destructive: '#DC2626',
      onDestructive: '#FFFFFF',
    },
    typography: {
      headingFont: 'IBM Plex Sans',
      bodyFont: 'IBM Plex Sans',
      googleFontsUrl:
        'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
    },
    rationale:
      'Near-black primary with a small gold accent -- security-first, minimal decoration.',
  },
] as const;

const BY_ID = new Map(PRODUCT_PALETTES.map((palette) => [palette.id, palette]));

export function findPalette(id: string): ProductPalette | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The single best-matching palette for this request, or null. Unlike
 * `selectPatterns` this returns at most one: a project has one colour
 * system, not several competing for the same tokens.
 */
export function selectPalette(promptText: string): ProductPalette | null {
  const lower = promptText.toLowerCase();
  return (
    PRODUCT_PALETTES.find((palette) =>
      palette.triggers.some((trigger) => lower.includes(trigger)),
    ) ?? null
  );
}

/**
 * The section appended to a request whose product type this catalogue
 * recognises, or null. Only called when the caller has not already chosen a
 * style preset (`plan-provider.ts`'s `buildUserPrompt`) -- a preset like
 * "dark" already carries its own colour direction, and this default should
 * never compete with an explicit choice.
 */
export function paletteGuidance(promptText: string): string | null {
  const palette = selectPalette(promptText);
  if (!palette) return null;
  const { colors, typography } = palette;
  return `This looks like a ${palette.name} product. In the absence of a stated palette, default to these CSS custom properties in src/styles.css (${palette.rationale}) -- an explicit colour or font in the request above still wins:

:root {
  --primary: ${colors.primary}; --primary-foreground: ${colors.onPrimary};
  --secondary: ${colors.secondary}; --secondary-foreground: ${colors.onSecondary};
  --accent: ${colors.accent}; --accent-foreground: ${colors.onAccent};
  --background: ${colors.background}; --foreground: ${colors.foreground};
  --card: ${colors.card}; --card-foreground: ${colors.cardForeground};
  --muted: ${colors.muted}; --muted-foreground: ${colors.mutedForeground};
  --border: ${colors.border};
  --destructive: ${colors.destructive}; --destructive-foreground: ${colors.onDestructive};
}

Use these as design tokens referenced by components (var(--primary), etc.), not as one-off hex values copy-pasted around the codebase. Heading font: ${typography.headingFont}. Body font: ${typography.bodyFont}. Import both with: @import url('${typography.googleFontsUrl}');`;
}
