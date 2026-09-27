import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The self-hosted typefaces: every file declared, every declaration backed
 * by a file, every family's licence file beside it, and the notices page
 * quoting those files accurately.
 *
 * What the built pages do with them (the preloads) is checked on the built
 * HTML in prerender.test.ts, which owns the build.
 */

const APP = join(import.meta.dirname, '..');
const FONTS = join(APP, 'public', 'fonts');
const CSS = readFileSync(join(APP, 'app', 'app.css'), 'utf8');
const ROOT = readFileSync(join(APP, 'app', 'root.tsx'), 'utf8');
const NOTICES = readFileSync(
  join(APP, 'app', 'routes', 'legal.licenses.tsx'),
  'utf8',
);

const FILES = readdirSync(FONTS);
const WOFF2 = FILES.filter((name) => name.endsWith('.woff2'));

/** Each family's font file, its licence file and its CSS family name. */
const FAMILIES = [
  {
    family: 'Bricolage Grotesque',
    css: 'Bricolage Grotesque Variable',
    prefix: 'bricolage-grotesque-',
    licence: 'BricolageGrotesque-OFL.txt',
    preloaded: true,
  },
  {
    family: 'Hanken Grotesk',
    css: 'Hanken Grotesk Variable',
    prefix: 'hanken-grotesk-',
    licence: 'HankenGrotesk-OFL.txt',
    preloaded: true,
  },
  {
    family: 'JetBrains Mono',
    css: 'JetBrains Mono Variable',
    prefix: 'jetbrains-mono-',
    licence: 'JetBrainsMono-OFL.txt',
    preloaded: false,
  },
];

/** The @font-face rule whose src names `file`. */
function faceFor(file: string): string {
  const at = CSS.indexOf(`/fonts/${file}`);
  assert.notEqual(at, -1, `app.css declares no @font-face for ${file}`);
  const start = CSS.lastIndexOf('@font-face', at);
  return CSS.slice(start, CSS.indexOf('}', at));
}

describe('the self-hosted fonts', () => {
  it('holds a font and a licence per family, and nothing else', () => {
    assert.deepEqual(
      [...FILES].sort(),
      [
        ...FAMILIES.map((f) => f.licence),
        ...FAMILIES.map((f) =>
          WOFF2.find((name) => name.startsWith(f.prefix))!,
        ),
      ].sort(),
    );
  });

  it('names each file by its package version, which the year-long cache relies on', () => {
    // worker/index.ts serves /fonts/*.woff2 as immutable for a year. That is
    // only safe if a changed file is a changed URL.
    for (const name of WOFF2) {
      assert.match(
        name,
        /-\d+\.\d+\.\d+-latin-/,
        `${name} has no version in it`,
      );
    }
  });

  for (const font of FAMILIES) {
    it(`declares ${font.family} with swap, a unicode range and a real fallback`, () => {
      const file = WOFF2.find((name) => name.startsWith(font.prefix))!;
      const face = faceFor(file);
      assert.match(face, new RegExp(`font-family: '${font.css}'`));
      assert.match(face, /font-display: swap/);
      // The Fontsource latin subset's range, which starts at Basic Latin.
      assert.match(face, /unicode-range:\s*U\+0000-00FF,/);
      // The stack in @theme names the family and then falls back to a
      // generic family, so text is readable before and without the file.
      const stack = new RegExp(`'${font.css}',[^;]*(sans-serif|monospace);`);
      assert.match(CSS, stack, `${font.family} has no fallback stack`);
    });

    it(`serves ${font.family}'s licence file, and the notices page quotes it`, () => {
      const text = readFileSync(join(FONTS, font.licence), 'utf8');
      assert.match(
        text,
        /This Font Software is licensed under the SIL Open Font License, Version 1\.1\./,
      );
      const copyright = text
        .split('\n')[0]!
        .split(' HankenGrotesk-Italic')[0]!
        .split(' JetBrainsMono-Italic')[0]!
        .trim();
      assert.ok(
        NOTICES.includes(copyright),
        `legal.licenses.tsx does not quote "${copyright}"`,
      );
      assert.ok(NOTICES.includes(`/fonts/${font.licence}`));
    });

    it(`${font.preloaded ? 'preloads' : 'does not preload'} ${font.family}`, () => {
      const file = WOFF2.find((name) => name.startsWith(font.prefix))!;
      assert.equal(ROOT.includes(`'/fonts/${file}'`), font.preloaded);
    });
  }

  it('states facts on the notices page and draws no conclusion from them', () => {
    // CLAUDE.md: licensing is the maintainer's decision. The page names the
    // licence and where its text is; it does not say what it permits.
    const section = NOTICES.slice(NOTICES.indexOf('Typefaces on this website'));
    assert.ok(section.includes('SIL Open Font License 1.1'));
    for (const claim of [
      /\bpermit/i,
      /\ballow/i,
      /\bfree to\b/i,
      /\bmay be used\b/i,
    ]) {
      assert.doesNotMatch(
        section.slice(0, section.indexOf('<h2>Questions')),
        claim,
      );
    }
  });

  it('does not ship the mockup’s fourth face', () => {
    assert.doesNotMatch(CSS, /Instrument Serif/);
  });
});
