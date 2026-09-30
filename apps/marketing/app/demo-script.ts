import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import type { StylePresetId } from '@vibld/ai/style-presets';

import type { DemoSite } from './demo-sites.ts';

/**
 * What the home page's demonstration writes into its code pane.
 *
 * Illustrations of the kind of file vibld produces, not output: the page
 * says, next to the builder, that nothing here calls a model. They are kept
 * plausible on purpose (the stack is the one `@vibld/ai/stack` pins, the
 * spec file is the DESIGN.md `@vibld/ai/design-spec` writes, and the check
 * names are ones `design-checks.ts` reports) so that what the drawing shows
 * is the shape of the real thing.
 */

export function appLines(site: DemoSite): string[] {
  const t = site.text;
  return [
    "import { motion } from 'motion/react';",
    "import { ArrowRight } from 'lucide-react';",
    "import { Button } from '@/components/ui/button';",
    `import { ${site.section} } from './components/${site.section}';`,
    '',
    'export default function App() {',
    '  return (',
    '    <main className="min-h-svh bg-background text-foreground">',
    `      <Nav brand="${t.brand}" />`,
    '      <section className="grid gap-10 px-6 py-20 lg:grid-cols-2">',
    '        <div className="flex flex-col gap-5">',
    `          <p className="font-mono text-xs uppercase">${t.eyebrow}</p>`,
    '          <motion.h1',
    '            initial={{ opacity: 0, y: 8 }}',
    '            animate={{ opacity: 1, y: 0 }}',
    '            className="font-display text-5xl tracking-tight">',
    `            ${t.headline}`,
    '          </motion.h1>',
    `          <Button size="lg">${t.primary} <ArrowRight /></Button>`,
    '        </div>',
    '        <HeroArt />',
    '      </section>',
    `      <${site.section} items={['${t.cards[0][0]}', '${t.cards[1][0]}', '${t.cards[2][0]}']} />`,
    '    </main>',
    '  );',
    '}',
  ];
}

/**
 * Which lines of `appLines` belong to which region of the drawing, so the
 * region appears while its lines are written.
 */
export const APP_CHUNKS = [
  ['Nav', 0, 9],
  ['Hero', 9, 12],
  ['HeroCopy', 12, 20],
  ['HeroArt', 20, 22],
  ['Section', 22, 26],
] as const;

export function specLines(site: DemoSite): string[] {
  const c = site.colors;
  return [
    '# DESIGN.md',
    'direction: A',
    '',
    '## palette',
    `background  ${c.page.fill}`,
    `foreground  ${c.page.ink}`,
    `primary     ${c.primary.fill}`,
    '',
    '## type',
    'display  grotesk, tight tracking',
    '',
    '## motion',
    'enter 200ms ease-out',
    'prefers-reduced-motion: honored',
  ];
}

export function checkLines(site: DemoSite): string[] {
  return [
    '$ design checks against DESIGN.md',
    `pass  color           ${site.colors.primary.fill} in src/styles.css`,
    'pass  font            display face loaded',
    'pass  lang            <html lang="en">',
    'pass  alt             every image has alt text',
    'error reduced-motion  no prefers-reduced-motion rule',
    'repair  one pass, a patch',
    'pass  reduced-motion  rule added',
    'clean 0 errors, preview ready',
  ];
}

export function specCss(site: DemoSite): string[] {
  const c = site.colors;
  return [
    '/* DESIGN.md: direction A */',
    '@theme {',
    `  --color-background: ${c.page.fill};`,
    `  --color-foreground: ${c.page.ink};`,
    `  --color-primary: ${c.primary.fill};`,
    '  --radius-lg: 10px;',
    '}',
  ];
}

