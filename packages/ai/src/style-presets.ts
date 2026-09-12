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
  | 'liquidGlass';

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted glass',
    direction:
      'Frosted glass surfaces: translucent panels over a saturated background, backdrop-filter blur, hairline light borders and soft shadows. Keep text on a solid-enough backing to stay readable.',
  },
  {
    id: 'neumorphism',
    name: 'Neumorphism',
    description: 'Soft 3D shadows',
    direction:
      'Soft extruded surfaces in a single low-contrast tone: paired light and dark shadows so controls look pressed into or raised out of the background. Contrast is the risk here, so keep text and focus rings clearly visible.',
  },
  {
    id: 'brutalism',
    name: 'Brutalism',
    description: 'Bold and raw',
    direction:
      'Raw and deliberate: heavy black rules, flat blocks of one or two loud colours, oversized type, visible grid, hard shadows and no rounded corners.',
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Clean and quiet',
    direction:
      'Generous whitespace, a restrained neutral palette with one accent, a strict type scale, few rules and borders, and no decoration that does not carry meaning.',
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Dark by default',
    direction:
      'Dark by default: layered near-black surfaces rather than one flat black, low-chroma text at graded emphasis, and a single bright accent used sparingly.',
  },
  {
    id: 'gradient',
    name: 'Gradient rich',
    description: 'Vivid gradients',
    direction:
      'Vivid multi-stop gradients across large surfaces, gradient text on headings, glowing accents, and colour that shifts between sections.',
  },
  {
    id: 'depth',
    name: '3D depth',
    description: 'Dimensional layers',
    direction:
      'Dimensional layering: overlapping cards at several elevations, large soft shadows, subtle perspective transforms and parallax between foreground and background.',
  },
  {
    id: 'retrowave',
    name: 'Retro wave',
    description: '80s inspired',
    direction:
      'Eighties retro-futurism: magenta, cyan and deep purple on near-black, neon glow on text and edges, horizon grids, scanlines and chrome-style headings.',
  },
  {
    id: 'claymorphism',
    name: 'Claymorphism',
    description: 'Soft and playful',
    direction:
      'Puffy, rounded surfaces that look moulded from clay: soft matte colours, an inflated 3D look from a light inner highlight plus a soft outer shadow (never a hard shadow), generous corner radii, and a friendly, approachable tone throughout.',
  },
  {
    id: 'aurora',
    name: 'Aurora UI',
    description: 'Flowing gradient light',
    direction:
      'Soft, flowing multi-colour gradient fields (like aurora light) behind glass-like foreground panels, gentle blur, and light that feels like it is slowly moving rather than a static backdrop. Keep foreground text on a surface solid enough to stay readable over the gradient.',
  },
  {
    id: 'bentoGrid',
    name: 'Bento grid',
    description: 'Asymmetric tiles',
    direction:
      'A grid of asymmetric rounded tiles of varying sizes, each one a self-contained card holding one idea (a stat, a feature, an image), like a bento box. Consistent gutter and corner radius across every tile size, restrained colour so the grid structure itself carries the visual interest.',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Magazine-style grid',
    direction:
      'A magazine-style editorial grid: a dominant serif or high-contrast display headline, a strict multi-column text grid, generous margins, pull quotes set apart from body copy, and photography treated as full-bleed feature images rather than small thumbnails.',
  },
  {
    id: 'organic',
    name: 'Organic',
    description: 'Natural and biophilic',
    direction:
      'Biophilic and natural: earthy, desaturated greens and browns, soft irregular blob shapes rather than rectangles, textures suggesting paper or natural material, and generous breathing room that reads as calm rather than corporate.',
  },
  {
    id: 'aiNative',
    name: 'AI-native',
    description: 'Ambient and adaptive',
    direction:
      'Ambient, adaptive surfaces built around a conversational or generative core: a soft animated gradient or glow standing in for "thinking" state, chat-first layout, restrained chrome so the AI output is the visual focus, and generous rounded corners on message/response surfaces.',
  },
  {
    id: 'vibrantBlocks',
    name: 'Vibrant blocks',
    description: 'Bold flat colour',
    direction:
      'Bold, saturated flat colour blocks with hard edges (no gradients, no shadows), high-contrast complementary colour pairs, oversized rounded sans-serif type, and a confident, energetic tone aimed at a younger or more casual audience.',
  },
  {
    id: 'liquidGlass',
    name: 'Liquid glass',
    description: 'Fluid translucent surfaces',
    direction:
      'Fluid, translucent surfaces that refract and bend the content behind them like real glass or liquid, with soft specular highlights along edges and smooth, physical-feeling transitions between states. More dimensional and fluid than flat glassmorphism -- the surface should feel like it is reacting to what is behind and around it, not just blurred.',
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
  return `Start from a ${preset.name.toLowerCase()} visual direction: ${preset.direction} Where this conflicts with an instruction in the request above, follow the request.`;
}
