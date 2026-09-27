import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Whether the `hidden` attribute actually hides anything.
 *
 * It is honoured by a single `[hidden] { display: none }` rule in the
 * browser's own stylesheet, which every author rule outranks. So a class
 * that sets `display` on the same element cancels it silently: no warning,
 * no error, and the element renders exactly as though the attribute were
 * absent.
 *
 * That shipped. `.settings__panel` sets `display: flex` and is toggled with
 * `hidden`, so the settings popover was drawn open on every page load and
 * the gear toggled an attribute that changed nothing, leaving nobody a way
 * to close it. Every check in the repository stayed green, because the
 * component was right and the stylesheet was right and nothing looked at
 * both.
 *
 * Two rules, then. The stylesheet carries a `[hidden]` rule strong enough to
 * beat a class, and every element rendered with `hidden` is on a page that
 * loads that stylesheet. The second is what makes the first a guarantee
 * rather than a rule that happens to be written down.
 */

const HERE = new URL('../', import.meta.url).pathname;

/**
 * Where an element may be rendered with `hidden`, and the stylesheet that
 * has to back it there. Both halves of this product are in the list: the
 * rule is about the attribute, not about one app.
 */
const AREAS = [
  { source: join(HERE, 'src'), styles: join(HERE, 'src', 'styles.css') },
  {
    source: join(HERE, '..', 'marketing', 'app'),
    styles: join(HERE, '..', 'marketing', 'app', 'app.css'),
  },
] as const;

/** `[hidden] { ... display: none !important ... }`, however it is spaced. */
const BEATS_A_CLASS = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important[^}]*\}/;

async function tsxUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await tsxUnder(path)));
    else if (entry.name.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/** Elements rendered with the `hidden` attribute, as `file:line`. */
async function usesHidden(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const path of await tsxUnder(directory)) {
    const source = await readFile(path, 'utf8');
    // `aria-hidden` is a different attribute and hides nothing visually,
    // which is why the class ahead of `hidden` excludes a hyphen.
    for (const match of source.matchAll(/(^|[^-\w])hidden=\{/g)) {
      const line = source.slice(0, match.index).split('\n').length;
      found.push(`${path.slice(directory.length + 1)}:${line}`);
    }
  }
  return found;
}

describe('the hidden attribute', () => {
  it('is backed by a rule that beats a class, wherever it is used', async () => {
    const unbacked: string[] = [];
    let used = 0;

    for (const area of AREAS) {
      const uses = await usesHidden(area.source);
      used += uses.length;
      if (uses.length === 0) continue;
      const css = await readFile(area.styles, 'utf8');
      if (!BEATS_A_CLASS.test(css)) {
        unbacked.push(`${area.styles}: backs nothing, but ${uses.join(', ')}`);
      }
    }

    assert.deepEqual(unbacked, []);
    // Not a formality. If nothing uses the attribute any more, the rule
    // above is passing because there is nothing to check, and this file
    // says so rather than reading as a guarantee it is no longer making.
    assert.ok(used > 0, 'nothing uses `hidden` any more; this file can go');
  });
});
