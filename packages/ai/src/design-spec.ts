import { asciiLower, onScreen, scanLiveMarkup } from './live-markup.ts';
import { z } from 'zod';

/**
 * The design a project is built to, as measured values rather than
 * adjectives.
 *
 * Before this, the build call went straight from a request to files, and
 * the only record of the design was a DESIGN.md the model wrote after the
 * fact, which nothing read except the model on its next turn. That leaves
 * every decision to drift: "a deep navy" is a different colour on each
 * turn, "an airy layout" is whatever the model reaches for, and there is
 * nothing to check the finished page against.
 *
 * A spec that names values ("rgba(2,10,18,.57)", "clamp(4.3rem, 8.8vw,
 * 8.3rem)", "50px pill, 1px rgba(255,255,255,.22) border, blur(18px)"),
 * copy verbatim, what changes at each width, what not to add, and what
 * a reviewer should be able to see is what makes a page reproducible, and
 * it is what `design-checks.ts` verifies the build against.
 *
 * Written by the same call that writes the files, first, so it is decided
 * before the code that implements it rather than described afterwards. A
 * separate call would buy nothing the ordering does not, at the price of a
 * second round trip and a second reservation.
 *
 * Deliberately loose on vocabulary. Roles and names are free text, because
 * a fixed list either misses what a page has or forces the model to file a
 * value under the wrong name. What is fixed is that every entry is a value
 * the CSS or the copy actually uses.
 */

const Named = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
});

export const DesignSpecSchema = z.object({
  /** The subject, the audience and the page's single job, in one sentence. */
  intent: z.string().min(1),
  tokens: z.object({
    colors: z
      .array(
        z.object({
          /** The custom property's name without its dashes: `primary`. */
          name: z.string().min(1),
          /** Exactly as the CSS writes it: `#07121c`, `rgba(2,10,18,.57)`. */
          value: z.string().min(1),
          /** What it is for: "page background", "hero scrim, top". */
          use: z.string().min(1),
        }),
      )
      .min(1),
    fonts: z
      .array(
        z.object({
          /** display, body, mono, ... */
          role: z.string().min(1),
          family: z.string().min(1),
          fallback: z.string().min(1),
          weights: z.array(z.number()),
        }),
      )
      .min(1),
    type: z
      .array(
        z.object({
          name: z.string().min(1),
          size: z.string().min(1),
          lineHeight: z.string().min(1),
          letterSpacing: z.string().min(1),
        }),
      )
      .min(1),
    space: z.array(Named),
    radii: z.array(Named),
    /** Blurs, shadows, gradients and overlays, as full CSS values. */
    effects: z.array(Named),
  }),
  sections: z
    .array(
      z.object({
        id: z.string().min(1),
        purpose: z.string().min(1),
        /** Measurements, not mood: widths, alignment, spacing. */
        layout: z.string().min(1),
        /** Every visible string in the section, verbatim. */
        copy: z.array(
          z.object({
            role: z.string().min(1),
            text: z.string().min(1),
          }),
        ),
      }),
    )
    .min(1),
  breakpoints: z.array(
    z.object({
      maxWidth: z.number(),
      changes: z.array(z.string().min(1)).min(1),
    }),
  ),
  /** Rules that name a real token or value. */
  do: z.array(z.string().min(1)),
  /** What this design must not add, and what each would break. */
  avoid: z.array(z.string().min(1)),
  /** Observable facts a reviewer can confirm with the page open. */
  checks: z.array(z.string().min(1)),
});

export type DesignSpec = z.infer<typeof DesignSpecSchema>;

export const DESIGN_MD_PATH = 'DESIGN.md';

/**
 * DESIGN.md, written from the spec rather than by the model.
 *
 * The spec itself is the frontmatter, as JSON. JSON is valid YAML, so the
 * file keeps the frontmatter-of-tokens convention every other DESIGN.md
 * reader expects, and it can be read back exactly (`readDesignSpec`) with
 * no YAML parser: the file is the spec, not a description of it.
 *
 * The body repeats only what a person needs at a glance: the intent and
 * the three lists. Tokens and copy live once, in the frontmatter, because
 * this file goes back to the model on every follow-up and a second copy is
 * paid for twice.
 */
export function renderDesignMd(spec: DesignSpec): string {
  // Pretty first; compact JSON if that is too big; then the spec itself
  // trimmed, a step at a time, until the file fits. A project whose
  // DESIGN.md is over the validator's per-file limit is rejected after its
  // model call has been paid for, and a spec asked for "every visible
  // string" can get there on a copy-heavy page.
  const attempts: (() => string)[] = [
    () => renderWith(spec, 2),
    () => renderWith(spec, 0),
    ...COMPACT_STEPS.map(
      ([chars, items]) =>
        () =>
          renderWith(compactSpec(spec, chars, items), 0),
    ),
  ];
  let rendered = '';
  for (const attempt of attempts) {
    rendered = attempt();
    if (utf8Bytes(rendered) <= MAX_DESIGN_MD_BYTES) return rendered;
  }
  return rendered;
}

