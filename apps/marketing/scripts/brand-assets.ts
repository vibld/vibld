#!/usr/bin/env node
/**
 * Regenerate the committed brand assets from @vibld/brand.
 *
 * The favicon, the touch icon and the social card used to be hand-drawn SVG
 * checked into public/, which is how vibld.com ended up shipping a different
 * logo from app.vibld.com: nothing connected either file to a decision. These
 * are now emitted from the same module the sites render from, and
 * test/brand-assets.test.ts fails if a committed file has drifted from what
 * this script would produce.
 *
 * Run it after changing the palette or the mark:
 *   pnpm --filter @vibld/marketing brand:assets
 *
 * Every colour here is written as hex, never `oklch()`. The first card this
 * script produced came out entirely black: librsvg, which rasterises the
 * PNGs, does not parse oklch and falls back to black rather than failing. The
 * committed SVGs use hex for the same reason, since a favicon that renders
 * black in an older browser is a worse failure than one that is slightly off.
 *
 * On the raster outputs: they draw both strokes without `mix-blend-mode`,
 * because a PNG rasteriser is not a browser and blend support is not
 * something to bet a favicon on. That is the same degradation the mark is
 * designed to survive, named at its definition -- both impressions land in
 * the right places and only the overlap colour is lost.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { CHEVRON, REGISTER_OFFSET, STROKE, WORDMARK } from '@vibld/brand/mark';
import { CHALK, DARK, GRAPHITE, LIGHT, VERMILION } from '@vibld/brand/palette';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * The builder's own static root, written to from here on purpose.
 *
 * app.vibld.com shipped no icon at all: no `favicon.svg`, no touch icon, no
 * `<link rel="icon">` in its shell. So the tab strip, which is the one place
 * a person sees both halves of this product side by side, showed the mark on
 * vibld.com and a blank page glyph on app.vibld.com. That is the same
 * one-product-two-identities failure `@vibld/brand` was created to end, in
 * its most visible form.
 *
 * Copying the file across would have recreated the drift this script exists
 * to prevent, so the generator writes both and the tests pin both. Only the
 * two icons: the social card is for a link somebody shares, and the builder
 * sits behind sign-in.
 */
const BUILDER_PUBLIC = fileURLToPath(
  new URL('../../web/public/', import.meta.url),
);

function offsetPath(): string {
  return `M${6 + REGISTER_OFFSET} ${9 + REGISTER_OFFSET}l9 15 9-15`;
}

/**
 * The icon, on its own tile.
 *
 * A tile rather than a bare mark: a favicon sits on whatever colour the
 * browser's tab strip happens to be, and an untiled two-ink mark loses one of
 * its inks against half of them. The tile is graphite, so the chalk
 * impression carries the shape (16.73) and vermilion stays the ghost, which
 * is the same arrangement the dark theme uses and the same tile the builder's
 * header draws the mark on.
 *
 * The blend is the dark theme's, `screen`, because a graphite tile is a dark
 * ground whatever the page around it is.
 */
export function iconSvg({ blend }: { blend: boolean }): string {
  const group = blend ? `<g style="mix-blend-mode:${DARK.markBlend}">` : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="${GRAPHITE.hex}"/>
  ${group}
    <path d="${CHEVRON}" stroke="${VERMILION.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
    <path d="${offsetPath()}" stroke="${CHALK.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
  </g>
</svg>
`;
}

/** The single-ink mark, for anywhere the overprint cannot survive at all. */
export function monoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path d="${offsetPath()}" stroke="${LIGHT.markInk.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
</svg>
`;
}

