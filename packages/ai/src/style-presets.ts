/**
 * Named design directions a request can start from.
 *
 * open-lovable (MIT, Firecrawl) offers eight of these as chips on its home
 * screen and appends the bare name to the prompt -- "Glassmorphism style
 * design". The names are the useful part and are kept; the bare label is not,
 * because a model given only a label invents its own reading of it and the
 * same chip produces a different look every run. Each preset here carries
 * design direction concrete enough to act on.
 *
 * The eight after that (`claymorphism` through `liquidGlass`) are adapted
 * from nextlevelbuilder/ui-ux-pro-max-skill (MIT License,
 * https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), which catalogues
 * 89 named styles with far more structure than a chip needs (best-for/avoid
 * lists, framework compatibility, an implementation checklist). Chosen from
 * that set for being distinct from the first eight, broadly applicable to
 * marketing sites and SaaS screens (Vibld's actual scope) rather than
 * native-mobile-only, and not tied to another company's own product design
 * language (Fluent, Polaris, Spectrum and similar named systems in the
 * source are not ported, deliberately). L51 named "editorial" as a fifth
 * original preset that was never actually built; `editorial` below is that
 * one, finally.
 *
 * Each `direction` also carries a motion sentence. A preset that says only
 * how a page looks leaves how it moves to chance, and a model given no
 * timing invents one per run -- the same failure the file-level comment
 * above describes for bare style labels. The archetype numbers (duration
 * band, overshoot) are from LottieFiles/motion-design-skill (MIT License,
 * https://github.com/LottieFiles/motion-design-skill); the "materialize,
 * don't just fade" rule and the translucent-surface warnings on the glass
 * presets are from emilkowalski/skills (MIT License,
 * https://github.com/emilkowalski/skills). Only one preset ever ships per
 * generation, so this costs a single sentence in the prompt.
 *
 * The last seven (`warmTerminal` through `polarityBands`) are a different
 * kind of preset: they carry real token values, not only a sentence. They
 * are archetypes distilled from VoltAgent/awesome-design-md (MIT License,
 * https://github.com/VoltAgent/awesome-design-md), which catalogues the
 * design languages of about seventy real companies. What was taken is the
 * *structure* the corpus reveals once it is clustered -- that "dark" is
 * really several unrelated things (a warm near-black with no chroma at all,
 * a pure black with graded surfaces above it, a near-black carrying one
 * saturated hue, a dark ground with a single acid signal), and that a warm
 * paper ground with a terracotta accent is a distinct system rather than a
 * tint of minimalism. None of the corpus's own values are used, and none of
 * its names: every hex below is authored here and verified by this
 * package's own tests against the 4.5:1 rule UX BASELINE states.
 *
 * Naming them after the companies would have been the obvious move and is
 * deliberately not taken. That licence is a copyright grant; it conveys no
 * trademark rights, which the cataloguer does not hold and could not
 * license. A paid generator offering a menu of third-party word marks reads
 * as a licensed brand-kit catalogue, and emitting a named company's actual
 * trade dress underneath that label is a passing-off problem rather than a
 * naming one. This file already declined Fluent, Polaris and Spectrum on
 * the same ground; these names keep that decision consistent. The design
 * value survives de-naming completely -- a warm near-black canvas with an
 * off-white primary and no chromatic accent is a colour system, and colour
 * systems are facts.
 *
 * A preset with `tokens` fills a real hole rather than duplicating
 * `palettes.ts`: `buildUserPrompt` suppresses the product-type palette when
 * a preset is chosen, so before this, picking a preset meant getting no
 * colour tokens at all and letting the model invent them. The token names
 * are deliberately identical to `ProductPalette`'s, so the `:root` block
 * the prompt receives has one shape whichever source produced it.
 *
 * The set is closed, and that is the security property, not a convenience:
 * the id crosses the network from the browser, so anything that is not one of
 * these ids is rejected rather than passed through. Forwarding caller text
 * into the prompt as "design direction" would be a way to write instructions
 * for the model that the request itself does not appear to contain.
 */

