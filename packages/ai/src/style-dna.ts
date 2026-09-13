/**
 * A handful of closed dimensions that describe a visual stance, encoded as
 * one short line that can be carried from turn to turn.
 *
 * Adapted from zanwei/design-dna (MIT License,
 * https://github.com/zanwei/design-dna), whose schema is mostly an
 * extraction-output format -- about sixty `design_system` fields, ninety
 * `visual_effects` fields, and a rule that every one must be populated. That
 * shape is wrong for a prompt and weaker than `palettes.ts` for colour,
 * because its colour model has no on-colour pairing at all. What is worth
 * taking is the one part built from controlled enums rather than free prose:
 * about ten dimensions whose values are fixed, which between them encode a
 * whole visual stance in under two hundred characters.
 *
 * Why this exists as its own thing rather than as more prose in the
 * knowledge field: prose drifts. "Keep it minimal" written once means
 * something slightly different to the model on every turn, and a user
 * re-reading their own instruction three turns later cannot tell whether it
 * is still being honoured. A fixed vocabulary does not drift, is the same
 * length every time, and is cheap enough to send on every request without
 * competing with the user's own words for the knowledge budget.
 *
 * The set is closed, and that is the security property, not a convenience.
 * These values cross the network from the browser exactly as a style preset
 * id does, and anything that is not one of them is dropped rather than
 * passed through -- so this cannot become a way to write instructions for
 * the model that the request does not appear to contain.
 */

export interface StyleDimension {
  id: StyleDimensionId;
  /** Shown as the control's label. */
  label: string;
  /** The closed set of values, in order from least to most of the quality. */
  options: readonly StyleOption[];
}

export interface StyleOption {
  value: string;
  /** What the model is told when this value is chosen. */
  direction: string;
}

export type StyleDimensionId =
  | 'complexity'
  | 'ornamentation'
  | 'contrast'
  | 'density'
  | 'focal'
  | 'balance'
  | 'corners'
  | 'motion'
  | 'voice';

export const STYLE_DIMENSIONS: readonly StyleDimension[] = [
  {
    id: 'complexity',
    label: 'Complexity',
    options: [
      { value: 'minimal', direction: 'as few elements as the page can carry' },
      { value: 'moderate', direction: 'a conventional amount of detail' },
      { value: 'rich', direction: 'layered detail and supporting elements' },
      { value: 'maximal', direction: 'dense, deliberately a lot to look at' },
    ],
  },
  {
    id: 'ornamentation',
    label: 'Ornament',
    options: [
      { value: 'none', direction: 'no decoration that does not carry meaning' },
      { value: 'accents', direction: 'a few small decorative accents' },
      {
        value: 'decorative',
        direction: 'decoration as a visible part of the design',
      },
      { value: 'ornate', direction: 'heavy ornament, patterning and flourish' },
    ],
  },
  {
    id: 'contrast',
    label: 'Contrast',
    options: [
      { value: 'soft', direction: 'close tonal values, gentle separation' },
      { value: 'normal', direction: 'conventional tonal separation' },
      {
        value: 'high',
        direction: 'strong value jumps between surfaces and text',
      },
      {
        value: 'extreme',
        direction: 'near-black against near-white, no middle',
      },
    ],
  },
  {
    id: 'density',
    label: 'Density',
    options: [
      {
        value: 'airy',
        direction: 'generous whitespace, few things per screen',
      },
      { value: 'balanced', direction: 'conventional spacing' },
      { value: 'compact', direction: 'tight spacing, more visible at once' },
    ],
  },
  {
    id: 'focal',
    label: 'Focus',
    options: [
      { value: 'single', direction: 'one dominant element per screen' },
      {
        value: 'distributed',
        direction: 'interest spread evenly across the page',
      },
      {
        value: 'progressive',
        direction: 'interest revealed as the reader moves down',
      },
    ],
  },
  {
    id: 'balance',
    label: 'Balance',
    options: [
      { value: 'symmetric', direction: 'centred, mirrored composition' },
      { value: 'asymmetric', direction: 'off-centre, weighted composition' },
      { value: 'mosaic', direction: 'a grid of unequal tiles' },
    ],
  },
  {
    id: 'corners',
    label: 'Corners',
    options: [
      { value: 'sharp', direction: 'square corners, radius at or near zero' },
      { value: 'soft', direction: 'a small consistent radius' },
      { value: 'round', direction: 'generous radii, pills for buttons' },
    ],
  },
  {
    id: 'motion',
    label: 'Motion',
    options: [
      { value: 'still', direction: 'no motion beyond focus and hover states' },
      {
        value: 'snappy',
        direction: 'fast, precise transitions with no overshoot',
      },
      { value: 'smooth', direction: 'longer eased transitions that glide' },
      {
        value: 'springy',
        direction: 'transitions that overshoot slightly and settle',
      },
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    options: [
      { value: 'direct', direction: 'plain imperative copy and button labels' },
      {
        value: 'warm',
        direction: 'friendly, inviting copy without being cute',
      },
      { value: 'formal', direction: 'measured, professional copy' },
      { value: 'playful', direction: 'light, informal copy with personality' },
    ],
  },
];

const BY_ID = new Map(
  STYLE_DIMENSIONS.map((dimension) => [dimension.id, dimension]),
);

/** A partial selection: every dimension is optional and defaults to unset. */
export type StyleDna = Partial<Record<StyleDimensionId, string>>;

export function findDimension(id: string): StyleDimension | null {
  return BY_ID.get(id as StyleDimensionId) ?? null;
}

/**
 * Drop anything that is not a known dimension with a known value.
 *
 * This is the closed-set check, and it runs on whatever arrives rather than
 * trusting the caller: an unknown key or an unrecognised value is removed,
 * not passed through.
 */
export function sanitizeStyleDna(input: unknown): StyleDna {
  if (typeof input !== 'object' || input === null) return {};
  const clean: StyleDna = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const dimension = findDimension(key);
    if (!dimension || typeof value !== 'string') continue;
    if (!dimension.options.some((option) => option.value === value)) continue;
    clean[dimension.id] = value;
  }
  return clean;
}

/** `complexity: minimal | corners: sharp | motion: still`, or null if unset. */
export function encodeStyleDna(dna: StyleDna): string | null {
  const parts: string[] = [];
  for (const dimension of STYLE_DIMENSIONS) {
    const value = dna[dimension.id];
    if (value) parts.push(`${dimension.id}: ${value}`);
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

/**
 * The sentence appended to a request for a selection, or null when nothing
 * is set. Subordinate to the request, like every other retrieved guidance in
 * this package: someone who sets "corners: sharp" and then asks for a pill
 * button means the pill button.
 */
export function styleDnaGuidance(dna: StyleDna): string | null {
  const lines: string[] = [];
  for (const dimension of STYLE_DIMENSIONS) {
    const value = dna[dimension.id];
    if (!value) continue;
    const option = dimension.options.find((entry) => entry.value === value);
    if (option) lines.push(`- ${dimension.label}: ${option.direction}.`);
  }
  if (lines.length === 0) return null;
  return `Standing visual preferences for this project, which apply to every request:

${lines.join('\n')}

Where these conflict with the request above, follow the request.`;
}
