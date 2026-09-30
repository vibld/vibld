/**
 * Draws each template's share image (docs/decisions.md, D106): its
 * mocked-up homepage beside its name and typefaces, 1200 by 630, as
 * `public/og/templates/<id>.jpg`, which its page names as og:image.
 *
 *   node scripts/template-og.mjs <deps> [id ...]
 *
 * after `pnpm --filter @vibld/marketing build`. <deps> is a directory where
 * playwright and sharp are installed, as for scripts/readme-images.mjs at
 * the repository root. The images are drawn from the built site itself, so
 * they show exactly what the template's page shows, in its own faces. Run
 * it again when a design's layout, palette or typefaces change.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CLIENT = join(ROOT, 'build', 'client');
const OUT = join(ROOT, 'public', 'og', 'templates');

const [deps, ...only] = process.argv.slice(2);
if (!deps) {
  console.error('usage: node scripts/template-og.mjs <deps> [id ...]');
  process.exit(2);
}
if (!existsSync(join(CLIENT, 'templates', 'index.html'))) {
  console.error('Build the site first: pnpm --filter @vibld/marketing build');
  process.exit(2);
}
const need = createRequire(join(resolve(deps), 'package.json'));
const { chromium } = need('playwright');
const sharp = need('sharp');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(CLIENT, path);
  if (existsSync(file) && statSync(file).isDirectory())
    file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
// The page's own analytics beacon has nowhere to go here.
await page.route('**/api/**', (route) => route.fulfill({ status: 204 }));

await page.goto(`${base}/templates/`);
const ids = only.length
  ? only
  : await page.$$eval('.lb-tpl[id^="template-"]', (items) =>
      items.map((li) => li.id.replace(/^template-/, '')),
    );
mkdirSync(OUT, { recursive: true });

for (const id of ids) {
  await page.goto(`${base}/templates/${id}/`);
  await page.evaluate(() => document.fonts.ready);
  const frame = await page.evaluate(() => {
    const preview = document.querySelector('.lb-tpl-hero .tp');
    const title = document.querySelector('h1')?.textContent ?? '';
    const faces = [...document.querySelectorAll('.lb-tpl-typeset__sample')].map(
      (el) => ({ text: el.textContent, font: el.style.fontFamily }),
    );
    if (!preview) return false;
    const bg = getComputedStyle(preview).getPropertyValue('--tp-bg');
    const fg = getComputedStyle(preview).getPropertyValue('--tp-fg');
    const card = document.createElement('div');
    card.id = 'og';
    card.style.cssText = `position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:420px 1fr;gap:36px;align-items:center;padding:48px;background:${bg};color:${fg};font-family:${preview.style.getPropertyValue('--tp-body')}`;
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:18px';
    const name = document.createElement('div');
    name.textContent = title;
    name.style.cssText = `font-family:${preview.style.getPropertyValue('--tp-display')};font-size:58px;font-weight:700;line-height:1.02`;
    left.append(name);
    for (const face of new Map(faces.map((f) => [f.text, f])).values()) {
      const line = document.createElement('div');
      line.textContent = face.text;
      line.style.cssText = `font-family:${face.font};font-size:30px;opacity:.9`;
      left.append(line);
    }
    const mark = document.createElement('div');
    mark.textContent = 'vibld.com/templates';
    mark.style.cssText =
      'margin-top:12px;font:600 18px system-ui,sans-serif;opacity:.7';
    left.append(mark);
    const right = preview.cloneNode(true);
    right.style.cssText +=
      ';width:100%;border-radius:14px;box-shadow:0 20px 50px rgb(0 0 0 / .25)';
    card.append(left, right);
    document.body.append(card);
    return true;
  });
  if (!frame) {
    console.error(`${id}: no preview on its page`);
    continue;
  }
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await sharp(png)
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(join(OUT, `${id}.jpg`));
  process.stdout.write('.');
}
console.log(`\nWrote ${ids.length} share images to public/og/templates/.`);
await browser.close();
server.close();
