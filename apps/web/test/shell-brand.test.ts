import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * What the builder's own tab says and shows.
 *
 * Both of these were wrong in production while every source check stayed
 * green, because nothing here looked at the shell. The title read "Vibld
 * Builder", capitalising the one word docs/brand.md says is lowercase
 * everywhere, and there was no icon link at all, so a person with vibld.com
 * and app.vibld.com open side by side saw the mark on one tab and a blank
 * page glyph on the other. The tab strip is the one place both halves of this
 * product are visible at once, which makes it the worst place for them to
 * disagree.
 *
 * The favicon is asserted against the marketing site's copy rather than
 * against the generator, which gives a chain rather than a second opinion:
 * apps/marketing/test/brand-assets.test.ts already pins that file to what
 * @vibld/brand would emit, so pinning this one to it makes both equal to the
 * mark, and makes the two sites equal to each other, which is the property
 * BRAND-01 actually asks for.
 */

const SHELL = fileURLToPath(new URL('../index.html', import.meta.url));
const OURS = fileURLToPath(new URL('../public/favicon.svg', import.meta.url));
const THEIRS = fileURLToPath(
  new URL('../../marketing/public/favicon.svg', import.meta.url),
);
const TOUCH = fileURLToPath(
  new URL('../public/apple-touch-icon.png', import.meta.url),
);

describe("the builder's shell", () => {
  it('sets the wordmark in lowercase, like everywhere else', async () => {
    const html = await readFile(SHELL, 'utf8');
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    assert.ok(title, 'the shell has no title at all');
    assert.match(title, /vibld/, 'the title does not carry the wordmark');
    assert.doesNotMatch(
      title,
      /Vibld/,
      'the title capitalises the wordmark, which only SITE.legalName may do',
    );
  });

  it('points a browser at an icon, so the tab is not blank', async () => {
    const html = await readFile(SHELL, 'utf8');
    assert.match(html, /<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"/);
    assert.match(
      html,
      /<link[^>]+rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/,
    );
  });

  it('ships the same mark the marketing site ships', async () => {
    // Not "a mark": the same bytes. Two files drawn from one generator that
    // nothing compares is exactly how this project came to serve an orange
    // chevron from one hostname and a purple tilde from the other.
    const [ours, theirs] = await Promise.all([
      readFile(OURS, 'utf8'),
      readFile(THEIRS, 'utf8'),
    ]);
    assert.equal(ours, theirs);
    assert.ok(!ours.includes('oklch('), 'an oklch colour would render black');
  });

  it('has the touch icon its own shell links to', async () => {
    // The shell names this file, so a generator that stopped writing it would
    // ship a link to a 404 and nothing else here would notice. The shape is
    // read rather than the bytes compared: a rasteriser version bump changes
    // the pixels and changes nothing that matters.
    const png = await readFile(TOUCH);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG');
    assert.deepEqual(
      { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
      { width: 180, height: 180 },
      'iOS asks for 180x180',
    );
  });
});
