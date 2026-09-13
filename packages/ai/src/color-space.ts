/**
 * The colour arithmetic a palette has to do, in the smallest form that does
 * it correctly.
 *
 * `contrast.ts` answers "does this pair pass?". This answers the harder
 * question a generated palette actually needs: "what colour, of this hue,
 * passes?" Those are different jobs, and only the second one lets a
 * catalogue be derived rather than hand-checked.
 *
 * That distinction is the whole reason this file exists. A hand-written
 * palette is verified after the fact, so a failing pair is a bug someone has
 * to notice. A derived palette is built by moving lightness until the pair
 * passes, so a failing pair is not reachable: `shadeMeeting` either returns a
 * colour that clears the ratio or returns null and the seed is rejected.
 *
 * Pure arithmetic, same as `contrast.ts`: no dependency, no canvas, no colour
 * library, so it runs in the Worker, in the browser bundle and under
 * `node --test` without any of them knowing the difference.
 *
 * HSL rather than OKLCH deliberately. OKLCH is the better space for
 * perceptually even ramps, and it would need either a dependency or another
 * hundred lines of matrix maths to go from OKLCH back to sRGB hex. What the
 * ramps here are actually judged on is WCAG contrast, which is measured in
 * sRGB luminance, and that is measured directly rather than approximated. So
 * the space only has to be good enough to move lightness monotonically while
 * holding a hue, and HSL is.
 */

import { contrastRatio, parseHex } from './contrast.ts';

export interface Hsl {
  /** Degrees, 0 to 359. */
  hue: number;
  /** Percent, 0 to 100. */
  saturation: number;
  /** Percent, 0 to 100. */
  lightness: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Degrees, wrapped into 0 to 359, so callers can rotate a hue freely. */
export function normaliseHue(hue: number): number {
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function channelToHex(channel: number): string {
  return Math.round(clamp(channel, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * HSL to a 6-digit hex, which is the only form `contrast.ts` accepts and the
 * only form this package's catalogues are written in.
 */
export function hslToHex({ hue, saturation, lightness }: Hsl): string {
  const h = normaliseHue(hue) / 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;

  if (s === 0) {
    const grey = channelToHex(l);
    return `#${grey}${grey}${grey}`;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toChannel = (t: number): number => {
    let shifted = t;
    if (shifted < 0) shifted += 1;
    if (shifted > 1) shifted -= 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };

  return `#${channelToHex(toChannel(h + 1 / 3))}${channelToHex(toChannel(h))}${channelToHex(toChannel(h - 1 / 3))}`;
}

/** A 6-digit hex back to HSL, or null if it is not one. */
export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness: lightness * 100 };
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  return {
    hue: normaliseHue(hue * 60),
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

/**
 * Whichever of near-black and near-white reads better on `fill`, or null if
 * neither clears `ratio`.
 *
 * Pure black and pure white are deliberately not used. A generated page puts
 * this colour on a filled button in quantity, and #000 on a saturated fill
 * is the harsher of the two options at the same measured ratio. These two
 * are still within a whisker of the extremes, so what is given up is a
 * fraction of a point of contrast, not a pass.
 */
export function readableOn(
  fill: string,
  ratio = 4.5,
): { color: string; ratio: number } | null {
  const candidates = ['#12100e', '#fdfcfa'];
  let best: { color: string; ratio: number } | null = null;
  for (const candidate of candidates) {
    const measured = contrastRatio(candidate, fill);
    if (measured === null) continue;
    if (!best || measured > best.ratio)
      best = { color: candidate, ratio: measured };
  }
  return best && best.ratio >= ratio ? best : null;
}

/**
 * A colour of this hue and saturation that clears `ratio` against `ground`,
 * or null if no lightness of that hue can.
 *
 * Binary search on lightness rather than a fixed ramp, because the lightness
 * at which a hue clears a ratio is not the same for every hue: pure yellow is
 * far more luminous than pure blue at the same HSL lightness, so any fixed
 * ramp is either too conservative for one and failing for the other. Solving
 * per hue is what makes one derivation work across the whole wheel.
 *
 * `direction` says which side of the ground to search. Both are tried by
 * `shadeAgainst` below; on a mid-tone ground only one of them usually exists.
 */
export function shadeMeeting(
  hue: number,
  saturation: number,
  ground: string,
  ratio: number,
  direction: 'darker' | 'lighter',
): string | null {
  const groundHsl = hexToHsl(ground);
  if (!groundHsl) return null;

  const at = (lightness: number) => hslToHex({ hue, saturation, lightness });

  // Named for what they hold rather than for where they sit, because the
  // first version of this named them "far" and "near" and then updated each
  // one with the other's value: a passing probe moved the failing bound. The
  // search still terminated and still returned a colour, and the colour
  // failed the ratio it was searching for. With these names the update is
  // only writable one way round.
  let passing = direction === 'darker' ? 0 : 100;
  let failing = groundHsl.lightness;

  // The extreme end carries the most contrast this hue can reach. If even
  // that falls short, no lightness of this hue works against this ground.
  const best = contrastRatio(at(passing), ground);
  if (best === null || best < ratio) return null;

  // 12 halvings take a 100-point range below 0.03, finer than the 8-bit
  // channel this resolves to can express anyway.
  for (let i = 0; i < 12; i += 1) {
    const middle = (passing + failing) / 2;
    const measured = contrastRatio(at(middle), ground);
    if (measured !== null && measured >= ratio) passing = middle;
    else failing = middle;
  }

  // `passing` only ever moves to another passing value, so it ends as the
  // least extreme shade that still clears the ratio: the closest this hue
  // can sit to the ground and stay readable on it.
  const result = at(passing);
  const check = contrastRatio(result, ground);
  return check !== null && check >= ratio ? result : null;
}

/**
 * A readable shade of this hue against `ground`, trying the darker side
 * first and then the lighter, or null if neither works.
 *
 * Darker first because a tinted dark on a light ground is the commoner case
 * in the catalogues this serves, and on a light ground it is also the side
 * that keeps the hue recognisable: pushing a hue lighter washes it out
 * towards the ground long before it washes darker towards black.
 */
export function shadeAgainst(
  hue: number,
  saturation: number,
  ground: string,
  ratio: number,
): string | null {
  const groundHsl = hexToHsl(ground);
  const preferLighter = (groundHsl?.lightness ?? 50) < 50;
  const order: ('darker' | 'lighter')[] = preferLighter
    ? ['lighter', 'darker']
    : ['darker', 'lighter'];
  for (const direction of order) {
    const found = shadeMeeting(hue, saturation, ground, ratio, direction);
    if (found) return found;
  }
  return null;
}

/**
 * `lightness` moved by `delta` points, holding hue and saturation.
 *
 * For the surfaces that sit near the background rather than against it:
 * cards, sunken wells, hairlines. Those are not text, so they are not
 * contrast-solved; they just need to be a step away from their neighbour.
 */
export function shiftLightness(hex: string, delta: number): string | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  return hslToHex({ ...hsl, lightness: clamp(hsl.lightness + delta, 0, 100) });
}