/**
 * The most a rendered DESIGN.md may be, in UTF-8 bytes: well inside the
 * generation validator's 128 KiB per file, with room for the model's own
 * edits to the rest of the project to be unaffected by it.
 */
export const MAX_DESIGN_MD_BYTES = 96 * 1024;

/** Longest string, then most entries per list, tried in turn. */
const COMPACT_STEPS: [number, number][] = [
  [400, 40],
  [200, 20],
  [120, 12],
  [60, 6],
  [30, 3],
];

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The spec with every string cut to `chars` and every list to `items`,
 * keeping the first of each, so it is still a spec `DesignSpecSchema`
 * accepts: every required list keeps at least one entry and every string
 * at least one character. The copy that is cut is copy the design checks
 * will then warn about, never refuse.
 */
function compactSpec(
  spec: DesignSpec,
  chars: number,
  items: number,
): DesignSpec {
  const cut = (value: unknown): unknown => {
    if (typeof value === 'string') return [...value].slice(0, chars).join('');
    if (Array.isArray(value)) return value.slice(0, items).map(cut);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, cut(entry)]),
      );
    }
    return value;
  };
  return cut(spec) as DesignSpec;
}

function renderWith(spec: DesignSpec, indent: number): string {
  const list = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None.';
  return `---
${JSON.stringify(spec, null, indent)}
---

# Design

${spec.intent}

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

${list(spec.do)}

## Don't

${list(spec.avoid)}

## Checks

${list(spec.checks)}
`;
}

/**
 * The spec a DESIGN.md was written from, or `undefined` when it was not
 * written by `renderDesignMd` (a project from before specs, or one a
 * person edited into another shape).
 *
 * Never throws: a project without a readable spec is still a project, and
 * whatever reads this decides what its absence means.
 */
export function readDesignSpec(markdown: string): DesignSpec | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(match[1]!);
  } catch {
    return undefined;
  }
  const parsed = DesignSpecSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A percent-encoded value, decoded, or left as it was when it is not valid
 * encoding. A mockup or a reference page can carry any URL at all, and one
 * malformed escape (`family=Bad%ZZ`) must cost that one measurement, not
 * the request it is part of.
 */
function decodeLeniently(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The `@media` blocks in `css` that cannot apply on a screen (print,
 * speech, `not screen`), as a test of whether a position is inside one: a
 * shared stylesheet's print section describes paper, not the design.
 *
 * One pass. A block that applies is not walked at all; one that does not
 * is walked once to its close and everything inside it, nested `@media`
 * included, is skipped. Braces inside strings do not count.
 */
function offScreenBlocks(
  css: string,
  inString: (at: number) => boolean,
): (at: number) => boolean {
  const lower = asciiLower(css);
  const ranges: number[] = [];
  let brace = -1;
  let at = 0;
  for (;;) {
    const found = lower.indexOf('@media', at);
    if (found === -1) break;
    at = found + 6;
    if (inString(found)) continue;
    if (brace < found) brace = css.indexOf('{', found);
    if (brace === -1) break;
    if (onScreen(css.slice(found + 6, brace))) continue;
    let depth = 0;
    let end = css.length;
    for (let index = brace; index < css.length; index += 1) {
      const char = css[index];
      if ((char !== '{' && char !== '}') || inString(index)) continue;
      depth += char === '{' ? 1 : -1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
    ranges.push(found, end);
    at = end;
  }
  return (position) => {
    let low = 0;
    let high = ranges.length / 2 - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (position < ranges[middle * 2]!) high = middle - 1;
      else if (position >= ranges[middle * 2 + 1]!) low = middle + 1;
      else return true;
    }
    return false;
  };
}

/**
 * CSS with its comments removed, and where its strings are, in one pass.
 *
 * A commented-out rule is one the page stopped using, so comments go. A
 * string stays, because `font-family: 'Playfair Display'` needs its quotes,
 * but a declaration that starts inside one (`content: "font-size: 99px"`,
 * a pseudo-element's code sample) is text, and `inString` is how the
 * readers below tell. An unclosed comment runs to the end, as in CSS; an
 * unclosed string runs to the end of its line, which is where CSS ends a
 * bad string.
 */
function readCss(css: string): {
  text: string;
  inString: (at: number) => boolean;
} {
  const kept: string[] = [];
  /** `[start, end)` pairs, in positions of `text`. */
  const strings: number[] = [];
  let length = 0;
  const keep = (from: number, to: number) => {
    kept.push(css.slice(from, to));
    length += to - from;
  };
  let from = 0;
  let at = 0;
  while (at < css.length) {
    const char = css[at];
    if (char === '/' && css[at + 1] === '*') {
      keep(from, at);
      kept.push(' ');
      length += 1;
      const close = css.indexOf('*/', at + 2);
      at = close === -1 ? css.length : close + 2;
      from = at;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = at + 1;
      // A string ends at its own quote, or unclosed at a newline (`\n`,
      // `\r` or a form feed), as CSS ends a bad string. A backslash escapes
      // the next character, and an escaped CRLF is one newline, so the
      // string runs on past it.
      while (
        end < css.length &&
        css[end] !== char &&
        !/[\n\r\f]/.test(css[end]!)
      ) {
        if (css[end] !== '\\') {
          end += 1;
        } else {
          end += css[end + 1] === '\r' && css[end + 2] === '\n' ? 3 : 2;
        }
      }
      end = Math.min(end + 1, css.length);
      const start = length + (at - from);
      strings.push(start, start + (end - at));
      at = end;
      continue;
    }
    at += 1;
  }
  keep(from, css.length);

  const inString = (position: number): boolean => {
    let low = 0;
    let high = strings.length / 2 - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const start = strings[middle * 2]!;
      const end = strings[middle * 2 + 1]!;
      if (position < start) high = middle - 1;
      else if (position >= end) low = middle + 1;
      else return true;
    }
    return false;
  };
  return { text: kept.join(''), inString };
}