/** The treatment, as the few lines of CSS that carry it. */
const TREATMENT_CSS: Partial<Record<StylePresetId, string[]>> = {
  glassmorphism: [
    '.panel {',
    '  @apply rounded-2xl border border-white/60;',
    '  @apply bg-card/60 backdrop-blur-md backdrop-saturate-150;',
    '}',
    '/* motion: blur and scale arrive together, 250ms */',
  ],
  neumorphism: [
    '.raised {',
    '  box-shadow: 7px 7px 16px var(--shade),',
    '    -7px -7px 16px var(--light);',
    '}',
    '/* motion: the shadow pair swaps on press */',
  ],
  brutalism: [
    '.card {',
    '  @apply rounded-none border-[3px] border-foreground;',
    '  @apply shadow-[5px_5px_0] shadow-foreground;',
    '}',
    '/* motion: hard cuts, 0 to 80ms */',
  ],
  minimalist: [
    '.card { @apply border-0 border-t shadow-none; }',
    'h1 { @apply font-medium tracking-tight; }',
    '/* motion: opacity only, around 150ms */',
  ],
  editorial: [
    'h1 { @apply font-serif italic font-normal; }',
    '.rule { @apply border-t-2 border-foreground; }',
    '.feature img { @apply grayscale; }',
    '/* motion: 350 to 600ms, zero overshoot */',
  ],
  retrowave: [
    'h1 {',
    '  @apply uppercase italic;',
    '  @apply text-shadow-lg text-shadow-primary/70;',
    '}',
    '.horizon { animation: grid 1.4s linear infinite; }',
  ],
  aurora: [
    '.field { animation: drift 16s ease-in-out infinite; }',
    '.panel {',
    '  @apply rounded-2xl bg-card/70 backdrop-blur-xl;',
    '}',
  ],
  claymorphism: [
    '.clay {',
    '  @apply rounded-[26px];',
    '  box-shadow: inset 6px 6px 12px #fff9,',
    '    10px 14px 26px #0002;',
    '}',
  ],
  liquidGlass: [
    '.glass {',
    '  @apply rounded-[22px] backdrop-blur-sm backdrop-saturate-200;',
    '  box-shadow: inset 0 1px 0 #fff8, 0 10px 26px #0005;',
    '}',
  ],
  bentoGrid: [
    '.bento { @apply grid grid-cols-6 gap-3; }',
    '.tile { @apply rounded-[18px] bg-card p-6; }',
    '/* motion: tiles stagger in, 30 to 60ms apart */',
  ],
  vibrantBlocks: [
    '.block { @apply rounded-[14px] shadow-none; }',
    'button { @apply rounded-full; }',
    '/* motion: 100 to 250ms, snaps in from an edge */',
  ],
};

/**
 * The stylesheet a re-skin writes. A direction with its own palette shows
 * its real tokens, read from the preset; a treatment shows its CSS.
 */
export function lookCss(id: StylePresetId): string[] {
  const preset = STYLE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return [];
  const head = `/* preset: ${preset.name.toLowerCase()}, ${preset.description.toLowerCase()} */`;
  const tokens = preset.tokens;
  if (tokens) {
    return [
      head,
      '@theme {',
      `  --color-background: ${tokens.colors.background};`,
      `  --color-foreground: ${tokens.colors.foreground};`,
      `  --color-primary: ${tokens.colors.primary};`,
      `  --color-accent: ${tokens.colors.accent};`,
      `  --radius-lg: ${tokens.radius.lg};`,
      '}',
      `/* headings: ${tokens.typography.headingFont} */`,
    ];
  }
  return [head, ...(TREATMENT_CSS[id] ?? [])];
}

/** The build's steps, as the progress strip names them. */
export const STEPS = [
  'prompt',
  'directions',
  'spec',
  'build',
  'checks',
  'preview',
] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  prompt: 'Prompt',
  directions: 'Directions',
  spec: 'Spec',
  build: 'Build',
  checks: 'Checks',
  preview: 'Preview',
};

/** The run log, in order. */
export const LOG = [
  'Direction A chosen',
  'DESIGN.md written',
  'Built: React 19, Vite, Tailwind v4',
  'Design checks: 1 repair, then clean',
  'Private preview ready',
] as const;

/** What a screen reader is told as each step starts. */
export const STEP_ANNOUNCEMENTS: Record<Step, string> = {
  prompt: 'Typing the request.',
  directions: 'Sketching three directions.',
  spec: 'Writing DESIGN.md.',
  build: 'Building src/App.tsx, region by region.',
  checks: 'Running design checks. One error, repaired.',
  preview: 'Preview ready.',
};

/** One highlighted run of a line: a class name, or none, and its text. */
export interface Token {
  kind:
    | 'comment'
    | 'string'
    | 'keyword'
    | 'tag'
    | 'number'
    | 'ok'
    | 'bad'
    | 'note'
    | null;
  text: string;
}

const PATTERN =
  /(\/\*.*?\*\/|\/\/.*$|^#.*$)|('[^']*'|"[^"]*")|(\b(?:import|from|export|default|function|return|const)\b|@theme|@apply)|(<\/?[A-Za-z.]+|\/?>)|(#[0-9A-Fa-f]{6}\b|\b\d+(?:\.\d+)?(?:px|ms|s)?\b)|(^pass\b|^clean\b)|(^error\b)|(^repair\b)/g;

/**
 * A deliberately small highlighter: enough to make a code pane read as
 * code, returned as data so the pane renders it with React rather than
 * with `innerHTML`.
 */
export function highlight(line: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  PATTERN.lastIndex = 0;
  for (let match = PATTERN.exec(line); match; match = PATTERN.exec(line)) {
    if (match[0] === '') {
      PATTERN.lastIndex++;
      continue;
    }
    if (match.index > last)
      out.push({ kind: null, text: line.slice(last, match.index) });
    const kind: Token['kind'] = match[1]
      ? 'comment'
      : match[2]
        ? 'string'
        : match[3]
          ? 'keyword'
          : match[4]
            ? 'tag'
            : match[5]
              ? 'number'
              : match[6]
                ? 'ok'
                : match[7]
                  ? 'bad'
                  : 'note';
    out.push({ kind, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push({ kind: null, text: line.slice(last) });
  return out;
}
