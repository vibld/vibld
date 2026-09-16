import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Colour literals in the builder's own stylesheet.
 *
 * Not a rule about repeated selectors: this file deliberately declares some
 * twice, with a documented "surface treatment" layer that retunes the
 * structural rules above it. A first cut of this test forbade that and could
 * only have been satisfied by a restyle nobody asked for.
 *
 * The marketing side has a rule like this over its Tailwind classes; this is
 * the half that rule cannot see, because the builder writes plain CSS. Both
 * exist for the same reason: a colour that disagrees with its theme looks
 * exactly like a colour that was chosen, and nothing else in the build
 * complains.
 *
 * The allowlist is the point. A literal is not forbidden, it has to be
 * argued for, and the argument lives next to the value rather than in
 * somebody's memory.
 */

const STYLES = join(
  fileURLToPath(new URL('../src/', import.meta.url)),
  'styles.css',
);

/**
 * Colour literals that are deliberately not theme tokens.
 *
 * `#ffffff` backs the preview iframe, which contains somebody else's project
 * rendering on its own page. Backing it with the builder's paper colour would
 * tint their work and make a light project look broken in dark mode.
 */
const ALLOWED = new Map<string, string>([
  ['#ffffff', "the preview frame is a canvas for somebody else's project"],
]);

const LITERAL = /(#[0-9a-fA-F]{3,8}\b|\bhsl\([^)]*\)|\boklch\([^)]*\))/g;

describe('the builder stylesheet', () => {
  it('uses theme tokens for colour, or says why not', async () => {
    const css = await readFile(STYLES, 'utf8');
    const offenders: string[] = [];

    for (const [index, line] of css.split('\n').entries()) {
      // A `var()` reference is a token by definition, and a line that only
      // mentions one in prose is a comment.
      if (line.trimStart().startsWith('*')) continue;
      for (const match of line.matchAll(LITERAL)) {
        const literal = match[0]!;
        if (ALLOWED.has(literal)) continue;
        offenders.push(`styles.css:${index + 1}: ${literal}`);
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('reads a stylesheet big enough to mean something', async () => {
    const css = await readFile(STYLES, 'utf8');
    assert.ok(css.split('\n').length > 500);
  });

  it('never draws the retired mark anywhere in the shell', async () => {
    // The tilde survived in `SignInLanding` when the shell header was
    // changed, so the first surface an unauthenticated visitor saw still
    // carried the old logo while everything else had the new one. A replaced
    // mark is exactly the kind of thing that gets replaced in one place.
    const { readdir } = await import('node:fs/promises');
    const src = fileURLToPath(new URL('../src/', import.meta.url));

    async function sources(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...(await sources(path)));
        else if (/\.tsx$/.test(entry.name)) found.push(path);
      }
      return found;
    }

    const offenders: string[] = [];
    for (const path of await sources(src)) {
      const text = await readFile(path, 'utf8');
      for (const [index, line] of text.split('\n').entries()) {
        // The retired mark, as it was written: a bare tilde as the whole of
        // an element's content.
        if (/^\s*~\s*$/.test(line)) {
          offenders.push(`${path}:${index + 1}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });
});
