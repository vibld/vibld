#!/usr/bin/env node
/**
 * Records the README's moving pictures: short looping animated WebP files,
 * which GitHub plays inline where it will not play a video from the tree.
 *
 *   pnpm --filter @vibld/marketing build
 *   node scripts/readme-media.mjs <deps> [name ...]
 *
 * <deps> is a directory where playwright and sharp are installed, the same
 * arrangement as readme-images.mjs. With no names, every clip is recorded.
 *
 * Each clip is something real, not a mock-up of it:
 *
 * - `live-build`: vibld.com's own home-page builder, from the marketing
 *   site's production build, served here from build/client.
 * - `backdrops`: the four animated backgrounds a build can import
 *   (packages/ai/src/backdrops.ts), bundled from the exact source a project
 *   is given and run in Chromium.
 * - `terminal`: `pnpm generate --build` from a clean clone, replayed from
 *   the log of the proof run named in TERMINAL_RUN, faster than it ran.
 * - `styles`: a scroll down vibld.com/styles, from the same build.
 *
 * Writes docs/images/media-<name>.webp.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'images');
const FONTS = join(ROOT, 'apps', 'marketing', 'public', 'fonts');
const SITE = join(ROOT, 'apps', 'marketing', 'build', 'client');

// @vibld/brand's palette, as hex (packages/brand/src/palette.ts), as in
// readme-images.mjs. Vermilion is a fill, never a text colour.
const VERMILION = '#ff4a1c';
const INK = '#eeeee9';
const MUTED = '#a9adb3';
const ACCENT_INK = '#ff8260';
const PAPER = '#0e0f11';
const SURFACE = '#16181b';
const RULE = '#2a2d32';

/** Output width, frame rate and quality every clip shares. */
const WIDTH = 960;
const FPS = 10;
const QUALITY = 72;

function font(file) {
  return `data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}`;
}

const FACES = `
  @font-face { font-family: Display; src: url(${font('bricolage-grotesque-5.3.0-latin-opsz-normal.woff2')}) format('woff2'); font-weight: 200 800; }
  @font-face { font-family: Text; src: url(${font('hanken-grotesk-5.3.0-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
  @font-face { font-family: Mono; src: url(${font('jetbrains-mono-5.3.0-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 800; }`;

// ---------------------------------------------------------------------------
// Serving the marketing build

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.data': 'text/x-script',
};

/** A static server over build/client, as the site is served: /x is x/index.html. */
function serveSite() {
  try {
    statSync(join(SITE, 'index.html'));
  } catch {
    throw new Error(
      'apps/marketing/build/client is missing: run `pnpm --filter @vibld/marketing build` first.',
    );
  }
  const server = createServer((request, response) => {
    const path = normalize(
      decodeURIComponent(new URL(request.url, 'http://x').pathname),
    );
    const candidates = [join(SITE, path), join(SITE, path, 'index.html')];
    for (const file of candidates) {
      if (!file.startsWith(SITE)) break;
      try {
        if (!statSync(file).isFile()) continue;
        response.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        });
        response.end(readFileSync(file));
        return;
      } catch {
        // Try the next candidate.
      }
    }
    response.writeHead(404).end('Not found');
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Recording

/**
 * Frames of `target` (an element handle, or the page) taken on a wall clock,
 * for things that animate themselves.
 */
async function recordLive(tab, target, seconds) {
  const frames = [];
  const started = Date.now();
  for (let i = 0; i < seconds * FPS; i += 1) {
    const due = started + (i * 1000) / FPS;
    const wait = due - Date.now();
    if (wait > 0) await tab.waitForTimeout(wait);
    frames.push(await target.screenshot({ type: 'png' }));
  }
  return frames;
}

/** Frames of a page that draws itself for a given time, `window.frameAt(t)`. */
async function recordStepped(tab, seconds) {
  const frames = [];
  for (let i = 0; i < seconds * FPS; i += 1) {
    await tab.evaluate((t) => window.frameAt(t), i / FPS);
    frames.push(await tab.screenshot({ type: 'png' }));
  }
  return frames;
}

async function writeWebp(sharp, name, frames, width = WIDTH) {
  const resized = await Promise.all(
    frames.map((frame) => sharp(frame).resize({ width }).png().toBuffer()),
  );
  const file = join(OUT, `media-${name}.webp`);
  await sharp(resized, { join: { animated: true } })
    .webp({
      quality: QUALITY,
      effort: 6,
      smartSubsample: true,
      delay: resized.map(() => Math.round(1000 / FPS)),
      loop: 0,
    })
    .toFile(file);
  const kb = Math.round(statSync(file).size / 1024);
  console.log(
    `Wrote docs/images/media-${name}.webp (${frames.length} frames, ${kb} KB)`,
  );
}

// ---------------------------------------------------------------------------
// The clips

/** The home page's builder writing a site, as a visitor to vibld.com sees it. */
async function liveBuild({ browser, site }) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  await tab.goto(`${site}/`, { waitUntil: 'networkidle' });
  const builder = await tab.$('.lb-builder');
  if (!builder) throw new Error('No .lb-builder on the home page.');
  await builder.scrollIntoViewIfNeeded();
  const frames = await recordLive(tab, builder, 14);
  await context.close();
  return frames;
}

