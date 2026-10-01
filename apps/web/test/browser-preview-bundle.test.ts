import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import * as esbuild from 'esbuild-wasm';
import { scaffoldFiles } from '@vibld/ai';
import type { ProjectFile } from '@vibld/core';

import {
  BundleError,
  bundleProject,
  entriesOf,
  tidyAttributes,
  entryOf,
  moduleScriptsOf,
  normalizePath,
  scopedCssModule,
  viteEnv,
} from '../src/browser-preview/bundle.ts';
import {
  declaredRanges,
  importMapFor,
  isBareSpecifier,
  packageUrl,
  splitSpecifier,
} from '../src/browser-preview/import-map.ts';
import {
  addressedFrom,
  candidatesIn,
  compileStyles,
  hoistRemoteImports,
  rootedImports,
  StylesError,
} from '../src/browser-preview/styles.ts';

const require = createRequire(import.meta.url);

async function builtinStylesheets(): Promise<Record<string, string>> {
  const tailwind = (name: string) =>
    readFile(require.resolve(`tailwindcss/${name}`), 'utf8');
  return {
    tailwindcss: await tailwind('index.css'),
    'tailwindcss/preflight': await tailwind('preflight.css'),
    'tailwindcss/theme': await tailwind('theme.css'),
    'tailwindcss/utilities': await tailwind('utilities.css'),
    'tw-animate-css': await readFile(
      new URL(
        '../node_modules/tw-animate-css/dist/tw-animate.css',
        import.meta.url,
      ),
      'utf8',
    ),
  };
}

/** A project shaped the way a build writes one: the scaffold and the model's files. */
function project(own: ProjectFile[]): ProjectFile[] {
  return [
    ...scaffoldFiles(
      { title: 'Crumb & Co', description: 'A bakery in Austin.' },
      own,
    ),
    ...own,
  ];
}

const STYLES = `@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --primary: oklch(0.6 0.2 30);
}

@theme inline {
  --color-primary: var(--primary);
}
`;

const APP = `import { motion } from 'motion/react';
import { Croissant } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hero } from './components/Hero';
import data from './data.json';

export default function App() {
  return (
    <main className={cn('min-h-screen bg-primary', 'animate-in fade-in')}>
      <Croissant className="size-6" />
      <motion.h1 className="text-4xl font-bold">{data.name}</motion.h1>
      <Hero />
      <img src="/media/hero-loaf.jpg" alt="" />
    </main>
  );
}
`;

const HERO = `export function Hero() {
  return <section className="grid gap-4 md:grid-cols-2">Fresh daily</section>;
}
`;

const FILES = project([
  { path: 'src/styles.css', content: STYLES },
  { path: 'src/App.tsx', content: APP },
  { path: 'src/components/Hero.tsx', content: HERO },
  { path: 'src/data.json', content: '{"name":"Crumb & Co"}' },
]);

