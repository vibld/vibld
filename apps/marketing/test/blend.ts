/**
 * `top` at `alpha` over `bottom`, in sRGB, as a browser composites a
 * translucent fill (and as `color-mix(in srgb, ...)` mixes). Six-digit hex in,
 * six-digit hex out, so the result goes straight into `contrastRatio`.
 */
export function blend(top: string, alpha: number, bottom: string): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const a = channels(top);
  const b = channels(bottom);
  return `#${a
    .map((value, index) =>
      Math.round(value * alpha + b[index]! * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