/** A slow scroll through the style presets. */
async function styles({ browser, site }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  await tab.goto(`${site}/styles`, { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  const height = await tab.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const travel = Math.min(height - 800, 4200);
  await tab.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    // Hold the start and the end for a moment; ease between them.
    window.frameAt = (t, total, travel) => {
      const p = Math.min(1, Math.max(0, (t - 1) / (total - 2)));
      const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      window.scrollTo(0, Math.round(eased * travel));
    };
  });
  const seconds = 10;
  const frames = [];
  for (let i = 0; i < seconds * FPS; i += 1) {
    await tab.evaluate(
      ([t, total, px]) => window.frameAt(t, total, px),
      [i / FPS, seconds, travel],
    );
    await tab.waitForTimeout(40);
    frames.push(await tab.screenshot({ type: 'png' }));
  }
  await context.close();
  return frames;
}

/** Colours for each backdrop in the clip, one mood apiece. */
const BACKDROP_COLORS = {
  AuroraMesh: ['#0b1026', '#ff4a1c', '#7c5cff', '#16c2d5'],
  ParticleField: ['#0e0f11', '#ffb199', '#ff4a1c', '#eeeee9'],
  GrainBlobs: ['#1a1030', '#ff7a59', '#f9c74f', '#8e7dff'],
  FlowLines: ['#07131a', '#5eead4', '#38bdf8', '#eeeee9'],
};

/**
 * Props beyond the colours, shown on each backdrop's label. At its default
 * speed GrainBlobs changes too little from one frame to the next for an
 * animated WebP, which keeps the old pixels in 8 by 8 blocks; faster, it
 * changes enough to be redrawn.
 */
const BACKDROP_PROPS = { GrainBlobs: { speed: 4 } };

