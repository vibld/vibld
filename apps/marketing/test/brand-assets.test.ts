import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ICO_SIZES,
  MANIFEST_ICONS,
  bimiSvg,
  iconSvg,
  monoSvg,
  webManifest,
} from '../scripts/brand-assets.ts';

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

  it('ships a favicon.ico for everything that asks for it by name', async () => {
    // Browsers and crawlers request /favicon.ico without reading a <link>;
    // vibld.com answered them with its 404 page.
    const ico = await readFile(join(PUBLIC, 'favicon.ico'));
    assert.equal(ico.readUInt16LE(2), 1, 'not an icon resource');
    const count = ico.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + 16 * i;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + length);
      const { width, height } = pngSize(png);
      assert.equal(ico.readUInt8(entry), width, 'directory and image disagree');
      assert.equal(width, height);
      sizes.push(width);
    }
    assert.deepEqual(sizes, [...ICO_SIZES]);
  });

  it('has a manifest the generator would still produce, naming icons that exist', async () => {
    const committed = await readFile(
      join(PUBLIC, 'manifest.webmanifest'),
      'utf8',
    );
    assert.equal(committed, webManifest({ app: 'marketing' }));
    for (const icon of MANIFEST_ICONS) {
      const png = await readFile(join(PUBLIC, icon.src.slice(1)));
      const { width, height } = pngSize(png);
      assert.equal(`${width}x${height}`, icon.sizes, icon.src);
    }
  });

  it('has a BIMI logo the generator would still produce', async () => {
    const committed = await readFile(join(PUBLIC, 'bimi.svg'), 'utf8');
    assert.equal(committed, bimiSvg());
  });

  it('keeps the BIMI logo inside SVG Tiny Portable/Secure', async () => {
    // Mailbox providers reject anything else outright and show no logo, with
    // no report saying why. These are the rules the BIMI group's validator
    // fails most often.
    const svg = await readFile(join(PUBLIC, 'bimi.svg'), 'utf8');
    const root = /<svg[^>]*>/.exec(svg)?.[0] ?? '';
    assert.match(root, /\bversion="1\.2"/);
    assert.match(root, /\bbaseProfile="tiny-ps"/);
    assert.doesNotMatch(root, /\s(x|y)="/, 'the root may not carry x or y');
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(root);
    assert.ok(viewBox && viewBox[1] === viewBox[2], 'the logo must be square');
    assert.match(svg, /<title>[^<]+<\/title>/);
    for (const banned of [
      '<script',
      '<image',
      '<foreignObject',
      'href=',
      'mix-blend-mode',
      'oklch(',
    ]) {
      assert.ok(!svg.includes(banned), `the logo carries ${banned}`);
    }
    assert.ok(Buffer.byteLength(svg) < 32 * 1024, 'over the 32 KB limit');
  });

  it('links every icon from the page head', async () => {
    const root = await readFile(
      fileURLToPath(new URL('../app/root.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(root, /<link rel="icon" href="\/favicon\.ico" sizes="32x32"/);
    assert.match(root, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  });
});
