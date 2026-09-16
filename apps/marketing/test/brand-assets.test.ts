import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { iconSvg, monoSvg } from '../scripts/brand-assets.ts';

/**
 * The committed brand assets, against what the generator would write now.
 *
 * These files used to be hand-drawn and checked in, which is how this project
 * ended up serving one logo from vibld.com and a different one from
 * app.vibld.com: nothing connected either file to a decision, so neither
 * moved when the decision did.
 *
 * The PNGs are not compared byte for byte -- a rasteriser version bump would
 * make that fail for no reason -- only that they exist and are the size the
 * platforms they are for require.
 */

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

/** Width and height from a PNG's IHDR, which is always the first chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the committed brand assets', () => {
  it('has a favicon the generator would still produce', async () => {
    const committed = await readFile(join(PUBLIC, 'favicon.svg'), 'utf8');
    assert.equal(committed, iconSvg({ blend: true }));
  });

  it('has the single-ink fallback the direction needs', async () => {
    // Named when the direction was chosen: the overprint depends on
    // transparency, and monochrome favicon rendering throws that away.
    const committed = await readFile(join(PUBLIC, 'mark-mono.svg'), 'utf8');
    assert.equal(committed, monoSvg());
  });

  it('never writes an oklch colour into a file a browser will not render', async () => {
    // The bug this is here for: the first social card came out entirely
    // black, because librsvg does not parse oklch() and falls back to black
    // instead of failing.
    for (const name of ['favicon.svg', 'mark-mono.svg']) {
      const svg = await readFile(join(PUBLIC, name), 'utf8');
      assert.ok(!svg.includes('oklch('), `${name} carries an oklch colour`);
      assert.match(svg, /#[0-9a-f]{6}/, `${name} has no hex colour at all`);
    }
  });

  it('ships a social card at the size every scraper assumes', async () => {
    const png = await readFile(join(PUBLIC, 'og-image.png'));
    assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
  });

  it('ships a touch icon at the size iOS asks for', async () => {
    const png = await readFile(join(PUBLIC, 'apple-touch-icon.png'));
    assert.deepEqual(pngSize(png), { width: 180, height: 180 });
  });
});