/**
 * The social card, at the 1200x630 every scraper assumes.
 *
 * Graphite ground for the same reason the icon uses one: this image is
 * composited onto whatever colour the sharing surface uses, and a card that
 * relies on the page's own paper colour has none. The mark is the icon's
 * arrangement at scale, the wordmark is chalk (16.73), and vermilion appears
 * twice, both times as a fill: the mark's ghost and the band along the foot.
 *
 * The tagline is set in the dark theme's link ink, not in vermilion. On
 * graphite vermilion would actually pass (5.49), but the brand's rule is that
 * vermilion is never a text colour, and a rule with an exception for the one
 * image every share carries is not a rule. The link ink measures 7.56.
 */
export function socialSvg({ blend }: { blend: boolean }): string {
  const group = blend ? `<g style="mix-blend-mode:${DARK.markBlend}">` : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${GRAPHITE.hex}"/>
  <rect y="606" width="1200" height="24" fill="${VERMILION.hex}"/>
  <g transform="translate(110 200) scale(5.5)">
    ${group}
      <path d="${CHEVRON}" stroke="${VERMILION.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
      <path d="${offsetPath()}" stroke="${CHALK.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
    </g>
  </g>
  <text x="110" y="440" font-family="Georgia, 'Times New Roman', serif" font-size="96" font-weight="700" fill="${CHALK.hex}">${WORDMARK}</text>
  <text x="110" y="510" font-family="Georgia, 'Times New Roman', serif" font-size="40" fill="${DARK.accentInk.hex}">Vibe. Build. Ship.</text>
</svg>
`;
}

/**
 * The mark scaled into the middle of a full-bleed 32 box.
 *
 * For the two surfaces that crop the tile to a shape of their own: Android's
 * adaptive icons and BIMI's circle. Both keep only a central circle (80% of
 * the side for a maskable icon), and the mark at full size reaches past it:
 * the miter at the foot of the offset stroke ends near y 30. Scaled by 0.72
 * about the middle, every point of it sits within 11 of the center.
 */
function centeredMark(): string {
  return `<g transform="translate(16 16) scale(0.72) translate(-16 -17.5)">
    <path d="${CHEVRON}" stroke="${VERMILION.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
    <path d="${offsetPath()}" stroke="${CHALK.hex}" stroke-width="${STROKE}" fill="none" stroke-linejoin="miter"/>
  </g>`;
}

/** The icon for Android's adaptive icons: full bleed, mark in the safe zone. */
export function maskableSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" fill="${GRAPHITE.hex}"/>
  ${centeredMark()}
</svg>
`;
}

/**
 * The logo mailbox providers show beside vibld.com mail (BIMI, D173).
 *
 * BIMI accepts one SVG profile, "SVG Tiny Portable/Secure": version 1.2,
 * `baseProfile="tiny-ps"`, a `<title>`, a square viewBox, no `x`/`y` on the
 * root, no scripts, no external references and no blend modes, which is why
 * this draws both strokes plainly, as the rasters do. Providers crop it to a
 * circle, so the tile is square and full-bleed and the mark is the centered
 * one, the way the hand-drawn file that shipped with D173 had it.
 */
export function bimiSvg(): string {
  return `<svg version="1.2" baseProfile="tiny-ps" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <title>${WORDMARK}</title>
  <rect width="32" height="32" fill="${GRAPHITE.hex}"/>
  ${centeredMark()}
</svg>
`;
}

/** The PNG sizes `favicon.ico` carries: tab, taskbar and shortcut. */
export const ICO_SIZES = [16, 32, 48] as const;

/** The PNG icons the web manifest names. */
export const MANIFEST_ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  {
    src: '/icon-maskable-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
] as const;

/**
 * The web app manifest, for "Add to Home Screen" and Android's launcher.
 *
 * Without one, Chrome on Android builds a home-screen icon from a screenshot
 * or the first letter of the title. The builder opens standalone, like the
 * app it is; vibld.com stays a page in the browser.
 */
