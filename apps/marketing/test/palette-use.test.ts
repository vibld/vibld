import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * How the brand's colours may be used, enforced on the source.
 *
 * The palette tests (packages/brand) prove which pairings are legible. They
 * cannot see whether this site actually uses them that way, and it did not:
 * the consent banner's "Allow" button set its text to
 * `--color-accent-contrast`, a token that has never existed in this
 * stylesheet, so the one control every visitor sees had no text colour at
 * all. Two more places set white on the accent fill and two set the accent
 * as a link colour, both of which measured 2.60 under the previous palette's
 * coral. Under vermilion they measure 3.36 and 3.05, which is less
 * obviously wrong and still under the 4.5 body text needs.
 *
 * All four were shipped and none was visible in review, because a colour
 * mistake looks exactly like a colour choice.
 */

const APP = fileURLToPath(new URL('../app/', import.meta.url));

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Every `--color-*` token this stylesheet actually declares. */
async function declaredTokens(): Promise<Set<string>> {
  const css = await readFile(join(APP, 'app.css'), 'utf8');
  return new Set(
    [...css.matchAll(/--(color-[a-z-]+):/g)].map((match) => match[1]!),
  );
}

describe('how the brand colours are used', () => {
  it('never sets a colour token that does not exist', async () => {
    // The bug this is here for. A `var()` naming nothing falls back to
    // inheriting, which is invisible in one theme and unreadable in the
    // other, and no build step complains.
    const declared = await declaredTokens();
    const missing: string[] = [];

    for (const path of await sources(APP)) {
      const text = await readFile(path, 'utf8');
      for (const match of text.matchAll(/var\(--(color-[a-z-]+)\)/g)) {
        const token = match[1]!;
        if (!declared.has(token)) missing.push(`${path}: --${token}`);
      }
    }

    assert.deepEqual(missing, []);
  });

  it('never puts white, paper or a theme ink on the vermilion fill', async () => {
    // White on vermilion measures 3.36 and chalk 3.05. The theme's own ink
    // looks safe because it is dark in light mode, and in dark mode it is
    // near-white on a fill that does not change: 2.89. Muted ink is 2.45
    // even in light mode. The only text colour the brand allows on an
    // accent fill is --color-on-accent, at 5.81 in both themes.
    const offenders: string[] = [];
    for (const path of await sources(APP)) {
      const text = await readFile(path, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.includes('bg-[var(--color-accent)]')) continue;
        if (
          /text-white|text-\[var\(--color-(paper|ink|ink-muted)\)\]/.test(line)
        ) {
          offenders.push(`${path}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('never sets text in the accent itself', async () => {
    // Vermilion is a fill and a mark. As a text colour it measures 3.05 on
    // chalk and 2.86 on the raised surface, whatever the size.
    // --color-accent-ink is the one to reach for.
    const offenders: string[] = [];
    for (const path of await sources(APP)) {
      const text = await readFile(path, 'utf8');
      for (const line of text.split('\n')) {
        if (/text-\[var\(--color-accent\)\]/.test(line)) {
          offenders.push(`${path}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('reads enough files to mean something', async () => {
    assert.ok((await sources(APP)).length > 10);
  });
});
