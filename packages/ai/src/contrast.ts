/**
 * WCAG relative luminance and contrast ratio, in the smallest form that
 * answers the question this package actually asks: does this text colour
 * clear 4.5:1 against the surface it sits on?
 *
 * UX BASELINE has required that ratio since it was written, but nothing
 * checked it -- the requirement lived only in the prompt, so a palette
 * could ship a failing pair and nobody would know until someone looked.
 * These functions exist so the catalogues in this package are verified by
 * their own tests rather than by assertion.
 *
 * Pure arithmetic on purpose: no dependency, no canvas, no colour library.
 * It runs anywhere the rest of this package runs, which is what makes it
 * reusable for checking a *generated* project's tokens later (#27) rather
 * than only this repo's own.
 *
 * Formulae are WCAG 2.2, sections "relative luminance" and "contrast
 * ratio". Only 6-digit hex is accepted: everything in this package's
 * catalogues is written that way, and quietly accepting a shorthand or a
 * named colour would let an unverifiable value through the check.
 */

export function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

/** The sRGB transfer function, undone. */
function linearise(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linearise) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two colours, 1 to 21, or null if either
 * is not a 6-digit hex. Order does not matter.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal-size text. The figure UX BASELINE names. */
export const AA_NORMAL_TEXT = 4.5;
/** WCAG AA for large text (18.66px bold, or 24px), and for UI borders. */
export const AA_LARGE_TEXT = 3;

export function meetsAA(foreground: string, background: string): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= AA_NORMAL_TEXT;
}