export function webManifest({ app }: { app: 'marketing' | 'builder' }): string {
  const manifest = {
    name: app === 'builder' ? `${WORDMARK} builder` : WORDMARK,
    short_name: WORDMARK,
    start_url: '/',
    display: app === 'builder' ? 'standalone' : 'browser',
    background_color: GRAPHITE.hex,
    theme_color: GRAPHITE.hex,
    icons: MANIFEST_ICONS,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Pack PNGs into one `.ico`.
 *
 * Browsers, crawlers and RSS readers still ask for `/favicon.ico` without
 * reading any `<link>`, and vibld.com answered them with its 404 page while
 * app.vibld.com answered with the app's HTML shell. Every browser since
 * Windows Vista reads PNG-compressed entries, so each image is stored as the
 * PNG it already is: a 6-byte header, a 16-byte directory entry per image,
 * then the images.
 */
export function icoFromPngs(
  images: readonly { size: number; png: Buffer }[],
): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    // 0 in the width and height bytes means 256.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main(): Promise<void> {
  await mkdir(PUBLIC, { recursive: true });
  await mkdir(BUILDER_PUBLIC, { recursive: true });

  await writeFile(join(PUBLIC, 'favicon.svg'), iconSvg({ blend: true }));
  await writeFile(join(PUBLIC, 'mark-mono.svg'), monoSvg());
  await writeFile(
    join(BUILDER_PUBLIC, 'favicon.svg'),
    iconSvg({ blend: true }),
  );
  await writeFile(join(PUBLIC, 'bimi.svg'), bimiSvg());
  await writeFile(
    join(PUBLIC, 'manifest.webmanifest'),
    webManifest({ app: 'marketing' }),
  );
  await writeFile(
    join(BUILDER_PUBLIC, 'manifest.webmanifest'),
    webManifest({ app: 'builder' }),
  );

  // sharp is a transitive dev dependency (wrangler > miniflare). Required
  // lazily and by path so that generating the SVGs above never depends on it
  // being resolvable, and so the test that checks those SVGs does not need it
  // at all.
  const require = createRequire(import.meta.url);
  // `sharp`'s types describe a CommonJS callable; `createRequire` hands back
  // the same object but TypeScript resolves the namespace rather than the
  // call signature under this module setting, so the shape is named here
  // instead of asserted against the namespace.
  interface Pipeline {
    resize(width: number, height: number): Pipeline;
    png(): Pipeline;
    toFile(path: string): Promise<unknown>;
    toBuffer(): Promise<Buffer>;
  }
  type Rasteriser = (input: Buffer) => Pipeline;
  const sharp = require('sharp') as unknown as Rasteriser;

  await sharp(Buffer.from(iconSvg({ blend: false })))
    .resize(180, 180)
    .png()
    .toFile(join(PUBLIC, 'apple-touch-icon.png'));

  await sharp(Buffer.from(iconSvg({ blend: false })))
    .resize(180, 180)
    .png()
    .toFile(join(BUILDER_PUBLIC, 'apple-touch-icon.png'));

  const raster = (svg: string, size: number): Promise<Buffer> =>
    sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const ico = icoFromPngs(
    await Promise.all(
      ICO_SIZES.map(async (size) => ({
        size,
        png: await raster(iconSvg({ blend: false }), size),
      })),
    ),
  );
  for (const dir of [PUBLIC, BUILDER_PUBLIC]) {
    await writeFile(join(dir, 'favicon.ico'), ico);
    await writeFile(
      join(dir, 'icon-192.png'),
      await raster(iconSvg({ blend: false }), 192),
    );
    await writeFile(
      join(dir, 'icon-512.png'),
      await raster(iconSvg({ blend: false }), 512),
    );
    await writeFile(
      join(dir, 'icon-maskable-512.png'),
      await raster(maskableSvg(), 512),
    );
  }

  await sharp(Buffer.from(socialSvg({ blend: false })))
    .png()
    .toFile(join(PUBLIC, 'og-image.png'));

  console.log('brand assets written to', PUBLIC, 'and', BUILDER_PUBLIC);
}

if (process.argv[1] && dirname(process.argv[1]).endsWith('scripts')) {
  await main();
}
