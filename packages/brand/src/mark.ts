/**
 * The Vibld mark: one chevron, printed twice, slightly out of register.
 *
 * Geometry as data rather than as a component, because it has to be drawn in
 * three places that cannot share a React tree: the marketing site, the
 * builder, and the static files a build writes (favicon, social card). One
 * path definition means the mark cannot drift between them, which is exactly
 * what happened before this existed.
 *
 * The direction's own weakness, named when it was chosen: the overprint
 * depends on transparency, and monochrome favicon rendering and some email
 * clients throw that away, leaving a muddy single shape. `MONO_MARK` is the
 * answer rather than a hope, and `markSvg` takes which one it is drawing.
 */
import { LIGHT, oklch } from './palette.ts';
import type { Theme } from './palette.ts';

/** The chevron, in a 32x32 box. Both strokes are this path, translated. */
export const CHEVRON = 'M6 9l9 15 9-15';

/**
 * How far the second impression sits off the first.
 *
 * Two units down and right, which at 32px is the whole joke and at 16px is
 * still just visible. More than this stops reading as a misregistration and
 * starts reading as two shapes.
 */
export const REGISTER_OFFSET = 2;

/** Stroke weight, in the same 32-unit space. */
export const STROKE = 4.4;

export interface MarkOptions {
  size: number;
  theme?: Theme;
  /**
   * Draw one ink instead of two.
   *
   * For anywhere the overprint cannot survive: a monochrome favicon mask, a
   * fax-grade email client, a single-colour print. It draws `markInk` only,
   * because that is the stroke the shape's legibility rests on; falling back
   * to the coral ghost would leave a mark at 2.60 against its own paper.
   */
  mono?: boolean;
  title?: string;
}

function chevronAt(offset: number): string {
  return offset === 0 ? CHEVRON : `M${6 + offset} ${9 + offset}l9 15 9-15`;
}

/**
 * The mark as an SVG string.
 *
 * `mix-blend-mode: multiply` is what makes two flat inks overprint into a
 * third colour where they cross, rather than one simply covering the other.
 * It is set on the group, so a renderer that does not support it still draws
 * both strokes in the right places and only loses the overlap.
 */
export function markSvg(options: MarkOptions): string {
  const { size, theme = LIGHT, mono = false, title } = options;
  const label = title ? `<title>${title}</title>` : '';
  const role = title ? 'img' : 'presentation';
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" role="${role}"${title ? '' : ' aria-hidden="true"'}>`;

  const ink = `<path d="${chevronAt(REGISTER_OFFSET)}" stroke="${oklch(theme.markInk)}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>`;
  if (mono) return `${open}${label}${ink}</svg>`;

  const ghost = `<path d="${chevronAt(0)}" stroke="${oklch(theme.markOffset)}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>`;
  return `${open}${label}<g style="mix-blend-mode:${theme.markBlend}">${ghost}${ink}</g></svg>`;
}

/**
 * The smallest size the overprint is worth drawing at.
 *
 * Below this the two-unit offset is under half a pixel and the mark renders
 * as one thick smudge, so anything smaller should ask for `mono` instead.
 */
export const MIN_OVERPRINT_SIZE = 16;

/** The wordmark, which is set in lowercase everywhere, with no exceptions. */
export const WORDMARK = 'vibld';
