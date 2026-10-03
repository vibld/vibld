/**
 * Imports Drummond-IT/designs-v1's style gallery
 * (`style-gallery-patterns/style-gallery-patterns.json`, 1,342 style
 * presets) into `packages/ai/data/style-gallery.json` (docs/decisions.md,
 * D142). It is generated: change this script, or the catalog, and run it
 * again, never the output.
 *
 *   node --experimental-strip-types bin/import-style-gallery.ts \
 *     <designs-v1 checkout> [--check]
 *
 * Each run upserts by `id` against what is already stored: a new id is
 * added, a changed entry replaced, and an id the source no longer has is
 * dropped. Running it twice in a row changes nothing. `--check` writes
 * nothing and exits non-zero if the stored file is not what an import would
 * write, which is how a test proves the two agree.
 *
 * What it changes in the catalog's words, and only this: UK spellings in
 * what people read become US English (D120), and an em-dash becomes `--`
 * (D87). `id`, colors, tokens and contrast pairs are never touched.
 *
 * It refuses to write anything if a check in `checkStyleGallery` fails: a
 * missing field or prompt section, an id or name repeated here or already
 * used by the design template catalog or a style preset, a font off the
 * source's Google Fonts allowlist, a type step below 12px or no 16px body
 * step, a URL, a recorded contrast pair below its target, or a decorative
 * color carrying text.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toUsEnglish } from '../../../scripts/us-english.mjs';
import { DESIGN_TEMPLATE_INDEX } from '../src/design-template-index.ts';
import { STYLE_PRESETS } from '../src/style-presets.ts';
import {
  checkStyleGallery,
  parseStyleGallery,
  serializeStyleGallery,
  styleGalleryIndexModule,
  upsertStyleGallery,
} from '../src/style-gallery.ts';
import type {
  StyleGalleryCatalog,
  StyleGalleryChanges,
  StyleGalleryEntry,
} from '../src/style-gallery.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STYLE_GALLERY_FILE = resolve(HERE, '../data/style-gallery.json');
export const STYLE_GALLERY_INDEX_FILE = resolve(
  HERE,
  '../data/style-gallery-index.ts',
);
export const SOURCE_PATH = 'style-gallery-patterns';

const EM_DASH = String.fromCodePoint(0x2014);

/** Keys whose values code reads, never people: left exactly as they are. */
const VERBATIM = new Set(['id', 'hex', 'token', 'fg', 'bg', 'font']);

/** One string, in the house style: US English and no em-dash. */
function house(text: string): string {
  return toUsEnglish(
    text.replace(new RegExp(`\\s*${EM_DASH}\\s*`, 'g'), ' -- '),
  );
}

/** Every readable string in `value`, through `house`. */
function housed<T>(value: T, key = ''): T {
  if (typeof value === 'string') {
    return (VERBATIM.has(key) ? value : house(value)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => housed(v, key)) as T;
  if (value && typeof value === 'object') {
    // `design_tokens.fonts` names families, which are proper names.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === 'fonts' ? v : housed(v, k),
      ]),
    ) as T;
  }
  return value;
}

/** The families the source's `scripts/fonts_allowlist.py` allows. */
export function readFontAllowlist(checkout: string): Set<string> {
  const file = join(checkout, SOURCE_PATH, 'scripts', 'fonts_allowlist.py');
  const text = readFileSync(file, 'utf8');
  const body = text.slice(text.indexOf('ALLOW'));
  return new Set([...body.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]));
}

/** Ids and names other catalogs already use, lower case. */
export function takenNames(): Set<string> {
  const taken = new Set<string>();
  for (const design of DESIGN_TEMPLATE_INDEX) {
    taken.add(design.id.toLowerCase());
    taken.add(design.name.toLowerCase());
  }
  for (const preset of STYLE_PRESETS) {
    taken.add(preset.id.toLowerCase());
    taken.add(preset.name.toLowerCase());
  }
  return taken;
}