/** The four backdrops, from the source a generated project is given. */
async function backdrops({ browser }) {
  const { BACKDROPS } = await import(
    join(ROOT, 'packages', 'ai', 'src', 'backdrops.ts')
  );
  const fromWeb = createRequire(join(ROOT, 'apps', 'web', 'package.json'));
  const esbuild = fromWeb('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'vibld-backdrops-'));
  for (const recipe of BACKDROPS) {
    writeFileSync(join(dir, `${recipe.component}.tsx`), recipe.source);
  }
  const names = BACKDROPS.map((recipe) => recipe.component);
  writeFileSync(
    join(dir, 'entry.tsx'),
    `import { createRoot } from 'react-dom/client';
${names.map((name) => `import { ${name} } from './${name}.tsx';`).join('\n')}
const COLORS = ${JSON.stringify(BACKDROP_COLORS)};
const PROPS: Record<string, Record<string, number>> = ${JSON.stringify(BACKDROP_PROPS)};
const CELLS = [${names.map((name) => `['${name}', ${name}]`).join(', ')}] as const;
createRoot(document.getElementById('root')!).render(
  <main className="grid">
    {CELLS.map(([name, Backdrop]) => (
      <section className="cell" key={name}>
        <Backdrop colors={COLORS[name]} {...(PROPS[name] ?? {})} />
        <span className="tag">
          &lt;{name}
          {Object.entries(PROPS[name] ?? {}).map(([prop, value]) => \` \${prop}={\${value}}\`)} /&gt;
        </span>
      </section>
    ))}
  </main>,
);
`,
  );
  const bundle = await esbuild.build({
    entryPoints: [join(dir, 'entry.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [join(ROOT, 'apps', 'web', 'node_modules')],
    logLevel: 'silent',
  });
  const script = bundle.outputFiles[0].text;

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const tab = await context.newPage();
  await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    ${FACES}
    * { box-sizing: border-box; margin: 0; }
    html, body { width: 1280px; height: 720px; background: ${PAPER}; overflow: hidden; }
    :root { --background: ${PAPER}; --primary: ${VERMILION}; --accent: #7c5cff; --secondary: #16c2d5; --foreground: ${INK}; }
    /* The Tailwind utilities the backdrop components use, and nothing else. */
    .pointer-events-none { pointer-events: none; } .absolute { position: absolute; } .inset-0 { inset: 0; }
    .-z-10 { z-index: -10; } .overflow-hidden { overflow: hidden; } .mix-blend-overlay { mix-blend-mode: overlay; }
    .block { display: block; } .h-full { height: 100%; } .w-full { width: 100%; }
    #root { width: 100%; height: 100%; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; padding: 10px; width: 100%; height: 100%; }
    .cell { position: relative; isolation: isolate; overflow: hidden; border-radius: 14px; border: 1px solid ${RULE}; background: ${SURFACE}; }
    .tag { position: absolute; left: 16px; bottom: 14px; font: 600 17px/1 Mono, monospace; color: ${INK}; background: rgba(14,15,17,0.72); border: 1px solid rgba(238,238,233,0.16); padding: 9px 12px; border-radius: 9px; }
  </style></head><body><div id="root"></div></body></html>`);
  await tab.addScriptTag({ content: script });
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(1500);
  const frames = await recordLive(tab, tab, 8);
  await context.close();
  return frames;
}

/**
 * The proof run the terminal replays: .github/workflows/clean-clone.yml on
 * 30 September 2026, DeepSeek's default model, one key and nothing else.
 */
const TERMINAL_RUN = 'the clean-clone proof run of 2026-09-30';

/**
 * The run's own lines, at their own timestamps, in the order it printed them;
 * `at` is when the line appears in the clip, in seconds.
 */
const TERMINAL_LINES = [
  { at: 0.2, kind: 'cmd', text: 'export DEEPSEEK_API_KEY=sk-...' },
  {
    at: 1.0,
    kind: 'cmd',
    text: 'pnpm generate "A one-page site for a neighbourhood bakery: what they bake, opening hours, a short menu with prices, and how to find them." --out ./site --build',
  },
  { at: 4.2, text: '[   0s] Planning the project' },
  { at: 4.7, text: '[  72s] Planning the project' },
  { at: 5.2, text: '[ 148s] Writing 1 of 5: styles' },
  { at: 5.6, text: '[ 205s] Writing 2 of 5: shared components' },
  { at: 6.0, text: '[ 387s] Writing 3 of 5: shared components' },
  { at: 6.4, text: '[ 396s] Writing 4 of 5: shared components' },
  { at: 6.8, text: '[ 737s] Writing 5 of 5: app shell' },
  { at: 7.4, text: '' },
  { at: 7.4, kind: 'dim', text: 'deepseek:deepseek-flash -- 752.5s' },
  { at: 7.6, text: '' },
  { at: 7.8, kind: 'file', text: 'src/styles.css                   233 lines' },
  { at: 7.9, kind: 'file', text: 'src/lib/hours.ts                 102 lines' },
  { at: 8.0, kind: 'file', text: 'src/components/Hero.tsx          154 lines' },
  { at: 8.1, kind: 'file', text: 'src/components/Menu.tsx          152 lines' },
  { at: 8.2, kind: 'file', text: 'src/components/Hours.tsx         131 lines' },
  { at: 8.3, kind: 'file', text: 'src/components/Visit.tsx         192 lines' },
  { at: 8.4, kind: 'file', text: 'src/App.tsx                       36 lines' },
  { at: 8.5, kind: 'file', text: 'DESIGN.md                       1007 lines' },
  { at: 8.6, kind: 'dim', text: '  ... 15 more' },
  { at: 8.9, text: '' },
  {
    at: 8.9,
    kind: 'dim',
    text: 'tokens over 11 steps: 177467 in / 190451 out, 162570 of it reasoning (147072 cached)',
  },
  { at: 9.4, text: 'wrote 23 files to ./site' },
  { at: 9.8, text: '' },
  { at: 9.8, text: 'building ./site with npm' },
  {
    at: 11.0,
    kind: 'ok',
    text: 'built: the project installs and builds with plain npm',
  },
];

const TERMINAL_SECONDS = 15;

async function terminal({ browser }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  await tab.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    ${FACES}
    * { box-sizing: border-box; margin: 0; }
    html, body { width: 1280px; height: 720px; overflow: hidden; background: ${PAPER}; }
    body { padding: 28px; font-family: Text, sans-serif; }
    .win { height: 100%; background: ${SURFACE}; border: 1px solid ${RULE}; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid ${RULE}; }
    .bar i { width: 11px; height: 11px; border-radius: 50%; background: ${RULE}; }
    .bar i:first-child { background: ${VERMILION}; }
    .bar b { margin-left: 10px; font: 600 14px/1 Mono, monospace; color: ${MUTED}; }
    pre { flex: 1; padding: 18px 22px; font: 400 16px/1.5 Mono, monospace; color: ${INK}; white-space: pre-wrap; word-break: break-word; overflow: hidden; }
    .cmd::before { content: '$ '; color: ${ACCENT_INK}; }
    .dim, .file { color: ${MUTED}; }
    .file { padding-left: 2ch; }
    .ok { color: #7ee2a8; }
    .caret { display: inline-block; width: 0.6em; height: 1.1em; vertical-align: -0.2em; background: ${INK}; }
  </style></head><body>
    <div class="win"><div class="bar"><i></i><i></i><i></i><b>~/vibld</b></div><pre id="out"></pre></div>
  </body></html>`);
  await tab.evaluate((lines) => {
    const out = document.getElementById('out');
    const TYPE_RATE = 70; // characters a second, for the typed commands
    window.frameAt = (t) => {
      out.textContent = '';
      let typing = false;
      for (const [index, line] of lines.entries()) {
        if (t < line.at) break;
        const span = document.createElement('span');
        if (line.kind) span.className = line.kind;
        let text = line.text;
        if (line.kind === 'cmd') {
          const next = lines[index + 1];
          const shown = Math.floor((t - line.at) * TYPE_RATE);
          if (shown < text.length && (!next || t < next.at)) {
            text = text.slice(0, shown);
            typing = true;
          }
        }
        span.textContent = text;
        out.append(span, '\n');
      }
      const last = lines.findLast((line) => t >= line.at);
      if (
        typing ||
        !last ||
        last.kind === 'ok' ||
        Math.floor(t * 2) % 2 === 0
      ) {
        const caret = document.createElement('span');
        caret.className = 'caret';
        out.lastChild?.remove();
        out.append(caret);
      }
      // Keep the newest line in view, as a terminal does.
      out.scrollTop = out.scrollHeight;
    };
  }, TERMINAL_LINES);
  await tab.evaluate(() => document.fonts.ready);
  const frames = await recordStepped(tab, TERMINAL_SECONDS);
  await context.close();
  return frames;
}

const CLIPS = {
  'live-build': { run: liveBuild, site: true },
  backdrops: { run: backdrops, site: false },
  terminal: { run: terminal, site: false },
  // Narrower: a scroll changes every pixel of every frame.
  styles: { run: styles, site: true, width: 720 },
};

async function main(argv) {
  const [deps, ...only] = argv;
  if (!deps) {
    console.error('Usage: node scripts/readme-media.mjs <deps> [name ...]');
    console.error(`Names: ${Object.keys(CLIPS).join(', ')}`);
    process.exit(2);
  }
  const unknown = only.filter((name) => !(name in CLIPS));
  if (unknown.length > 0) {
    console.error(`Unknown clip: ${unknown.join(', ')}`);
    process.exit(2);
  }
  const names = only.length > 0 ? only : Object.keys(CLIPS);
  const require = createRequire(join(resolve(deps), 'noop.js'));
  const { chromium } = require('playwright');
  const sharp = require('sharp');
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({
    executablePath,
    // WebGL through SwiftShader, for the aurora backdrop on a headless host.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const served = names.some((name) => CLIPS[name].site)
    ? await serveSite()
    : undefined;
  mkdirSync(OUT, { recursive: true });
  try {
    for (const name of names) {
      const frames = await CLIPS[name].run({ browser, site: served?.origin });
      await writeWebp(sharp, name, frames, CLIPS[name].width);
    }
  } finally {
    served?.close();
    await browser.close();
  }
  if (names.includes('terminal')) {
    console.log(`The terminal clip replays ${TERMINAL_RUN}.`);
  }
}

await main(process.argv.slice(2));
