/**
 * The token blocks every guidance source emits, in the one shape Tailwind v4
 * and shadcn/ui read (ADR-0014).
 *
 * Colours go on `:root` under shadcn's names (`--primary`), and `@theme
 * inline` maps each to Tailwind's colour namespace (`--color-primary:
 * var(--primary)`), which is what makes `bg-primary` and `bg-primary/80`
 * exist. The two names differ on purpose: a theme variable that pointed at a
 * `:root` variable of its own name would be a self-reference, which only
 * resolves because unlayered `:root` happens to beat Tailwind's theme layer.
 *
 * Radius and shadow values have no shadcn name to keep, so they go straight
 * into `@theme` as literals under Tailwind's own namespaces, which is what
 * makes `rounded-md` and `shadow-medium` mean this design's values rather
 * than Tailwind's defaults. Durations are not a Tailwind namespace and stay
 * on `:root`.
 *
 * `palettes.ts`, `palette-derive.ts` and `style-presets.ts` all emit through
 * this, so the model sees one contract whichever source supplied the values.
 */

export interface ColorTokens {
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
}

export interface ShapeTokens {
  radius?: { sm: string; md: string; lg: string; pill: string };
  shadow?: { low: string; medium: string; high: string };
  motion?: { quick: string; standard: string; slow: string };
}

/** shadcn's pairs, in the order a reader scans them. */
function colorLines(c: ColorTokens): string[] {
  return [
    `--primary: ${c.primary}; --primary-foreground: ${c.onPrimary};`,
    `--secondary: ${c.secondary}; --secondary-foreground: ${c.onSecondary};`,
    `--accent: ${c.accent}; --accent-foreground: ${c.onAccent};`,
    `--background: ${c.background}; --foreground: ${c.foreground};`,
    `--card: ${c.card}; --card-foreground: ${c.cardForeground};`,
    `--muted: ${c.muted}; --muted-foreground: ${c.mutedForeground};`,
    `--border: ${c.border}; --ring: ${c.primary};`,
    `--destructive: ${c.destructive}; --destructive-foreground: ${c.onDestructive};`,
  ];
}

const COLOR_NAMES = [
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'background',
  'foreground',
  'card',
  'card-foreground',
  'muted',
  'muted-foreground',
  'border',
  'ring',
  'destructive',
  'destructive-foreground',
];

/**
 * The CSS for these tokens: a `:root` block and the `@theme inline` block
 * that maps it into Tailwind. Either half may be empty of one kind of
 * token; a block with nothing in it is left out.
 */
export function tokenCss(
  colors: ColorTokens | undefined,
  shape: ShapeTokens = {},
): string {
  const root: string[] = colors ? colorLines(colors) : [];
  if (shape.motion) {
    root.push(
      `--duration-quick: ${shape.motion.quick}; --duration-standard: ${shape.motion.standard};`,
      `--duration-slow: ${shape.motion.slow};`,
    );
  }
  const theme: string[] = colors
    ? COLOR_NAMES.map((name) => `--color-${name}: var(--${name});`)
    : [];
  if (shape.radius) {
    theme.push(
      `--radius-sm: ${shape.radius.sm}; --radius-md: ${shape.radius.md};`,
      `--radius-lg: ${shape.radius.lg}; --radius-pill: ${shape.radius.pill};`,
    );
  }
  if (shape.shadow) {
    theme.push(
      `--shadow-low: ${shape.shadow.low};`,
      `--shadow-medium: ${shape.shadow.medium};`,
      `--shadow-high: ${shape.shadow.high};`,
    );
  }
  const block = (head: string, lines: string[]) =>
    lines.length === 0
      ? ''
      : `${head} {\n${lines.map((line) => `  ${line}`).join('\n')}\n}`;
  return [block(':root', root), block('@theme inline', theme)]
    .filter(Boolean)
    .join('\n\n');
}

/** How to use the blocks, said the same way by every source. */
export const TOKEN_USE = `Put these in src/styles.css after the imports. The @theme block is what makes the utilities use them (bg-primary, text-muted-foreground, bg-primary/80, rounded-md, shadow-medium), so reference them through utilities and never as repeated hex values.`;

/** A Google Fonts stylesheet import, which has to precede `@import "tailwindcss"`. */
export function fontImport(url: string): string {
  return `Import both with @import url('${url}'); as the first line of src/styles.css, before @import "tailwindcss".`;
}