/** The largest measurement block `measureMockup` returns, in characters. */
export const MAX_MOCKUP_MEASURE_CHARS = 3_000;

/** Longest single value carried, so one runaway declaration cannot crowd out the rest. */
const MAX_VALUE_CHARS = 120;

/** Furthest a value is read looking for its end; see `valueAt`. */
const MAX_VALUE_WALK = 2_000;

/**
 * The values a chosen mockup actually uses, read from its CSS.
 *
 * The build used to receive the mockup as a document and an instruction to
 * "keep its layout, palette, type and density". A model reading 20,000
 * characters of HTML for that keeps roughly the palette and loses the rest:
 * the exact blur on a glass panel, the clamp() on the headline, the scrim's
 * alpha. Those are the values that made the direction worth choosing, so
 * they are pulled out here and handed over as numbers.
 *
 * Plain pattern matching over the CSS text, not a parser. It reads what a
 * mockup's inline `<style>` says; it cannot resolve the cascade, and does
 * not need to, because the output is a list of values to carry forward,
 * not a computed style.
 *
 * The mockup is model output that came back through a browser, so every
 * value is flattened to one line and capped, and the caller fences the
 * result as data exactly as it fences the document.
 */
export function measureMockup(html: string): string {
  return measureDesign(html);
}

/**
 * `measureMockup`, generalised: the page's own CSS plus any stylesheets it
 * links, bounded at `maxChars`.
 *
 * A reference site keeps most of its design in linked sheets rather than
 * inline, and `reference-fetch.ts` already reads those for the palette, so
 * they are measured here from the same text rather than fetched twice.
 */