describe('the in-browser preview bundle (D125)', () => {
  it('bundles a scaffolded project from index.html, leaving packages to the CDN', async () => {
    const bundle = await bundleProject(esbuild, FILES);
    assert.match(bundle.js, /Fresh daily/);
    assert.match(bundle.js, /Crumb & Co/);
    assert.match(bundle.js, /from "motion\/react"/);
    assert.match(bundle.js, /from "react\/jsx-runtime"/);
    assert.doesNotMatch(bundle.js, /@\/lib\/utils/);
    assert.deepEqual(
      bundle.stylesheets.map((sheet) => sheet.path),
      ['src/styles.css'],
    );
    const imports = bundle.importMap.imports;
    assert.equal(imports['react'], 'https://esm.sh/react@%5E19.3.0');
    assert.equal(
      imports['react-dom/client'],
      'https://esm.sh/react-dom@%5E19.3.0/client?external=react',
    );
    assert.equal(
      imports['motion/react'],
      'https://esm.sh/motion@%5E13.4.4/react?external=react,react-dom',
    );
    assert.ok(imports['lucide-react']);
    assert.ok(imports['clsx']);
    assert.ok(imports['tailwind-merge']);
    assert.match(bundle.indexHtml, /<title>Crumb &amp; Co<\/title>/);
  });

  it('names the missing file when an import points nowhere', async () => {
    const broken = project([
      { path: 'src/styles.css', content: STYLES },
      {
        path: 'src/App.tsx',
        content: `import { Nope } from './components/Nope';\nexport default function App() { return <Nope />; }\n`,
      },
    ]);
    await assert.rejects(bundleProject(esbuild, broken), (error: unknown) => {
      assert.ok(error instanceof BundleError);
      assert.match(error.message, /Could not find \.\/components\/Nope/);
      return true;
    });
  });

  it('says where a syntax error is', async () => {
    const broken = project([
      { path: 'src/styles.css', content: STYLES },
      {
        path: 'src/App.tsx',
        content: `export default function App() {\n  return <main>;\n}\n`,
      },
    ]);
    await assert.rejects(bundleProject(esbuild, broken), (error: unknown) => {
      assert.ok(error instanceof BundleError);
      assert.match(error.message, /^src\/App\.tsx:\d+:\d+: /);
      return true;
    });
  });

  it('serves a public/ file imported by its root path as a URL', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      { path: 'public/logo.svg', content: '<svg/>' },
      {
        path: 'src/App.tsx',
        content: `import logo from '/logo.svg?url';\nexport default function App() { return <img src={logo} />; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    assert.match(bundle.js, /"\/logo\.svg"/);
  });

  it('keeps package and project stylesheets in the order the code imports them', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      { path: 'src/reset.css', content: '.reset { margin: 0; }' },
      {
        path: 'src/App.tsx',
        content: `import './reset.css';\nimport 'some-theme/theme.css';\nexport default function App() { return null; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    const order = bundle.stylesheets.map((sheet) => sheet.path);
    assert.ok(
      order.indexOf('src/reset.css') < order.indexOf('some-theme/theme.css'),
    );
    const css = await compileStyles({
      stylesheets: bundle.stylesheets.filter(
        (sheet) => sheet.path !== 'src/styles.css',
      ),
      files,
      builtin: {},
      ranges: new Map(),
      fetchText: async () => '.from-the-theme { color: red; }',
    });
    assert.ok(css.indexOf('.reset') < css.indexOf('.from-the-theme'));
  });

  it('takes an extensionless package stylesheet export for the CSS it is', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      {
        path: 'src/App.tsx',
        content: `import 'swiper/css';\nimport '@fontsource/inter';\nimport 'swiper/css/navigation';\nexport default function App() { return null; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    assert.deepEqual(bundle.stylesheets.map((sheet) => sheet.path).slice(1), [
      'swiper/css',
      '@fontsource/inter',
      'swiper/css/navigation',
    ]);
    assert.doesNotMatch(bundle.js, /swiper|fontsource/);
    const css = await compileStyles({
      stylesheets: bundle.stylesheets.slice(2, 3),
      files,
      builtin: {},
      ranges: new Map(),
      fetchText: async () => ({
        text: '@font-face { font-family: Inter; src: url(./files/inter.woff2); }',
        url: 'https://esm.sh/@fontsource/inter@5.3.0/index.css',
      }),
    });
    assert.match(
      css,
      /https:\/\/esm\.sh\/@fontsource\/inter@5\.3\.0\/files\/inter\.woff2/,
      'its fonts are read from where the CDN redirected to',
    );
  });

  it('finds a stylesheet imported by its plain name beside the importer', async () => {
    const css = await compileStyles({
      stylesheets: [
        { path: 'src/styles.css', content: '@import "theme.css";' },
      ],
      files: [{ path: 'src/theme.css', content: '.theme { color: red; }' }],
      builtin: {},
      ranges: new Map(),
      fetchText: async () => {
        throw new Error('not a package');
      },
    });
    assert.match(css, /\.theme/);
  });

  it('finds a stylesheet imported from the root in public/', async () => {
    const css = await compileStyles({
      stylesheets: [
        { path: 'src/styles.css', content: '@import "/theme.css";' },
      ],
      files: [{ path: 'public/theme.css', content: '.theme { color: red; }' }],
      builtin: {},
      ranges: new Map(),
      fetchText: async () => '',
    });
    assert.match(css, /\.theme/);
  });

  it('finds a stylesheet imported from the root with a query', async () => {
    const css = await compileStyles({
      stylesheets: [
        { path: 'src/styles.css', content: '@import "/src/theme.css?v=2";' },
      ],
      files: [{ path: 'src/theme.css', content: '.theme { color: red; }' }],
      builtin: {},
      ranges: new Map(),
      fetchText: async () => '',
    });
    assert.match(css, /\.theme/);
  });

  it('reads attributes written with space around the equals sign', () => {
    const indexHtml = `<link rel = stylesheet href = "/src/a.css"><div title="a = b"></div><script type = module src = /src/main.ts></script>`;
    assert.equal(
      tidyAttributes(indexHtml),
      `<link rel=stylesheet href="/src/a.css"><div title="a = b"></div><script type=module src=/src/main.ts></script>`,
    );
    assert.deepEqual(entriesOf(indexHtml), ['src/main.ts']);
  });

  it('runs every module script index.html loads from the project, in order', async () => {
    const indexHtml = `<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script><script type="module" src="/src/analytics.ts"></script><script type="module" src="https://cdn.example/x.js"></script></body></html>`;
    assert.deepEqual(entriesOf(indexHtml), [
      'src/main.tsx',
      'src/analytics.ts',
    ]);
    const bundle = await bundleProject(esbuild, [
      { path: 'index.html', content: indexHtml },
      { path: 'src/main.tsx', content: 'console.log("main");' },
      { path: 'src/analytics.ts', content: 'console.log("analytics");' },
    ]);
    assert.ok(bundle.js.indexOf('"main"') < bundle.js.indexOf('"analytics"'));
  });

  it('names the project files the code imports by URL, served at their own paths', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      { path: 'src/assets/logo.svg', content: '<svg/>' },
      { path: 'src/assets/mark.svg', content: '<svg/>' },
      {
        path: 'src/App.tsx',
        content: `import logo from './assets/logo.svg?url';\nimport mark from './assets/mark.svg';\nexport default function App() { return <><img src={logo} /><img src={mark} /></>; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    assert.match(bundle.js, /"\/src\/assets\/logo\.svg"/);
    assert.match(bundle.js, /"data:image\/svg\+xml,/, 'a plain import inlines');
    assert.deepEqual(bundle.projectAssets, ['src/assets/logo.svg']);
  });

  it('compiles a stylesheet index.html links from the project, quoted or not, ahead of the code', async () => {
    const indexHtml = `<!doctype html><html><head><link rel=stylesheet href=/src/base.css><link rel="stylesheet" href="https://fonts.example/a.css" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
    const bundle = await bundleProject(esbuild, [
      { path: 'index.html', content: indexHtml },
      { path: 'src/base.css', content: '@import "tailwindcss";' },
      { path: 'src/app.css', content: '.app {}' },
      { path: 'src/main.tsx', content: 'import "./app.css";' },
    ]);
    assert.deepEqual(
      bundle.stylesheets.map((sheet) => sheet.path),
      ['src/base.css', 'src/app.css'],
    );
    assert.doesNotMatch(bundle.indexHtml, /src\/base\.css/);
    assert.match(
      bundle.indexHtml,
      /<head><style data-vibld-styles><\/style><link rel="stylesheet" href="https/,
      'the compiled CSS goes where the link was',
    );
    assert.match(bundle.indexHtml, /fonts\.example\/a\.css/);
    assert.deepEqual(bundle.projectAssets, []);
  });

  it("puts the env files' VITE_ values on import.meta.env", async () => {
    const files = new Map(
      [
        {
          path: '.env',
          content:
            '# comment\nVITE_API_URL=https://api.example\nSECRET=hidden\nVITE_NAME="Crumb & Co" # trailing\n',
        },
        {
          path: '.env.development',
          content: "VITE_API_URL='https://dev.example'\n",
        },
      ].map((file) => [file.path, file]),
    );
    assert.deepEqual(viteEnv(files), {
      VITE_API_URL: 'https://dev.example',
      VITE_NAME: 'Crumb & Co',
    });
    assert.deepEqual(
      viteEnv(
        new Map([
          [
            '.env',
            {
              content:
                "ORIGIN=https://example.com\nVITE_API=${ORIGIN}/api\nVITE_WS=$ORIGIN/ws\nVITE_MODE=${MISSING:-light}\nVITE_PRICE=\\$5\nVITE_RAW='${ORIGIN}'\n",
            },
          ],
        ]),
      ),
      {
        VITE_API: 'https://example.com/api',
        VITE_WS: 'https://example.com/ws',
        VITE_MODE: 'light',
        VITE_PRICE: '$5',
        VITE_RAW: '${ORIGIN}',
      },
      'one variable expands in another, as Vite does',
    );
    const bundle = await bundleProject(esbuild, [
      ...files.values(),
      {
        path: 'index.html',
        content: '<script type="module" src="/src/main.ts"></script>',
      },
      {
        path: 'src/main.ts',
        content:
          'console.log(import.meta.env.VITE_API_URL, import.meta.env.MODE);',
      },
    ]);
    assert.match(bundle.js, /https:\/\/dev\.example/);
    assert.doesNotMatch(bundle.js, /hidden/);
  });

  it('reads a cache-busted entry as its file', async () => {
    assert.deepEqual(
      entriesOf('<script type="module" src="/src/main.tsx?v=2"></script>'),
      ['src/main.tsx'],
    );
    const bundle = await bundleProject(esbuild, [
      {
        path: 'index.html',
        content: '<script type="module" src="/src/main.tsx?v=2#x"></script>',
      },
      { path: 'src/main.tsx', content: 'console.log("main");' },
    ]);
    assert.match(bundle.js, /"main"/);
  });

  it("puts a classic script's code from the project in its place", async () => {
    const indexHtml = `<!doctype html><html><head><script src="/config.js" data-x="1"></script><script src="https://cdn.example/a.js"></script></head><body><script type="module" src="/src/main.ts"></script></body></html>`;
    const bundle = await bundleProject(esbuild, [
      { path: 'index.html', content: indexHtml },
      { path: 'public/config.js', content: 'window.CONFIG = "</script>";' },
      { path: 'src/main.ts', content: 'console.log(window);' },
    ]);
    assert.match(
      bundle.indexHtml,
      /<script data-x="1">window\.CONFIG = "<\\\/script>";<\/script><script src="https:\/\/cdn\.example\/a\.js"><\/script>/,
    );
    assert.deepEqual(bundle.projectAssets, []);
  });

  it('serves the project files an inline module script names', async () => {
    const indexHtml = `<!doctype html><html><head></head><body><script type="module">const icon = new URL('./src/icon.svg', import.meta.url); const logo = "/src/logo.png"; console.log(icon, logo);</script></body></html>`;
    const bundle = await bundleProject(esbuild, [
      { path: 'index.html', content: indexHtml },
      { path: 'src/icon.svg', content: '<svg/>' },
      { path: 'src/logo.png', content: 'png' },
    ]);
    assert.match(bundle.js, /new URL\("\/src\/icon\.svg", import\.meta\.url\)/);
    assert.deepEqual(bundle.projectAssets.sort(), [
      'src/icon.svg',
      'src/logo.png',
    ]);
  });

  it('keeps a package export named css that the code uses as code', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      {
        path: 'src/App.tsx',
        content: `import css from 'styled-jsx/css';\nimport 'swiper/css';\nexport const rule = css\`p { color: red; }\`;\nexport default function App() { return null; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    assert.ok('styled-jsx/css' in bundle.importMap.imports);
    assert.deepEqual(bundle.stylesheets.map((sheet) => sheet.path).slice(1), [
      'swiper/css',
    ]);
  });

  it('runs an inline module script of index.html, in its place among the entries', async () => {
    const indexHtml = `<!doctype html><html><head></head><body><script type="module">import './src/main.ts'; console.log("inline");</script><script type="module" src="/src/after.ts"></script></body></html>`;
    assert.equal(moduleScriptsOf(indexHtml).length, 2);
    assert.deepEqual(
      moduleScriptsOf('<script type=module src=/src/main.ts?v=1></script>'),
      [{ path: 'src/main.ts' }],
      'an unquoted src is read too',
    );
    const bundle = await bundleProject(esbuild, [
      { path: 'index.html', content: indexHtml },
      { path: 'src/main.ts', content: 'console.log("main");' },
      { path: 'src/after.ts', content: 'console.log("after");' },
    ]);
    const order = ['"main"', '"inline"', '"after"'].map((text) =>
      bundle.js.indexOf(text),
    );
    assert.ok(order.every((at) => at >= 0));
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
    );
    assert.doesNotMatch(bundle.indexHtml, /<script type="module">/);
    assert.match(bundle.indexHtml, /src="\/src\/after\.ts"/);
  });

  it('bundles a worker on its own, with its packages from the CDN', async () => {
    const bundle = await bundleProject(esbuild, [
      {
        path: 'package.json',
        content: JSON.stringify({ dependencies: { comlink: '^4.4.2' } }),
      },
      {
        path: 'index.html',
        content: '<script type="module" src="/src/main.ts"></script>',
      },
      {
        path: 'src/main.ts',
        content: `const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });\nworker.postMessage(1);`,
      },
      {
        path: 'src/worker.ts',
        content: `import { expose } from 'comlink';\nimport { double } from './math';\nconst n: number = 2;\nexpose({ run: () => double(n) });`,
      },
      {
        path: 'src/math.ts',
        content: 'export const double = (n: number) => n * 2;',
      },
    ]);
    assert.match(
      bundle.js,
      /new Worker\(new URL\("\/src\/worker\.ts", import\.meta\.url\)/,
    );
    assert.deepEqual(bundle.projectAssets, [], 'the raw file is not served');
    assert.equal(bundle.workers.length, 1);
    const [worker] = bundle.workers;
    assert.equal(worker!.path, 'src/worker.ts');
    assert.match(worker!.js, /from "https:\/\/esm\.sh\/comlink@%5E4\.4\.2"/);
    assert.match(worker!.js, /var double = /, 'its own imports are bundled in');
    assert.doesNotMatch(worker!.js, /: number/, 'TypeScript is compiled');
    assert.ok(!('comlink' in bundle.importMap.imports));
  });

  it("bundles a worker imported with Vite's ?worker as a constructor", async () => {
    const bundle = await bundleProject(esbuild, [
      {
        path: 'index.html',
        content: '<script type="module" src="/src/main.ts"></script>',
      },
      {
        path: 'src/main.ts',
        content: `import AppWorker from './worker.ts?worker';\nimport Hub from './hub.ts?sharedworker';\nnew AppWorker({ name: 'app' }).postMessage(1);\nnew Hub();`,
      },
      { path: 'src/worker.ts', content: 'self.onmessage = () => {};' },
      { path: 'src/hub.ts', content: 'self.onconnect = () => {};' },
    ]);
    assert.match(
      bundle.js,
      /new Worker\(new URL\("\/src\/worker\.ts", import\.meta\.url\), \{ type: "module"/,
    );
    assert.match(bundle.js, /new SharedWorker\(new URL\("\/src\/hub\.ts"/);
    assert.doesNotMatch(
      bundle.js,
      /onmessage|onconnect/,
      'not run in the page',
    );
    assert.deepEqual(
      bundle.workers.map((worker) => worker.path),
      ['src/worker.ts', 'src/hub.ts'],
    );
  });

  it('serves a project file the code names by its path from the root', async () => {
    const bundle = await bundleProject(esbuild, [
      {
        path: 'index.html',
        content: '<script type="module" src="/src/main.tsx"></script>',
      },
      {
        path: 'src/main.tsx',
        content: `const logo = <img src="/src/assets/logo.svg?v=1" />;\nconst gone = "/src/assets/gone.png";\nconst code = "/src/main.tsx";\nconsole.log(logo, gone, code);`,
      },
      { path: 'src/assets/logo.svg', content: '<svg/>' },
    ]);
    assert.deepEqual(bundle.projectAssets, ['src/assets/logo.svg']);
  });

  it('serves the project files index.html names itself, quoted or not', async () => {
    const indexHtml = `<!doctype html><html><head><link rel=icon href=./src/assets/icon.svg></head><body><img src="/src/assets/logo.png?v=2" srcset="/src/assets/logo.png 1x, /src/assets/logo@2x.png 2x" /><a href="/about">About</a><script type="module" src="/src/main.tsx"></script></body></html>`;
    const bundle = await bundleProject(esbuild, [
      { path: 'index.html', content: indexHtml },
      { path: 'src/main.tsx', content: 'console.log("main");' },
      { path: 'src/assets/icon.svg', content: '<svg/>' },
      { path: 'src/assets/logo.png', content: 'png' },
      { path: 'src/assets/logo@2x.png', content: 'png' },
    ]);
    assert.deepEqual(bundle.projectAssets, [
      'src/assets/icon.svg',
      'src/assets/logo.png',
      'src/assets/logo@2x.png',
    ]);
  });

  it('serves a file the code names with import.meta.url from the root', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      { path: 'src/assets/photo.png', content: 'png' },
      {
        path: 'src/App.tsx',
        content: `const photo = new URL('./assets/photo.png', import.meta.url).href;\nconst gone = new URL('./assets/gone.png', import.meta.url).href;\nexport default function App() { return <img src={photo + gone} />; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    assert.match(
      bundle.js,
      /new URL\("\/src\/assets\/photo\.png", import\.meta\.url\)/,
    );
    assert.match(bundle.js, /\.\/assets\/gone\.png/, 'a missing file is left');
    assert.deepEqual(bundle.projectAssets, ['src/assets/photo.png']);
  });

  it('scopes a CSS module and exports its class names', async () => {
    const files = project([
      { path: 'src/styles.css', content: STYLES },
      {
        path: 'src/Card.module.css',
        content: `.card { background: url(./bg.png); } .card-title:hover { margin: .5rem; } :global(.dark) .card { color: white; }`,
      },
      {
        path: 'src/App.tsx',
        content: `import styles, { card } from './Card.module.css';\nexport default function App() { return <div className={styles['card-title'] + card} />; }\n`,
      },
    ]);
    const bundle = await bundleProject(esbuild, files);
    const sheet = bundle.stylesheets.find(
      (entry) => entry.path === 'src/Card.module.css',
    )!;
    const { classes } = scopedCssModule(
      files.find((file) => file.path === 'src/Card.module.css')!.content,
      'src/Card.module.css',
    );
    assert.deepEqual(Object.keys(classes), ['card', 'card-title']);
    assert.match(classes.card!, /^_card_\w+$/);
    assert.ok(sheet.content.includes(`.${classes.card} {`));
    assert.ok(sheet.content.includes('url(./bg.png)'), 'a url() is left');
    assert.ok(
      sheet.content.includes('.dark .'),
      'a :global class keeps its name',
    );
    assert.ok(sheet.content.includes('margin: .5rem'));
    assert.ok(bundle.js.includes(JSON.stringify(classes.card)));
    assert.ok(bundle.js.includes(JSON.stringify(classes['card-title'])));
  });

  it('compiles the Tailwind stylesheet against the classes the code names', async () => {
    const bundle = await bundleProject(esbuild, FILES);
    const css = await compileStyles({
      stylesheets: bundle.stylesheets,
      files: FILES,
      builtin: await builtinStylesheets(),
      ranges: declaredRanges(
        FILES.find((file) => file.path === 'package.json')!.content,
      ),
      fetchText: async () => {
        throw new Error('no network in this test');
      },
    });
    assert.ok(
      css.startsWith("@import url('https://fonts.googleapis.com/"),
      'a font import leads the compiled stylesheet',
    );
    assert.match(css, /\.bg-primary\s*{/);
    assert.match(css, /\.min-h-screen\s*{/);
    assert.match(css, /\.md\\:grid-cols-2/);
    assert.match(css, /\.size-6\s*{/);
    assert.match(css, /\.fade-in\s*{/, 'tw-animate-css is compiled in');
    assert.doesNotMatch(css, /@import "tailwindcss"/);
    assert.doesNotMatch(css, /\.grid-cols-7\s*{/, 'only named classes');
  });

  it("reads a stylesheet's relative imports and files from its own directory", async () => {
    assert.equal(
      rootedImports(
        `@import "./theme.css";\n@import url('../x.css');\n@import "tailwindcss";\n@import url(https://fonts.example/a.css);`,
        'src/styles.css',
      ),
      `@import "/src/theme.css";\n@import "/x.css";\n@import "tailwindcss";\n@import url(https://fonts.example/a.css);`,
    );
    assert.equal(
      rootedImports('@import "./theme.css?v=2";', 'src/styles.css'),
      '@import "/src/theme.css";',
      'a query is dropped, so the import reads the file',
    );
    const files = [
      {
        path: 'src/theme.css',
        content:
          '.from-theme { background: url("./assets/hero.png"); }\n.gone { background: url(missing.png); }\n.root { background: url(/logo.svg); }\n.blur { filter: url("./assets/filters.svg#blur"); }\n.src-root { background: url("/src/assets/root.png?v=1"); }',
      },
      { path: 'src/assets/hero.png', content: 'png' },
      { path: 'src/assets/filters.svg', content: '<svg/>' },
      { path: 'src/assets/root.png', content: 'png' },
      { path: 'src/App.tsx', content: '' },
    ];
    const assets = new Set<string>();
    const css = await compileStyles({
      stylesheets: [
        { path: 'src/styles.css', content: '@import url("./theme.css");' },
      ],
      files,
      builtin: await builtinStylesheets(),
      ranges: new Map(),
      fetchText: async () => {
        throw new Error('no network in this test');
      },
      assets,
    });
    assert.match(
      css,
      /\.from-theme\s*{\s*background: url\("\/src\/assets\/hero\.png"\)/,
    );
    assert.match(css, /url\(\/logo\.svg\)/, 'a root path is left to public/');
    assert.match(
      css,
      /url\("\/src\/assets\/filters\.svg#blur"\)/,
      'a fragment is kept',
    );
    assert.deepEqual(
      [...assets],
      ['src/assets/hero.png', 'src/assets/filters.svg', 'src/assets/root.png'],
      'a project file named from the root is handed over too',
    );
  });

  it("reads a package stylesheet's relative references from the CDN", () => {
    assert.equal(
      addressedFrom(
        `@import "./base.css";\n@font-face { src: url(./files/a.woff2) format("woff2"), url('/x/b.woff') }\n.a { background: url(data:image/png;base64,AA) }`,
        'https://esm.sh/@fontsource/inter@5.2.0/index.css',
      ),
      `@import "https://esm.sh/@fontsource/inter@5.2.0/base.css";\n@font-face { src: url(https://esm.sh/@fontsource/inter@5.2.0/files/a.woff2) format("woff2"), url('https://esm.sh/x/b.woff') }\n.a { background: url(data:image/png;base64,AA) }`,
    );
  });

  it('refuses a Tailwind plugin it cannot load, by name', async () => {
    await assert.rejects(
      compileStyles({
        stylesheets: [
          {
            path: 'src/styles.css',
            content:
              '@import "tailwindcss";\n@plugin "@tailwindcss/typography";',
          },
        ],
        files: [],
        builtin: await builtinStylesheets(),
        ranges: new Map(),
        fetchText: async () => '',
      }),
      (error: unknown) => {
        assert.ok(error instanceof StylesError);
        assert.match(error.message, /@tailwindcss\/typography/);
        return true;
      },
    );
  });

  it('fetches another package stylesheet from the CDN at its declared range', async () => {
    const asked: string[] = [];
    const css = await compileStyles({
      stylesheets: [
        { path: 'src/styles.css', content: '@import "some-theme/base.css";' },
      ],
      files: [],
      builtin: {},
      ranges: new Map([['some-theme', '^2.0.0']]),
      fetchText: async (url) => {
        asked.push(url);
        return '.from-the-theme { color: red; }';
      },
    });
    assert.deepEqual(asked, ['https://esm.sh/some-theme@%5E2.0.0/base.css']);
    assert.match(css, /\.from-the-theme/);
  });
});

describe('import map pieces', () => {
  it('splits scoped and unscoped specifiers', () => {
    assert.deepEqual(splitSpecifier('@radix-ui/react-slot'), {
      name: '@radix-ui/react-slot',
      subpath: '',
    });
    assert.deepEqual(splitSpecifier('motion/react'), {
      name: 'motion',
      subpath: '/react',
    });
    assert.deepEqual(splitSpecifier('@scope/pkg/a/b'), {
      name: '@scope/pkg',
      subpath: '/a/b',
    });
  });

  it('tells packages from project paths', () => {
    assert.equal(isBareSpecifier('react'), true);
    assert.equal(isBareSpecifier('@radix-ui/react-slot'), true);
    assert.equal(isBareSpecifier('@/lib/utils'), false);
    assert.equal(isBareSpecifier('./App'), false);
    assert.equal(isBareSpecifier('/src/main.tsx'), false);
    assert.equal(isBareSpecifier('https://example.com/x.js'), false);
  });

  it('asks for an undeclared package at its latest', () => {
    assert.equal(
      packageUrl('canvas-confetti', new Map()),
      'https://esm.sh/canvas-confetti?external=react,react-dom',
    );
  });

  it('routes React Router in memory, since the preview has no URL to change', () => {
    const map = importMapFor(
      ['react-router-dom'],
      new Map([['react-router-dom', '^7.6.0']]),
    );
    const shim = map.imports['react-router-dom']!;
    assert.ok(shim.startsWith('data:text/javascript,'));
    const source = decodeURIComponent(
      shim.slice('data:text/javascript,'.length),
    );
    assert.match(
      source,
      /export \* from "https:\/\/esm\.sh\/react-router-dom@%5E7\.6\.0\?external=react,react-dom";/,
    );
    assert.match(source, /MemoryRouter as BrowserRouter/);
    assert.match(source, /createMemoryRouter as createBrowserRouter/);
  });

  it('maps React once for every package that uses it', () => {
    const map = importMapFor(['lucide-react'], new Map([['react', '^19']]));
    assert.deepEqual(Object.keys(map.imports), [
      'lucide-react',
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
    ]);
  });

  it('reads both dependency blocks and survives a broken package.json', () => {
    assert.deepEqual(
      [
        ...declaredRanges(
          '{"dependencies":{"a":"1"},"devDependencies":{"b":"^2"}}',
        ),
      ],
      [
        ['b', '^2'],
        ['a', '1'],
      ],
    );
    assert.equal(declaredRanges('{not json').size, 0);
  });
});

describe('small helpers', () => {
  it('finds the module script index.html loads', () => {
    assert.equal(
      entryOf('<script type="module" src="/src/main.tsx"></script>'),
      'src/main.tsx',
    );
    assert.equal(
      entryOf('<script src="./src/index.tsx" type="module"></script>'),
      'src/index.tsx',
    );
    assert.equal(entryOf('<p>no script</p>'), 'src/main.tsx');
  });

  it('normalizes paths', () => {
    assert.equal(normalizePath('/src/./components/../App.tsx'), 'src/App.tsx');
  });

  it('hoists remote imports and leaves Tailwind imports', () => {
    const { imports, rest } = hoistRemoteImports(
      `@import url("https://a.test/x.css");\n@import "tailwindcss";\n@import 'https://b.test/y.css' layer(base);\n`,
    );
    assert.deepEqual(imports, [
      '@import url("https://a.test/x.css");',
      "@import 'https://b.test/y.css' layer(base);",
    ]);
    assert.match(rest, /@import "tailwindcss";/);
  });

  it('collects class-like tokens from code, not from stylesheets', () => {
    const tokens = candidatesIn([
      {
        path: 'src/A.tsx',
        content: `<div className={cn('px-4', on && 'hover:bg-red-500')} />`,
      },
      { path: 'src/styles.css', content: '.not-scanned {}' },
    ]);
    assert.ok(tokens.includes('px-4'));
    assert.ok(tokens.includes('hover:bg-red-500'));
    assert.ok(!tokens.includes('.not-scanned'));
  });

  it('reads an arbitrary variant or value with quotes or a child selector inside it whole', () => {
    const tokens = candidatesIn([
      {
        path: 'src/Button.tsx',
        content: `const button = cva("inline-flex [&_svg:not([class*='size-'])]:size-4 before:content-['*'] [&>a]:underline");`,
      },
    ]);
    assert.ok(tokens.includes('[&>a]:underline'), 'a child selector too');
    assert.ok(tokens.includes("[&_svg:not([class*='size-'])]:size-4"));
    assert.ok(tokens.includes("before:content-['*']"));
    assert.ok(tokens.includes('inline-flex'));
  });
});