export interface StylePreset {
  id: StylePresetId;
  /** Shown on the chip. */
  name: string;
  /** Shown under the chip; short enough to scan a row of eight. */
  description: string;
  /** Appended to the request. Written to be actionable in plain CSS. */
  direction: string;
  /**
   * A complete colour system, for the presets that are one. Optional
   * because most presets here are a surface treatment ("frosted glass")
   * that any palette can wear, and pinning those to fixed hexes would make
   * them narrower than they are.
   *
   * Token names match `ProductPalette.colors` exactly. Every text pair is
   * verified at 4.5:1 by this package's tests; hairlines are not, because
   * WCAG's 3:1 applies to interactive control boundaries rather than to a
   * decorative rule between two surfaces, and forcing it there produces
   * heavy-lined output no real design system ships.
   */
  tokens?: StyleTokens;
}

export interface StyleTokens {
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
    googleFontsUrl: string;
  };
  /**
   * Corner radius only. Shadow and duration are not repeated here: the
   * system prompt's MOTION BASELINE already gives durations on every
   * generation, and shadow is the one token these archetypes genuinely
   * disagree about per-component rather than per-system.
   */
  radius: { sm: string; md: string; lg: string; pill: string };
}

export type StylePresetId =
  | 'glassmorphism'
  | 'neumorphism'
  | 'brutalism'
  | 'minimalist'
  | 'dark'
  | 'gradient'
  | 'depth'
  | 'retrowave'
  | 'claymorphism'
  | 'aurora'
  | 'bentoGrid'
  | 'editorial'
  | 'organic'
  | 'aiNative'
  | 'vibrantBlocks'
  | 'liquidGlass'
  | 'warmTerminal'
  | 'layeredVoid'
  | 'acidDark'
  | 'nightIndigo'
  | 'warmPaper'
  | 'monoPress'
  | 'polarityBands';

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted glass',
    direction:
      'Frosted glass surfaces: translucent panels over a saturated background, backdrop-filter blur, hairline light borders and soft shadows. Keep text on a solid-enough backing to stay readable. Motion: materialize rather than fade -- animate backdrop-filter blur radius and scale together on enter so the surface reads as real material arriving, 250ms --ease-out. Never stack one light translucent surface on another; legibility collapses. Put colour on a solid layer behind the glass, not on the translucent foreground.',
  },
  {
    id: 'neumorphism',
    name: 'Neumorphism',
    description: 'Soft 3D shadows',
    direction:
      'Soft extruded surfaces in a single low-contrast tone: paired light and dark shadows so controls look pressed into or raised out of the background. Contrast is the risk here, so keep text and focus rings clearly visible. Motion: the shadow pair swaps rather than the element moving -- an inset shadow on :active over 120ms --ease-out reads as a real press. Keep everything else still; this style has no contrast headroom for movement.',
  },
  {
    id: 'brutalism',
    name: 'Brutalism',
    description: 'Bold and raw',
    direction:
      'Raw and deliberate: heavy black rules, flat blocks of one or two loud colours, oversized type, visible grid, hard shadows and no rounded corners. Motion: near-zero. Transitions at 0-80ms with no easing softness, or none at all -- a hard cut is the honest choice here, and a gentle curve contradicts the whole direction.',
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Clean and quiet',
    direction:
      'Generous whitespace, a restrained neutral palette with one accent, a strict type scale, few rules and borders, and no decoration that does not carry meaning. Motion: opacity only, around 150ms --ease-out, no transforms and no stagger. In a design this quiet, movement is the loudest thing on the page.',
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Dark by default',
    direction:
      'Dark by default: layered near-black surfaces rather than one flat black, low-chroma text at graded emphasis, and a single bright accent used sparingly. Motion: reduce intensity by 10-20% against the same design on light -- bright elements on a dark ground already read as higher-energy, so the same distance and duration feel more agitated.',
  },
  {
    id: 'gradient',
    name: 'Gradient rich',
    description: 'Vivid gradients',
    direction:
      'Vivid multi-stop gradients across large surfaces, gradient text on headings, glowing accents, and colour that shifts between sections. Motion: the gradient itself drifts -- shift background-position by 10-20% over 8000-20000ms, linear, imperceptible at a glance. Foreground elements stay on the standard 150-250ms budget.',
  },
  {
    id: 'depth',
    name: '3D depth',
    description: 'Dimensional layers',
    direction:
      'Dimensional layering: overlapping cards at several elevations, large soft shadows, subtle perspective transforms and parallax between foreground and background. Motion: parallax between layers at 1.0x foreground, 0.5x midground, 0.2x background, total displacement under 100px, disabled on mobile and never applied to text. Cards lift on hover by shadow and 2-4px of translateY, not by scale.',
  },
  {
    id: 'retrowave',
    name: 'Retro wave',
    description: '80s inspired',
    direction:
      'Eighties retro-futurism: magenta, cyan and deep purple on near-black, neon glow on text and edges, horizon grids, scanlines and chrome-style headings. Motion: a slow glow pulse on neon edges -- opacity or text-shadow spread breathing over 2000-3000ms -- plus horizon-grid drift if there is one. Interface motion stays fast and snappy underneath it.',
  },
  {
    id: 'claymorphism',
    name: 'Claymorphism',
    description: 'Soft and playful',
    direction:
      'Puffy, rounded surfaces that look moulded from clay: soft matte colours, an inflated 3D look from a light inner highlight plus a soft outer shadow (never a hard shadow), generous corner radii, and a friendly, approachable tone throughout. Motion: playful -- 150-300ms with a 10-20% overshoot on entrances (an ease-out-back curve), and a visible squash on press. The material looks soft, so it should settle like something soft.',
  },
  {
    id: 'aurora',
    name: 'Aurora UI',
    description: 'Flowing gradient light',
    direction:
      'Soft, flowing multi-colour gradient fields (like aurora light) behind glass-like foreground panels, gentle blur, and light that feels like it is slowly moving rather than a static backdrop. Keep foreground text on a surface solid enough to stay readable over the gradient. Motion: the drifting light is the point, not decoration. Move the gradient field over 8000-20000ms, linear or sine, with foreground panels entering at the normal 200-250ms. If the background is static, this is not aurora.',
  },
  {
    id: 'bentoGrid',
    name: 'Bento grid',
    description: 'Asymmetric tiles',
    direction:
      'A grid of asymmetric rounded tiles of varying sizes, each one a self-contained card holding one idea (a stat, a feature, an image), like a bento box. Consistent gutter and corner radius across every tile size, restrained colour so the grid structure itself carries the visual interest. Motion: tiles enter staggered by 30-60ms in a center-out or top-left order, total under 500ms, each fading up 8px. Hover lifts a single tile; the grid itself never reflows.',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Magazine-style grid',
    direction:
      'A magazine-style editorial grid: a dominant serif or high-contrast display headline, a strict multi-column text grid, generous margins, pull quotes set apart from body copy, and photography treated as full-bleed feature images rather than small thumbnails. Motion: premium and unhurried -- 350-600ms, zero overshoot, opacity plus a 98%-to-100% scale and nothing more. Full-bleed images may reveal on scroll with a clip-path wipe; body text never animates.',
  },
  {
    id: 'organic',
    name: 'Organic',
    description: 'Natural and biophilic',
    direction:
      'Biophilic and natural: earthy, desaturated greens and browns, soft irregular blob shapes rather than rectangles, textures suggesting paper or natural material, and generous breathing room that reads as calm rather than corporate. Motion: slow and breathing -- ambient scale between 0.98 and 1.02 over 3000-4000ms on decorative shapes, and 300-500ms eased transitions on everything else. Nothing snaps.',
  },
  {
    id: 'aiNative',
    name: 'AI-native',
    description: 'Ambient and adaptive',
    direction:
      'Ambient, adaptive surfaces built around a conversational or generative core: a soft animated gradient or glow standing in for "thinking" state, chat-first layout, restrained chrome so the AI output is the visual focus, and generous rounded corners on message/response surfaces. Motion: a soft animated gradient or glow standing in for a thinking state -- 1500-2500ms loop, running only while work is actually in flight, never as permanent decoration. Streamed response text appears progressively rather than all at once.',
  },
  {
    id: 'vibrantBlocks',
    name: 'Vibrant blocks',
    description: 'Bold flat colour',
    direction:
      'Bold, saturated flat colour blocks with hard edges (no gradients, no shadows), high-contrast complementary colour pairs, oversized rounded sans-serif type, and a confident, energetic tone aimed at a younger or more casual audience. Motion: energetic -- 100-250ms with 15-30% overshoot, large decisive moves, colour blocks snapping into place from an edge. Fast enough to feel eager, never bouncy enough to feel unstable.',
  },
  {
    id: 'liquidGlass',
    name: 'Liquid glass',
    description: 'Fluid translucent surfaces',
    direction:
      'Fluid, translucent surfaces that refract and bend the content behind them like real glass or liquid, with soft specular highlights along edges and smooth, physical-feeling transitions between states. More dimensional and fluid than flat glassmorphism -- the surface should feel like it is reacting to what is behind and around it, not just blurred. Motion: the surface should react, not just blur -- animate blur radius, scale and the specular highlight together on enter and on hover, 250-350ms --ease-out. Never stack one translucent surface on another, and keep colour on the solid layer behind.',
  },
  {
    id: 'warmTerminal',
    name: 'Warm terminal',
    description: 'Warm near-black, no colour',
    direction:
      'A warm near-black ground -- brown-tinted rather than blue-tinted or neutral -- with an off-white as the only strong value and no chromatic accent at all in the interface itself. Monospace for headings and labels so the page reads as a tool rather than a brochure; hairlines and surfaces separate by a step of warmth, not by a border colour. The restraint is the style: a single amber is available for a genuine warning and nothing else earns colour. Motion: fast and mechanical -- 100-150ms, no overshoot, no easing flourish. A tool should feel instant.',
    tokens: {
      colors: {
        primary: '#F7F5F0',
        onPrimary: '#2B2622',
        secondary: '#4A443F',
        onSecondary: '#F7F5F0',
        accent: '#E0A458',
        onAccent: '#2B2622',
        background: '#2B2622',
        foreground: '#F7F5F0',
        card: '#383330',
        cardForeground: '#F7F5F0',
        muted: '#3F3A36',
        mutedForeground: '#BDB4A8',
        border: '#4A443F',
        destructive: '#F08472',
        onDestructive: '#2B2622',
      },
      typography: {
        headingFont: 'JetBrains Mono',
        bodyFont: 'Inter',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap',
      },
      radius: { sm: '3px', md: '4px', lg: '6px', pill: '999px' },
    },
  },
  {
    id: 'layeredVoid',
    name: 'Layered void',
    description: 'Pure black, graded surfaces',
    direction:
      'A true black page with depth built from graded surfaces rather than from shadow: the canvas is #000, cards sit a step above it, elevated elements a step above those, and a hairline marks each boundary. White is the primary action colour and black the text on it, inverting the usual relationship. Exactly one warm accent exists for the single most important action per screen. Motion: surfaces fade and lift between elevation steps at 200ms; nothing slides. Depth changes, position does not.',
    tokens: {
      colors: {
        primary: '#FFFFFF',
        onPrimary: '#000000',
        secondary: '#1C1C1E',
        onSecondary: '#FFFFFF',
        accent: '#FF801F',
        onAccent: '#000000',
        background: '#000000',
        foreground: '#FAFAFA',
        card: '#0D0D0F',
        cardForeground: '#FAFAFA',
        muted: '#18181B',
        mutedForeground: '#A1A1AA',
        border: '#262629',
        destructive: '#FF6B6B',
        onDestructive: '#000000',
      },
      typography: {
        headingFont: 'Inter Tight',
        bodyFont: 'Inter',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&display=swap',
      },
      radius: { sm: '6px', md: '10px', lg: '14px', pill: '999px' },
    },
  },
  {
    id: 'acidDark',
    name: 'Acid dark',
    description: 'One high-voltage accent',
    direction:
      'A near-black ground carrying exactly one very high-chroma colour -- an acid yellow-green -- used as the primary action and nowhere else. The discipline is what makes it work: everything else is greyscale, so the accent reads as a signal rather than as decoration, and a second saturated colour anywhere on the page destroys the effect. Type is a geometric sans, tight and technical. Motion: 100-180ms, sharp and immediate. The accent may pulse briefly on a state change; nothing else moves.',
    tokens: {
      colors: {
        primary: '#E8FF52',
        onPrimary: '#0A0A0A',
        secondary: '#1A1A1A',
        onSecondary: '#FFFFFF',
        accent: '#B9CC3F',
        onAccent: '#0A0A0A',
        background: '#0A0A0A',
        foreground: '#FFFFFF',
        card: '#121212',
        cardForeground: '#FFFFFF',
        muted: '#1F1F1F',
        mutedForeground: '#9A9A9A',
        border: '#2A2A2A',
        destructive: '#FF5C5C',
        onDestructive: '#0A0A0A',
      },
      typography: {
        headingFont: 'Space Grotesk',
        bodyFont: 'IBM Plex Sans',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap',
      },
      radius: { sm: '4px', md: '6px', lg: '8px', pill: '999px' },
    },
  },
  {
    id: 'nightIndigo',
    name: 'Night indigo',
    description: 'Dark with one deep hue',
    direction:
      'A near-black canvas with a cool blue cast, carrying a single saturated indigo as the product colour across buttons, links and selected states. Surfaces step up in three graded levels above the canvas, each a few points lighter, so hierarchy comes from elevation rather than from borders. Text runs at three deliberate emphasis levels -- full, muted, subtle -- rather than one grey for everything. Motion: 150-250ms, ease-out, precise. Selection and focus states change instantly; only overlays animate.',
    tokens: {
      colors: {
        primary: '#7C87F5',
        onPrimary: '#0A0B14',
        secondary: '#1E1F2E',
        onSecondary: '#F7F8F8',
        accent: '#9AA5FF',
        onAccent: '#0A0B14',
        background: '#0A0B10',
        foreground: '#F7F8F8',
        card: '#14151C',
        cardForeground: '#F7F8F8',
        muted: '#1C1D26',
        mutedForeground: '#9CA3AF',
        border: '#282A36',
        destructive: '#F87171',
        onDestructive: '#0A0B10',
      },
      typography: {
        headingFont: 'Manrope',
        bodyFont: 'Inter',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@500;600;800&display=swap',
      },
      radius: { sm: '4px', md: '8px', lg: '12px', pill: '999px' },
    },
  },
  {
    id: 'warmPaper',
    name: 'Warm paper',
    description: 'Cream ground, terracotta',
    direction:
      'An off-white ground that is warm rather than grey -- cream or bone, never #fff as the page colour -- with near-black warm text and a muted terracotta as the accent. White is reserved for cards so they lift off the page by being *lighter* than it. The overall register is considered and literary rather than corporate: generous margins, a serif for headings, and colour used sparingly enough that the terracotta always means something. Motion: unhurried, 250-350ms, opacity-led. Nothing bounces; the material is paper, not rubber.',
    tokens: {
      colors: {
        primary: '#B5533A',
        onPrimary: '#FFFFFF',
        secondary: '#E8E0D5',
        onSecondary: '#2A2825',
        accent: '#2F6F62',
        onAccent: '#FFFFFF',
        background: '#FAF8F3',
        foreground: '#1F1E1C',
        card: '#FFFFFF',
        cardForeground: '#1F1E1C',
        muted: '#EFEAE1',
        mutedForeground: '#5C5850',
        border: '#DED7CA',
        destructive: '#A63328',
        onDestructive: '#FFFFFF',
      },
      typography: {
        headingFont: 'Fraunces',
        bodyFont: 'Source Sans 3',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Sans+3:wght@400;500;600&display=swap',
      },
      radius: { sm: '6px', md: '10px', lg: '16px', pill: '999px' },
    },
  },
  {
    id: 'monoPress',
    name: 'Mono press',
    description: 'Black, white, one blue',
    direction:
      'Pure black on pure white with no radius anywhere and no shadow, the way a printed page has neither. Structure comes from rules, weight and scale alone. Exactly one blue exists and it means "this is a link" -- never a button fill, never a decorative tint. Headlines are set heavy and large enough to carry the page on their own. Motion: almost none. Instant state changes; at most a 120ms opacity fade. Print does not animate.',
    tokens: {
      colors: {
        primary: '#111111',
        onPrimary: '#FFFFFF',
        secondary: '#F2F2F2',
        onSecondary: '#111111',
        accent: '#0057B8',
        onAccent: '#FFFFFF',
        background: '#FFFFFF',
        foreground: '#111111',
        card: '#FFFFFF',
        cardForeground: '#111111',
        muted: '#F5F5F5',
        mutedForeground: '#595959',
        border: '#DCDCDC',
        destructive: '#B3261E',
        onDestructive: '#FFFFFF',
      },
      typography: {
        headingFont: 'Archivo',
        bodyFont: 'Inter',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600&display=swap',
      },
      radius: { sm: '0px', md: '0px', lg: '2px', pill: '999px' },
    },
  },
  {
    id: 'polarityBands',
    name: 'Polarity bands',
    description: 'Alternating dark and light',
    direction:
      'The page alternates full-bleed bands between a near-black ground and a warm off-white one, sharing a single type scale and a single accent across both. Each band owns one idea and inverts the one above it, so section boundaries need no divider at all -- the value flip is the divider. Keep the accent identical in both polarities rather than swapping it, and verify text contrast separately inside each band. Motion: bands reveal on scroll at 400-600ms with a clip wipe, once only; content inside a band does not animate.',
    tokens: {
      colors: {
        primary: '#101010',
        onPrimary: '#FAF7F0',
        secondary: '#FAF7F0',
        onSecondary: '#101010',
        accent: '#1F5F4F',
        onAccent: '#FAF7F0',
        background: '#FAF7F0',
        foreground: '#101010',
        card: '#FFFFFF',
        cardForeground: '#101010',
        muted: '#EAE5DA',
        mutedForeground: '#55524B',
        border: '#D8D2C5',
        destructive: '#9E2B25',
        onDestructive: '#FAF7F0',
      },
      typography: {
        headingFont: 'Instrument Serif',
        bodyFont: 'Inter',
        googleFontsUrl:
          'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap',
      },
      radius: { sm: '2px', md: '4px', lg: '8px', pill: '999px' },
    },
  },
] as const;

