#!/usr/bin/env node
/**
 * Take the first-screen screenshot of each built example, as the examples
 * page shows it: 1440x900, WebP.
 *
 *   node scripts/example-screenshots.mjs <built> <out> <deps>
 *
 * <built> is what `scripts/examples.mjs build` wrote, one directory per slug.
 * <deps> is a directory where playwright and sharp are installed; they are
 * not dependencies of the repository, because nothing but this script and
 * its workflow (.github/workflows/example-screenshots.yml) uses them.
 *
 * Each site is served from its own root, as it will be when published, so
 * its absolute asset paths resolve. The page is given time for its entrance
 * animations to settle before the shot, and runs with motion allowed: the
 * screenshot shows the page a visitor sees, not its reduced-motion form.
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [builtArg, outArg, depsArg] = process.argv.slice(2);
if (!builtArg || !outArg || !depsArg) {
  console.error(
    'usage: node scripts/example-screenshots.mjs <built> <out> <deps>',
  );
  process.exit(2);
}
const built = resolve(builtArg);
const out = resolve(outArg);
const require = createRequire(join(resolve(depsArg), 'package.json'));
const { chromium } = require('playwright');
const sharp = require('sharp');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve `root` on a free local port; an unknown path gets index.html. */
function serve(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(
      new URL(request.url ?? '/', 'http://x').pathname,
    );
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const index = join(file, 'index.html');
      file = existsSync(index) ? index : join(root, 'index.html');
    }
    response.writeHead(200, {
      'content-type':
        TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      done({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const slug of readdirSync(built).sort()) {
    const root = join(built, slug);
    if (!statSync(root).isDirectory()) continue;
    const { server, url } = await serve(root);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
    });
    // An uncaught error is a page that did not render: one example built
    // and showed a blank screen, because its script threw on load.
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForTimeout(3_000);
      if (errors.length > 0) {
        throw new Error(`the page threw: ${errors.join('; ')}`);
      }
      const png = await page.screenshot({ type: 'png' });
      await sharp(png)
        .webp({ quality: 82 })
        .toFile(join(out, `${slug}.webp`));
      console.log(`ok    ${slug}`);
    } catch (error) {
      failed += 1;
      console.log(
        `FAIL  ${slug}: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      await page.close();
      server.close();
    }
  }
} finally {
  await browser.close();
}
process.exitCode = failed > 0 ? 1 : 0;
