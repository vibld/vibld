/**
 * Visual techniques that are hard to derive but cheap to state, retrieved on
 * demand -- the same closed-set keyword match `patterns.ts` uses for
 * structure and `motion.ts` uses for timing, applied here to how a surface
 * is actually painted.
 *
 * This exists because of a gap the other modules leave. `style-presets.ts`
 * says what a page should look like ("flowing multi-colour gradient
 * fields"), and `palettes.ts` says which colours to use, but neither says
 * how to produce the effect in plain CSS. A model asked for a mesh gradient
 * without being told the technique will reach for an image, an SVG filter,
 * or a library -- and with STACK forbidding the library, it reaches for the
 * image, which it cannot produce. The result is a flat background and a
 * request quietly unfulfilled.
 *
 * Adapted from the `css-native` skill in AThevon/genjutsu (MIT License,
 * https://github.com/AThevon/genjutsu). As in `motion.ts`, its dated
 * browser-support claims are deliberately not carried over: a perishable
 * fact baked into a prompt goes stale silently. Techniques here are either
 * long-settled or stated with their own fallback.
 *
 * Closed set, same security property as its siblings: `selectSurfaces` only
 * ever returns entries from this file, so nothing a caller types becomes a
 * technique.
 */

export interface SurfaceTechnique {
  id: string;
  name: string;
  /** Lowercase words/phrases matched against the request text. */
  triggers: readonly string[];
  /** Appended to the request when this technique matches. */
  guidance: string;
}

export const SURFACE_TECHNIQUES: readonly SurfaceTechnique[] = [
  {
    id: 'mesh-gradient',
    name: 'Mesh gradient background',
    triggers: [
      'mesh gradient',
      'gradient background',
      'gradient blob',
      'colourful background',
      'colorful background',
      'aurora background',
    ],
    guidance:
      'A mesh gradient is several overlapping radial gradients on one element, not an image and not a library: stack three or four `radial-gradient(at 20% 30%, <colour> 0%, transparent 50%)` layers at different positions and hues over a solid base colour, comma-separated in a single `background` declaration. The base colour underneath is what stops the blend going muddy where the transparent edges meet. Keep the colours within one or two neighbouring hue families or it reads as a smear rather than a field. To animate it, move `background-position` slowly (8000-20000ms, linear) rather than re-rendering the gradients.',
  },
  {
    id: 'conic-ring',
    name: 'Ring, dial or progress arc',
    triggers: [
      'progress ring',
      'circular progress',
      'donut chart',
      'radial progress',
      'gauge',
      'spinner',
    ],
    guidance:
      'Draw a ring with `conic-gradient` plus a mask rather than with SVG stroke-dasharray arithmetic: `background: conic-gradient(var(--primary) calc(var(--value) * 1%), var(--muted) 0)` on a square element with `border-radius: 50%`, then punch the centre out with `mask: radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 8px))`. The percentage is a single custom property, so animating or updating progress means changing one number. Give it `role="progressbar"` with `aria-valuenow`, and put the value in text inside the ring: a ring alone conveys the state by shape and colour only.',
  },
  {
    id: 'blend-overlay',
    name: 'Text or overlay that adapts to what is behind it',
    triggers: [
      'blend mode',
      'text over image',
      'overlay text',
      'duotone',
      'image treatment',
    ],
    guidance:
      'For text that must stay legible over an unknown image, `mix-blend-mode: difference` with `color: white` inverts against whatever is behind it. It is genuinely adaptive but it is also unpredictable, so use it for a display headline, never for body copy or anything interactive. For a duotone image treatment, put the image in a container with the shadow colour as its background, set the image to `mix-blend-mode: luminosity` or `screen`, and overlay the highlight colour. The safer general answer for text over a photograph is a gradient scrim (`linear-gradient(transparent, rgba(0,0,0,0.7))`) sized to the text block, which guarantees the contrast ratio rather than hoping for it.',
  },
  {
    id: 'clip-shape',
    name: 'Non-rectangular sections and shape reveals',
    triggers: [
      'angled section',
      'diagonal section',
      'shape divider',
      'clip path',
      'cut corner',
      'blob shape',
    ],
    guidance:
      '`clip-path` makes a non-rectangular section without an SVG asset: `polygon(0 0, 100% 0, 100% 92%, 0 100%)` gives a section with a slanted bottom edge, and `inset(0 0 0 0 round 24px 4px 24px 4px)` gives asymmetric rounding. Two rules keep it from breaking the page: the clipped area is removed from hit-testing as well as from paint, so never clip away space a control sits in, and add vertical padding equal to the deepest cut or the slant eats the first line of text at narrow widths. A shape transitions to another only when the function and its point count match, so animate `polygon()` to `polygon()` with the same number of points.',
  },
  {
    id: 'noise-texture',
    name: 'Grain or paper texture',
    triggers: [
      'noise texture',
      'grain',
      'film grain',
      'paper texture',
      'grainy',
    ],
    guidance:
      "Grain comes from an inline SVG turbulence filter used as a background image, which needs no asset file: `background-image: url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence baseFrequency='0.8'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")` on a pseudo-element covering the surface, at 3-6% opacity with `pointer-events: none`. Keep it on a fixed overlay rather than on each card: repeating it per element multiplies the cost and the seams become visible where two grained surfaces meet.",
  },
];

export function selectSurfaces(
  promptText: string,
  limit = 2,
): readonly SurfaceTechnique[] {
  const lower = promptText.toLowerCase();
  const matched = SURFACE_TECHNIQUES.filter((technique) =>
    technique.triggers.some((trigger) => lower.includes(trigger)),
  );
  return matched.slice(0, limit);
}

export function findSurfaceTechnique(id: string): SurfaceTechnique | null {
  return SURFACE_TECHNIQUES.find((technique) => technique.id === id) ?? null;
}

export function surfaceGuidance(promptText: string): string | null {
  const techniques = selectSurfaces(promptText);
  if (techniques.length === 0) return null;
  const sections = techniques
    .map((technique) => `${technique.name}: ${technique.guidance}`)
    .join('\n\n');
  return `This request involves surface techniques these notes cover. Where one conflicts with an instruction in the request above, follow the request.

${sections}`;
}