export function measureDesign(
  html: string,
  options: { stylesheets?: readonly string[]; maxChars?: number } = {},
): string {
  const limit = options.maxChars ?? MAX_MOCKUP_MEASURE_CHARS;
  const live = scanLiveMarkup(html);
  // Each source on its own: a `<style>`, a `style` attribute and a fetched
  // sheet are separate to a browser, so an unclosed `/*` or string at the
  // end of one (a sheet cut off at the byte cap, say) must not swallow the
  // next. Within a source, a position is skipped when it is inside a CSS
  // string or inside an `@media` block that cannot apply on a screen.
  const sources = [
    ...live.styles,
    ...live.styleAttributes,
    ...(options.stylesheets ?? []),
  ].map((source) => {
    const { text, inString } = readCss(source);
    const offScreen = offScreenBlocks(text, inString);
    return {
      css: text,
      inString,
      skip: (at: number) => inString(at) || offScreen(at),
    };
  });
  type Source = (typeof sources)[number];
  /** Every match of `pattern` in every source, outside what is skipped. */
  const matches = function* (
    pattern: RegExp,
    start: (match: RegExpMatchArray) => number = (match) => match.index ?? 0,
  ): Generator<{ match: RegExpMatchArray; source: Source }> {
    for (const source of sources) {
      for (const match of source.css.matchAll(pattern)) {
        if (!source.skip(start(match))) yield { match, source };
      }
    }
  };
  /**
   * A declaration's value from `from` to the first `;`, `{` or `}` that is
   * not inside a CSS string, so `font-family: "ACME; Sans", serif` is the
   * whole family. Walked at most `MAX_VALUE_WALK` characters: a value is
   * cut to `MAX_VALUE_CHARS` anyway, and an unbounded walk from every
   * match would be a quadratic read of someone else's stylesheet.
   */
  const valueAt = (source: Source, from: number): string => {
    const stop = Math.min(source.css.length, from + MAX_VALUE_WALK);
    let end = from;
    while (end < stop) {
      const char = source.css[end];
      if (
        (char === ';' || char === '{' || char === '}') &&
        !source.inString(end)
      ) {
        break;
      }
      end += 1;
    }
    return source.css.slice(from, end);
  };

  const clean = (value: string) =>
    value.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_CHARS);

  const declarations = (property: string, limit: number): string[] => {
    const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*`, 'gi');
    const seen = new Set<string>();
    for (const { match, source } of matches(
      pattern,
      (found) => (found.index ?? 0) + found[0].search(/[a-z-]/i),
    )) {
      const value = clean(
        valueAt(source, (match.index ?? 0) + match[0].length),
      );
      if (value) seen.add(value);
      if (seen.size >= limit) break;
    }
    return [...seen];
  };

  // Every distinct value a property is given, not only its first: a theme
  // or a breakpoint redeclares `--surface`, and the value it switches to is
  // as much the design as the default.
  const customProperties = (() => {
    const seen = new Set<string>();
    // Only at the start of a declaration, so `.button--primary:hover` in a
    // selector is not taken for `--primary: hover`; and spelt as written,
    // because `--brandColor` and `--brandcolor` are different properties.
    for (const { match, source } of matches(
      /(?:^|[;{\s])(--[\w-]+)\s*:\s*/g,
      (found) => (found.index ?? 0) + found[0].indexOf('--'),
    )) {
      const value = clean(
        valueAt(source, (match.index ?? 0) + match[0].length),
      );
      if (value) seen.add(`${match[1]!}: ${value}`);
      if (seen.size >= 40) break;
    }
    return [...seen];
  })();

  // From stylesheet links and CSS @imports only: a font named in a comment,
  // a code sample or an ordinary <a href> is one the browser never applied.
  // An `@import` can carry its own media list (`@import url(x) print;`),
  // and a print-only import is not a font the screen design loads.
  const importUrls = [
    ...matches(
      /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;{}]*)/gi,
    ),
  ]
    .map(({ match }) => match)
    .filter((match) =>
      onScreen(
        (match[2] ?? '')
          .replace(/\b(?:layer|supports)\([^)]*\)|\blayer\b/gi, '')
          .trim() || undefined,
      ),
    )
    .map((match) => match[1]!);
  const googleFonts = [
    ...live.stylesheets.map((link) => link.href),
    ...importUrls,
  ]
    .map((url) => /fonts\.googleapis\.com\/css2?\?(.*)$/i.exec(url)?.[1])
    .filter((query): query is string => query !== undefined)
    .flatMap((query) =>
      [...query.matchAll(/family=([^&]+)/g)].map((family) =>
        clean(decodeLeniently(family[1]!.replace(/\+/g, ' '))),
      ),
    );

  const groups: [string, string[]][] = [
    ['custom properties', customProperties],
    ['fonts loaded', [...new Set(googleFonts)].slice(0, 6)],
    ['font-family', declarations('font-family', 8)],
    ['font-size', declarations('font-size', 14)],
    ['line-height', declarations('line-height', 8)],
    ['letter-spacing', declarations('letter-spacing', 8)],
    ['max-width', declarations('max-width', 8)],
    ['border-radius', declarations('border-radius', 8)],
    ['border', declarations('border', 8)],
    ['backdrop-filter', declarations('backdrop-filter', 6)],
    ['box-shadow', declarations('box-shadow', 6)],
    [
      'backgrounds',
      [
        ...declarations('background-image', 6),
        ...declarations('background', 12).filter((value) =>
          /gradient|rgba?\(|#|oklch|hsla?\(/i.test(value),
        ),
      ].slice(0, 10),
    ],
  ];

  // Filled a value at a time, round by round, so every group gets its
  // first value before any group gets its second. Filling group by group
  // let a design system's custom properties spend the whole budget, and
  // the fonts, sizes, radii and shadows after them, which are what this
  // block is for, were never reached.
  const kept = groups.map((): string[] => []);
  let length = 0;
  for (let round = 0; ; round += 1) {
    let added = false;
    groups.forEach(([label, values], index) => {
      const value = values[round];
      if (value === undefined) return;
      // A new line costs its label and newline; a further value its ` | `.
      const cost =
        round === 0 ? label.length + 2 + value.length + 1 : 3 + value.length;
      if (kept[index]!.length !== round || length + cost > limit) return;
      kept[index]!.push(value);
      length += cost;
      added = true;
    });
    if (!added) break;
  }
  const lines = groups
    .map(([label], index) =>
      kept[index]!.length > 0 ? `${label}: ${kept[index]!.join(' | ')}` : '',
    )
    .filter(Boolean);
  return lines.join('\n');
}
