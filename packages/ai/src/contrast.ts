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

/**
 * The custom properties declared on `:root` in a stylesheet.
 *
 * Deliberately not a CSS parser. It finds `:root` blocks, reads
 * `--name: value` declarations out of them, and ignores everything else.
 * That is enough for the token convention this package emits and asks for,
 * and a real parser would be a dependency and a maintenance surface for no
 * additional answer.
 *
 * Later declarations win, which is what the cascade does within one file.
 *
 * Scanned with `indexOf` and `split` rather than matched with a regex, and
 * that is not a style preference. The obvious patterns here -- `:root[^{]*\{`
 * for the block and `(--[\w-]+)\s*:` for a declaration -- both backtrack
 * polynomially, so a stylesheet of ten thousand repetitions of `:root` or of
 * `-` takes quadratic time. The input is a generated project's CSS, and
 * model output is untrusted input (ADR-0007), so that is a way to pin the
 * Worker with one plausible-looking file. Scanning is linear and, as it
 * turns out, easier to read.
 */
function readDeclarations(block: string, into: Map<string, string>): void {
  for (const declaration of block.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    // A custom property, and a plausible one: a name carrying whitespace or a
    // brace means the block was not shaped the way this assumes.
    if (!name.startsWith('--') || name.length < 3) continue;
    if (/[\s{}]/.test(name)) continue;
    const value = declaration.slice(colon + 1).trim();
    if (value.length > 0) into.set(name, value);
  }
}

export function readRootTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  let cursor = 0;
  while (cursor < css.length) {
    const selector = css.indexOf(':root', cursor);
    if (selector === -1) break;
    // The first `{` after the selector opens the block, and the first `}`
    // closes it. Nested rules inside :root would break this, but :root
    // carries declarations, not rules.
    const open = css.indexOf('{', selector);
    if (open === -1) break;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    readDeclarations(css.slice(open + 1, close), tokens);
    cursor = close + 1;
  }
  return tokens;
}

export interface ContrastFinding {
  foreground: string;
  background: string;
  foregroundValue: string;
  backgroundValue: string;
  ratio: number;
}

/**
 * Every declared text-on-surface pair that falls under 4.5:1.
 *
 * Pairs are found by the naming convention this package emits: `--x` with
 * `--x-foreground`, plus `--background` with `--foreground`. A token whose
 * value is not a 6-digit hex is skipped rather than guessed at -- `oklch()`,
 * `rgb()` and `var()` are all legitimate, and reporting a pair as passing
 * when it was never measured would be worse than reporting nothing.
 *
 * Hairlines are not checked. WCAG's 3:1 applies to interactive control
 * boundaries, not to a decorative rule between two surfaces, and holding a
 * `--border` token to it produces heavy-lined output no design system ships.
 */
export function findContrastFailures(css: string): ContrastFinding[] {
  const tokens = readRootTokens(css);
  const pairs: Array<[string, string]> = [];

  for (const name of tokens.keys()) {
    if (!name.endsWith('-foreground')) continue;
    const surface = name.slice(0, -'-foreground'.length);
    if (tokens.has(surface)) pairs.push([name, surface]);
  }
  if (tokens.has('--foreground') && tokens.has('--background')) {
    pairs.push(['--foreground', '--background']);
  }

  const findings: ContrastFinding[] = [];
  for (const [foreground, background] of pairs) {
    const foregroundValue = tokens.get(foreground)!;
    const backgroundValue = tokens.get(background)!;
    const ratio = contrastRatio(foregroundValue, backgroundValue);
    if (ratio === null) continue; // not a hex; not measurable, so not claimed
    if (ratio >= AA_NORMAL_TEXT) continue;
    findings.push({
      foreground,
      background,
      foregroundValue,
      backgroundValue,
      ratio,
    });
  }
  return findings;
}