const BY_ID = new Map(STYLE_PRESETS.map((preset) => [preset.id, preset]));

export function isStylePresetId(value: unknown): value is StylePresetId {
  return typeof value === 'string' && BY_ID.has(value as StylePresetId);
}

export function findStylePreset(id: string): StylePreset | null {
  return BY_ID.get(id as StylePresetId) ?? null;
}

/**
 * The sentence appended to a request for a preset, or null for no preset.
 *
 * Phrased as a starting point rather than a requirement: an explicit
 * instruction in the request itself has to win. Someone who picks "Dark" and
 * then writes "white background" means the white background.
 */
export function styleDirection(id: string | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  const preset = findStylePreset(id);
  if (!preset) return null;
  const opening = `Start from a ${preset.name.toLowerCase()} visual direction: ${preset.direction} Where this conflicts with an instruction in the request above, follow the request.`;
  if (!preset.tokens) return opening;

  // A preset carrying a whole colour system emits it, because the
  // product-type palette is suppressed whenever a preset is chosen -- see
  // `buildUserPrompt`. Same token names and same block shape as
  // `paletteGuidance`, so the model sees one contract either way.
  const { colors, typography, radius } = preset.tokens;
  return `${opening}

These are the system's actual tokens. Put them in src/styles.css and
reference them as var(--primary) and so on, never as repeated hex values:

:root {
  --primary: ${colors.primary}; --primary-foreground: ${colors.onPrimary};
  --secondary: ${colors.secondary}; --secondary-foreground: ${colors.onSecondary};
  --accent: ${colors.accent}; --accent-foreground: ${colors.onAccent};
  --background: ${colors.background}; --foreground: ${colors.foreground};
  --card: ${colors.card}; --card-foreground: ${colors.cardForeground};
  --muted: ${colors.muted}; --muted-foreground: ${colors.mutedForeground};
  --border: ${colors.border};
  --destructive: ${colors.destructive}; --destructive-foreground: ${colors.onDestructive};
  --radius-sm: ${radius.sm}; --radius-md: ${radius.md};
  --radius-lg: ${radius.lg}; --radius-pill: ${radius.pill};
}

Heading font: ${typography.headingFont}. Body font: ${typography.bodyFont}.
Import both with: @import url('${typography.googleFontsUrl}');`;
}
