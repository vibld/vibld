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
  | 'retrowave';

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
