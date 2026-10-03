/**
 * Copies every template's typefaces, and every gallery style's (D143), into
 * this site (docs/decisions.md, D104), so /templates and /styles/gallery
 * draw each design in its own type without a
 * visitor's browser asking Google for anything:
 *
 *   node --experimental-strip-types scripts/template-fonts.ts
 *
 * Each family comes from its Fontsource package on npm, the source of this
 * site's own fonts (app/routes/legal.licenses.tsx): the variable build when
 * there is one, otherwise its regular and bold. Only the Latin subset is
 * kept, with the package's licence file beside it, under
 * `public/fonts/templates/<slug>/`. `app/template-fonts.gen.ts` records what
 * was copied; test/template-fonts.test.ts fails when a template names a
 * family that is not there.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESIGN_TEMPLATES } from '@vibld/ai/design-templates';
import {
  parseStyleGallery,
  styleGalleryFamilies,
} from '@vibld/ai/style-gallery';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'fonts', 'templates');
const MANIFEST = join(ROOT, 'app', 'template-fonts.gen.ts');

export interface TemplateFontFile {
  file: string;
  /** A single weight, or a variable range such as "100 900". */
  weight: string;
}

export interface TemplateFont {
  slug: string;
  /** Fontsource's category: sans-serif, serif, display, handwriting, monospace. */
  category: string;
  /** The Fontsource package and version it was copied from. */
  source: string;
  files: TemplateFontFile[];
  licence: string;
}

/** Fontsource's name for a family. */
export function fontSlug(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function pack(name: string, into: string): string | null {
  try {
    const out = execFileSync('npm', ['pack', name, '--silent'], {
      cwd: into,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const tgz = join(into, out.split('\n').pop()!);
    const dir = join(into, `${fontSlug(name)}-x`);
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['xzf', tgz, '-C', dir]);
    return join(dir, 'package');
  } catch {
    return null;
  }
}

function copyFamily(family: string, work: string): TemplateFont {
  const slug = fontSlug(family);
  const target = join(OUT, slug);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const variable = pack(`@fontsource-variable/${slug}`, work);
  const wanted: { from: string; weight: string }[] = [];
  let pkg = variable;
  if (variable) {
    const file = `${slug}-latin-wght-normal.woff2`;
    if (existsSync(join(variable, 'files', file))) {
      const meta = JSON.parse(
        readFileSync(join(variable, 'metadata.json'), 'utf8'),
      ) as { variable?: { wght?: { min: string; max: string } } };
      // Fontsource names the axes under `variable`. Read from anywhere else,
      // every variable face claimed weight 400 alone, and a browser drew
      // its other weights by thickening that one (internal PR 356).
      const wght = meta.variable?.wght;
      wanted.push({
        from: file,
        weight: wght ? `${wght.min} ${wght.max}` : '400',
      });
    }
  }
  if (wanted.length === 0) {
    pkg = pack(`@fontsource/${slug}`, work);
    if (!pkg)
      throw new Error(`${family}: no Fontsource package @fontsource/${slug}`);
    const files = readdirSync(join(pkg, 'files'));
    const weights = files
      .map((f) => new RegExp(`^${slug}-latin-(\\d+)-normal\\.woff2$`).exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    if (weights.length === 0) throw new Error(`${family}: no Latin files`);
    const pick = new Set<number>();
    const nearest = (w: number) =>
      weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
    pick.add(nearest(400));
    pick.add(nearest(700));
    for (const w of pick) {
      wanted.push({
        from: `${slug}-latin-${w}-normal.woff2`,
        weight: String(w),
      });
    }
  }
  const version = JSON.parse(
    readFileSync(join(pkg!, 'package.json'), 'utf8'),
  ) as { name: string; version: string };
  const { category } = JSON.parse(
    readFileSync(join(pkg!, 'metadata.json'), 'utf8'),
  ) as { category: string };
  const files: TemplateFontFile[] = [];
  for (const { from, weight } of wanted) {
    writeFileSync(join(target, from), readFileSync(join(pkg!, 'files', from)));
    files.push({ file: `/fonts/templates/${slug}/${from}`, weight });
  }
  const licenceName = readdirSync(pkg!).find((f) => /^licen[cs]e/i.test(f));
  if (!licenceName) throw new Error(`${family}: package has no license file`);
  writeFileSync(
    join(target, 'LICENSE.txt'),
    readFileSync(join(pkg!, licenceName)),
  );
  return {
    slug,
    category,
    source: `${version.name} ${version.version}`,
    files,
    licence: `/fonts/templates/${slug}/LICENSE.txt`,
  };
}

if (import.meta.main) {
  const families = [
    ...new Set([
      ...DESIGN_TEMPLATES.flatMap((t) => t.style.typeSet.map((f) => f.family)),
      // The style gallery's faces too, for its pages (D143).
      ...styleGalleryFamilies(
        parseStyleGallery(
          readFileSync(
            join(
              ROOT,
              '..',
              '..',
              'packages',
              'ai',
              'data',
              'style-gallery.json',
            ),
            'utf8',
          ),
        ).entries,
      ),
    ]),
  ].sort();
  // `--missing` copies only the families the manifest does not have yet,
  // keeping every file already copied; without it, everything is copied
  // again from the latest packages.
  const missingOnly = process.argv.includes('--missing');
  const work = mkdtempSync(join(tmpdir(), 'vibld-template-fonts-'));
  const manifest: Record<string, TemplateFont> = {};
  if (missingOnly) {
    const { TEMPLATE_FONTS } = await import('../app/template-fonts.gen.ts');
    for (const family of families) {
      if (TEMPLATE_FONTS[family]) manifest[family] = TEMPLATE_FONTS[family];
    }
  } else {
    rmSync(OUT, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  const failed: string[] = [];
  for (const family of families) {
    if (manifest[family]) continue;
    try {
      manifest[family] = copyFamily(family, work);
      process.stdout.write('.');
    } catch (error) {
      failed.push(`${family}: ${(error as Error).message}`);
    }
  }
  rmSync(work, { recursive: true, force: true });
  // In the families' order, however they were copied.
  const ordered: Record<string, TemplateFont> = Object.fromEntries(
    families.filter((f) => manifest[f]).map((f) => [f, manifest[f]!]),
  );
  writeFileSync(
    MANIFEST,
    '// Generated by scripts/template-fonts.ts. Do not edit: run it again.\n' +
      "import type { TemplateFont } from '../scripts/template-fonts.ts';\n\n" +
      `export const TEMPLATE_FONTS: Record<string, TemplateFont> = ${JSON.stringify(ordered, null, 2)};\n`,
  );
  writeFileSync(
    join(OUT, 'faces.css'),
    '/* Generated by scripts/template-fonts.ts. Do not edit. */\n' +
      Object.entries(ordered)
        .flatMap(([family, font]) =>
          font.files.map(
            (f) =>
              `@font-face{font-family:"tf-${family}";src:url(${f.file}) format("woff2");font-weight:${f.weight};font-style:normal;font-display:swap}`,
          ),
        )
        .join('\n') +
      '\n',
  );
  console.log(
    `\nCopied ${Object.keys(ordered).length} of ${families.length} families.`,
  );
  if (failed.length > 0) {
    console.error(failed.join('\n'));
    process.exit(1);
  }
}