function lastCommit(checkout: string): string | null {
  try {
    return (
      execFileSync(
        'git',
        ['-C', checkout, 'log', '-1', '--format=%H', '--', SOURCE_PATH],
        {
          encoding: 'utf8',
        },
      ).trim() || null
    );
  } catch {
    return null;
  }
}

/** The source catalog, read and put in the house style. */
export function readSource(checkout: string): StyleGalleryCatalog {
  const file = join(checkout, SOURCE_PATH, 'style-gallery-patterns.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    title: string;
    updated: string;
    count: number;
    baseline_rules_markdown: string;
    entries: StyleGalleryEntry[];
  };
  if (raw.count !== raw.entries.length) {
    throw new Error(
      `${file}: count ${raw.count} but ${raw.entries.length} entries`,
    );
  }
  return {
    title: house(raw.title),
    updated: raw.updated,
    source: {
      repository: 'Drummond-IT/designs-v1',
      path: SOURCE_PATH,
      commit: lastCommit(checkout),
    },
    baseline_rules_markdown: house(raw.baseline_rules_markdown),
    entries: raw.entries.map((entry) => housed(entry)),
  };
}

export function readStored(
  file = STYLE_GALLERY_FILE,
): StyleGalleryCatalog | null {
  return existsSync(file)
    ? parseStyleGallery(readFileSync(file, 'utf8'))
    : null;
}

/**
 * One import, without writing: the catalog an import produces from
 * `checkout` on top of `stored`, what it changed, and every problem found.
 */
export function importStyleGallery(
  checkout: string,
  stored: StyleGalleryCatalog | null,
): {
  catalog: StyleGalleryCatalog;
  changes: StyleGalleryChanges;
  problems: string[];
} {
  const source = readSource(checkout);
  const problems = checkStyleGallery(source, {
    fonts: readFontAllowlist(checkout),
    taken: takenNames(),
  });
  const { catalog, changes } = upsertStyleGallery(stored, source);
  return { catalog, changes, problems };
}

function main(argv: string[]): number {
  const check = argv.includes('--check');
  const checkout = argv.find((arg) => !arg.startsWith('--'));
  if (!checkout) {
    console.error(
      'usage: import-style-gallery.ts <designs-v1 checkout> [--check]',
    );
    return 2;
  }
  const stored = readStored();
  const { catalog, changes, problems } = importStyleGallery(
    resolve(checkout),
    stored,
  );
  if (problems.length > 0) {
    for (const problem of problems.slice(0, 200)) console.error(problem);
    console.error(`${problems.length} problems; nothing written`);
    return 1;
  }
  const text = serializeStyleGallery(catalog);
  const current = existsSync(STYLE_GALLERY_FILE)
    ? readFileSync(STYLE_GALLERY_FILE, 'utf8')
    : null;
  const indexText = styleGalleryIndexModule(catalog);
  const currentIndex = existsSync(STYLE_GALLERY_INDEX_FILE)
    ? readFileSync(STYLE_GALLERY_INDEX_FILE, 'utf8')
    : null;
  const summary =
    `${catalog.entries.length} styles: ${changes.added.length} added, ` +
    `${changes.updated.length} updated, ${changes.removed.length} removed, ` +
    `${changes.unchanged} unchanged`;
  if (check) {
    console.log(summary);
    if (current !== text) {
      console.error(`${STYLE_GALLERY_FILE} is not what an import writes`);
      return 1;
    }
    if (currentIndex !== indexText) {
      console.error(`${STYLE_GALLERY_INDEX_FILE} is not what an import writes`);
      return 1;
    }
    return 0;
  }
  if (current !== text) writeFileSync(STYLE_GALLERY_FILE, text);
  if (currentIndex !== indexText) {
    writeFileSync(STYLE_GALLERY_INDEX_FILE, indexText);
  }
  console.log(`${summary} -> ${STYLE_GALLERY_FILE}`);
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
