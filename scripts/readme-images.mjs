#!/usr/bin/env node
/**
 * Draws the README's banner, in the light and dark palettes, and the social
 * preview GitHub shows when the repository is linked.
 *
 *   node scripts/readme-images.mjs <deps>
 *
 * <deps> is a directory where playwright and sharp are installed, the same
 * arrangement as example-screenshots.mjs. The images are drawn by Chromium
 * from HTML so they are set in the brand's own self-hosted faces
 * (apps/marketing/public/fonts) rather than whatever a rasteriser finds.
 *
 * Colours come from @vibld/brand's palette, as hex. Vermilion is a fill
 * only, never a text colour, the same rule docs/brand.md sets for the sites.
 *
 * Writes docs/images/banner-light.png, docs/images/banner-dark.png and
 * docs/images/social-preview.png. The last is not referenced from the tree:
 * it is uploaded by hand as the repository's social preview.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'images');
const FONTS = join(ROOT, 'apps', 'marketing', 'public', 'fonts');

// @vibld/brand's palette, as hex (packages/brand/src/palette.ts). Kept as
// literals because this script runs without a TypeScript loader.
const VERMILION = '#ff4a1c';
const GRAPHITE = '#121418';
const CHALK = '#f4f4f1';
const THEMES = {
  light: {
    paper: CHALK,
    surface: '#ffffff',
    rule: '#dcddd6',
    ink: GRAPHITE,
    muted: '#4a4f57',
    accentInk: '#c2310d',
    grid: 'rgba(18, 20, 24, 0.055)',
  },
  dark: {
    paper: '#0e0f11',
    surface: '#16181b',
    rule: '#2a2d32',
    ink: '#eeeee9',
    muted: '#a9adb3',
    accentInk: '#ff8260',
    grid: 'rgba(238, 238, 233, 0.05)',
  },
};

function font(file) {
  return `data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}`;
}

// The mark from packages/brand/src/mark.ts: the chevron and its offset
// impression, on the graphite tile the icon uses.
function mark(size, outline) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="0.25" y="0.25" width="31.5" height="31.5" rx="7" fill="${GRAPHITE}" stroke="${outline}" stroke-width="0.5"/>
    <g style="mix-blend-mode:screen">
      <path d="M6 9l9 15 9-15" stroke="${VERMILION}" stroke-width="4.4" fill="none"/>
      <path d="M8 11l9 15 9-15" stroke="${CHALK}" stroke-width="4.4" fill="none"/>
    </g>
  </svg>`;
}

function page(theme, { width, height, social }) {
  const t = THEMES[theme];
  const steps = [
    ['Plan', 'done'],
    ['Stage', 'done'],
    ['Validate', 'done'],
    ['Accept', 'now'],
  ];
  const files = [
    ['src/App.tsx', 33],
    ['src/sections/Hero.tsx', 41],
    ['src/sections/Beans.tsx', 58],
    ['src/styles.css', 65],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Display; src: url(${font('bricolage-grotesque-5.3.0-latin-opsz-normal.woff2')}) format('woff2'); font-weight: 200 800; }
  @font-face { font-family: Text; src: url(${font('hanken-grotesk-5.3.0-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
  @font-face { font-family: Mono; src: url(${font('jetbrains-mono-5.3.0-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 800; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${width}px; height: ${height}px; }
  body {
    position: relative; overflow: hidden; background: ${t.paper}; color: ${t.ink};
    font-family: Text, sans-serif;
    background-image:
      linear-gradient(${t.grid} 1px, transparent 1px),
      linear-gradient(90deg, ${t.grid} 1px, transparent 1px);
    background-size: 32px 32px; background-position: -1px -1px;
  }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: ${social ? 16 : 10}px; background: ${VERMILION}; }
  .wrap { position: absolute; inset: 0 0 ${social ? 16 : 10}px 0; display: flex; align-items: center; justify-content: space-between; padding: 0 ${social ? 88 : 72}px; gap: 48px; }
  .brand { display: flex; align-items: center; gap: ${social ? 26 : 22}px; }
  .word { font-family: Display; font-weight: 700; font-size: ${social ? 132 : 104}px; letter-spacing: -0.035em; line-height: 0.9; font-variation-settings: 'opsz' 96; }
  .say { margin-top: ${social ? 34 : 24}px; font-family: Display; font-weight: 600; font-size: ${social ? 48 : 36}px; letter-spacing: -0.015em; }
  .say em { font-style: normal; color: ${t.accentInk}; }
  .sub { margin-top: 12px; font-size: ${social ? 26 : 20}px; color: ${t.muted}; max-width: ${social ? 640 : 560}px; line-height: 1.4; }
  .card { flex: none; width: ${social ? 420 : 390}px; background: ${t.surface}; border: 1px solid ${t.rule}; border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 0 ${t.rule}, 0 24px 48px -28px rgba(0,0,0,${theme === 'dark' ? 0.7 : 0.25}); }
  .steps { display: flex; gap: 14px; font-size: 15px; font-weight: 600; padding-bottom: 14px; border-bottom: 1px solid ${t.rule}; }
  .step { display: flex; align-items: center; gap: 7px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: ${VERMILION}; }
  .step.now .dot { box-shadow: 0 0 0 4px ${theme === 'dark' ? 'rgba(255,74,28,0.28)' : 'rgba(255,74,28,0.22)'}; }
  .files { list-style: none; padding: 12px 0 0; font-family: Mono; font-size: 14px; }
  .files li { display: flex; justify-content: space-between; padding: 6px 0; }
  .files span { color: ${t.muted}; }
  .foot { margin-top: 10px; font-size: 13px; color: ${t.muted}; font-family: Mono; }
  </style></head><body>
  <div class="wrap">
    <div>
      <div class="brand">${mark(social ? 112 : 88, theme === 'dark' ? t.rule : GRAPHITE)}<span class="word">vibld</span></div>
      <p class="say">Describe it. <em>Watch it build.</em></p>
      <p class="sub">The open-source AI app builder that hands you a real React project to read, run and move.</p>
    </div>
    <div class="card">
      <div class="steps">${steps.map(([name, state]) => `<span class="step ${state}"><i class="dot"></i>${name}</span>`).join('')}</div>
      <ul class="files">${files.map(([name, lines]) => `<li>${name}<span>${lines} lines</span></li>`).join('')}</ul>
      <p class="foot">11 files · checkpoint accepted</p>
    </div>
  </div>
  <div class="band"></div>
  </body></html>`;
}

async function main(argv) {
  const [deps] = argv;
  if (!deps) {
    console.error('Usage: node scripts/readme-images.mjs <deps>');
    process.exit(2);
  }
  const require = createRequire(join(resolve(deps), 'noop.js'));
  const { chromium } = require('playwright');
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ executablePath });
  mkdirSync(OUT, { recursive: true });
  const shots = [
    ['banner-light.png', 'light', { width: 1280, height: 360, social: false }],
    ['banner-dark.png', 'dark', { width: 1280, height: 360, social: false }],
    ['social-preview.png', 'dark', { width: 1280, height: 640, social: true }],
  ];
  try {
    for (const [name, theme, size] of shots) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: name === 'social-preview.png' ? 1 : 2,
      });
      const tab = await context.newPage();
      await tab.setContent(page(theme, size));
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: join(OUT, name) });
      await context.close();
      console.log(`Wrote docs/images/${name}`);
    }
  } finally {
    await browser.close();
  }
}

await main(process.argv.slice(2));
