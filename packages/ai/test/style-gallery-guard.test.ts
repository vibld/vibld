import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { STYLE_GALLERY_FILE } from '../bin/import-style-gallery.ts';
import {
  checkColorEdits,
  isStyleColorEdits,
  parseStyleGallery,
  styleTokensFile,
  withColorEdits,
} from '../src/style-gallery.ts';
import type { StyleGalleryEntry } from '../src/style-gallery.ts';

/** The theme guard (D147): color edits checked against every measured pair. */

const stored = existsSync(STYLE_GALLERY_FILE);
const catalog = stored
  ? parseStyleGallery(readFileSync(STYLE_GALLERY_FILE, 'utf8'))
  : null;

/** Just what the guard reads. */
function entry(): StyleGalleryEntry {
  return {
    id: 'fixture',
    visual_style: {
      palette: [
        { role: 'canvas', hex: '#ffffff' },
        { role: 'text', hex: '#111111' },
        { role: 'glow (decorative)', hex: '#ff66cc' },
      ],
    },
    design_tokens: {
      colors: [
        { token: '--color-canvas', role: 'canvas', hex: '#ffffff' },
        { token: '--color-text', role: 'text', hex: '#111111' },
        { token: '--color-glow', role: 'glow (decorative)', hex: '#ff66cc' },
      ],
    },
    contrast_checks: [
      {
        use: 'body text on canvas',
        fg: '#111111',
        bg: '#ffffff',
        ratio: 18.88,
        target: 4.5,
      },
      {
        use: 'focus ring on canvas',
        fg: '#111111',
        bg: '#ffffff',
        ratio: 18.88,
        target: 3,
      },
      { use: 'glow fill, exempt (decorative)', fg: '#ff66cc', bg: '#ffffff' },
    ],
  } as unknown as StyleGalleryEntry;
}

describe('the theme guard', () => {
  it('passes the style as it is, and an edit that keeps every pair', () => {
    assert.deepEqual(checkColorEdits(entry(), {}), { ok: true });
    assert.deepEqual(checkColorEdits(entry(), { '--color-text': '#000000' }), {
      ok: true,
    });
  });

  it('rejects an edit that fails a text pair', () => {
    const result = checkColorEdits(entry(), { '--color-text': '#aaaaaa' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.failures.map((failure) => [failure.use, failure.reason]),
      [
        ['body text on canvas', 'contrast'],
        ['focus ring on canvas', 'contrast'],
      ],
    );
    assert.match(
      result.problems[0]!,
      /^body text on canvas: 2\.32:1, needs 4\.5:1$/,
    );
  });

  it('holds a UI pair to 3:1', () => {
    // 3.5:1 passes the focus ring and fails the text.
    const result = checkColorEdits(entry(), { '--color-text': '#8a8a8a' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.failures.map((failure) => failure.use),
      ['body text on canvas'],
    );
  });

  it('never lets a decorative color carry text, whatever its ratio', () => {
    const bad = entry();
    bad.contrast_checks.push({
      use: 'caption on glow',
      fg: '#111111',
      bg: '#ff66cc',
      ratio: 7.2,
      target: 4.5,
    });
    const result = checkColorEdits(bad, {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failures[0]!.reason, 'decorative');
  });

  it('refuses a color the style does not have, or a value that is not a hex', () => {
    for (const edits of [
      { '--color-other': '#000000' },
      { '--color-text': 'black' },
    ] as Record<string, string>[]) {
      const result = checkColorEdits(entry(), edits);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failures.length, 0);
    }
  });

  it('applies edits to the colors, the palette and each pair, measured again', () => {
    const edited = withColorEdits(entry(), { '--color-text': '#000000' });
    assert.equal(edited.design_tokens.colors[1]!.hex, '#000000');
    assert.equal(edited.visual_style.palette[1]!.hex, '#000000');
    assert.equal(edited.contrast_checks[0]!.fg, '#000000');
    assert.equal(edited.contrast_checks[0]!.ratio, 21);
    assert.equal(edited.contrast_checks[2]!.ratio, undefined);
    const same = entry();
    assert.equal(withColorEdits(same, {}), same);
  });

  it('knows edits a project may store', () => {
    assert.equal(isStyleColorEdits({ '--color-text': '#000000' }), true);
    for (const value of [
      null,
      [],
      { text: '#000000' },
      { '--color-text': '#000' },
      { '--color-text': '#ABCDEF' },
    ]) {
      assert.equal(isStyleColorEdits(value), false, JSON.stringify(value));
    }
  });
});

describe('the theme guard on the imported styles', { skip: !stored }, () => {
  it('passes every style as it is', () => {
    for (const each of catalog!.entries) {
      assert.deepEqual(checkColorEdits(each, {}), { ok: true }, each.id);
    }
  });

  it('rejects a failing edit, and a passing one reaches the tokens file', () => {
    const amberbrae = catalog!.entries.find((e) => e.id === 'amberbrae')!;
    const failing = checkColorEdits(amberbrae, {
      '--color-muted-text': '#b0b0b0',
    });
    assert.equal(failing.ok, false);
    if (!failing.ok) {
      assert.deepEqual(
        failing.failures.map((failure) => failure.use),
        ['muted text on canvas', 'muted text on surface'],
      );
    }
    const edits = { '--color-muted-text': '#5a5a5a' };
    assert.deepEqual(checkColorEdits(amberbrae, edits), { ok: true });
    assert.match(
      styleTokensFile(withColorEdits(amberbrae, edits)),
      /--color-muted-text: #5a5a5a;/,
    );
  });
});
