import type * as esbuild from 'esbuild-wasm';
import type { ProjectFile } from '@vibld/core';

import {
  declaredRanges,
  importMapFor,
  isBareSpecifier,
  packageUrl,
} from './import-map.ts';
import type { ImportMap } from './import-map.ts';

/**
 * A project bundled in the viewer's browser (D125): what the dev server
 * would have served, from the project's files alone.
 *
 * esbuild bundles the project's own files from memory and leaves every
 * package import as written, for the page's import map to send to the CDN
 * (`import-map.ts`). Stylesheets are not bundled: they are collected in
 * import order for `styles.ts`, because a Tailwind stylesheet has to be
 * compiled before a browser can read it.
 *
 * The esbuild instance is passed in, so the same code runs on esbuild-wasm
 * in a Web Worker (`bundle-worker.ts`) and in the tests under Node.
 */

export type Esbuild = Pick<typeof esbuild, 'build'>;

export interface ProjectBundle {
  /** The project's own code, one ES module. */
  js: string;
  /**
   * Each stylesheet the code imports, in import order: a project file's
   * text, or for a package's, an `@import` of it.
   */
  stylesheets: { path: string; content: string }[];
  /**
   * Project files the code names by URL (`import logo from './logo.svg'`,
   * `?url`), each served at `/` and its path, as Vite's dev server would.
   */
  projectAssets: string[];
  /**
   * Each module the code starts as a worker (`new Worker(new URL(
   * './worker.ts', import.meta.url))`), bundled on its own and served at
   * its path. A worker has no import map, so its packages are named by
   * their CDN addresses.
   */
  workers: { path: string; js: string }[];
  importMap: ImportMap;
  /** The project's index.html, the page the preview is built on. */
  indexHtml: string;
}

export class BundleError extends Error {
  override name = 'BundleError';
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

const LOADERS: Record<string, esbuild.Loader> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.jsx': 'jsx',
  '.js': 'js',
  '.mjs': 'js',
  '.json': 'json',
  '.txt': 'text',
  '.md': 'text',
  '.svg': 'dataurl',
};

const DEFAULT_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

/** `import 'swiper/css';`: a module imported for its effect alone. */
const SIDE_EFFECT_IMPORT = /(?:^|[;\n}])\s*import\s*(['"])([^'"\n]+)\1/g;

/**
 * Whether a package import is a stylesheet: a `.css` file, or an export
 * that names one without the extension (`swiper/css`,
 * `swiper/css/navigation`, `@fontsource/inter`), which Vite resolves to
 * the CSS file the package's exports point at. Without the extension, only
 * an import made for its effect alone is taken for one, since a module
 * whose bindings are used (`import css from 'styled-jsx/css'`) is code.
 */
function isPackageStylesheet(
  specifier: string,
  sideEffectImports: ReadonlySet<string>,
): boolean {
  const bare = specifier.replace(/[?#].*$/, '');
  const extension = extensionOf(bare);
  if (extension) return extension === '.css';
  if (!sideEffectImports.has(specifier)) return false;
  return (
    /^@fontsource(?:-variable)?\//.test(bare) ||
    /^(?:@[^/]+\/)?[^/]+\/(?:.+\/)?css(?:\/|$)/.test(bare)
  );
}

/** `a/b/../c` as `a/c`, without a leading slash. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** An attribute's value in a tag's attributes, quoted or not. */
function attributeOf(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i',
  ).exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/**
 * index.html with each tag's attributes written `name=value`, as HTML also
 * allows them with space around the `=` (`<script type = module>`). Values
 * are kept as they are.
 */
export function tidyAttributes(html: string): string {
  return html.replace(
    /<[a-z][\w-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/gi,
    (tag) =>
      tag.replace(
        /(\s+[^\s"'>/=]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g,
        '$1=$2',
      ),
  );
}

/**
 * The module script index.html loads, as a project path: `src/main.tsx`
 * for every project Vibld scaffolds.
 */
export function entryOf(html: string): string {
  const indexHtml = tidyAttributes(html);
  const match =
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i.exec(
      indexHtml,
    ) ??
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i.exec(
      indexHtml,
    );
  return normalizePath(/^[^?#]*/.exec(match?.[1] ?? 'src/main.tsx')![0]);
}

/**
 * Every project file index.html loads as a module, in order: what the dev
 * server would run. A script from another address is left to the page.
 */
export function entriesOf(html: string): string[] {
  const indexHtml = tidyAttributes(html);
  const entries: string[] = [];
  for (const [tag] of indexHtml.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']?module\b/i.test(tag)) continue;
    const src = attributeOf(tag, 'src');
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    // `/src/main.tsx?v=2` is the file `src/main.tsx`.
    entries.push(normalizePath(/^[^?#]*/.exec(src)![0]));
  }
  return entries.length > 0 ? entries : [entryOf(indexHtml)];
}

/** A short, stable hash of `text`, for scoped class names. */
function hashOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 5);
}

/**
 * A CSS module (`Card.module.css`) as Vite's dev server serves it: each
 * class renamed to one scoped to the file, `.card` as `._card_x1y2z`, and
 * the names it was given, to export. A class under `:global(...)` keeps
 * its name; strings and `url()`s are left alone.
 */
export function scopedCssModule(
  css: string,
  path: string,
): { css: string; classes: Record<string, string> } {
  const hash = hashOf(path);
  const classes: Record<string, string> = {};
  const scoped = css.replace(
    /(\/\*[\s\S]*?\*\/|url\([^)]*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|:global\(([^)]*)\)|\.(-?[_a-zA-Z][\w-]*)/g,
    (
      _match: string,
      kept: string | undefined,
      global: string | undefined,
      name: string | undefined,
    ) => {
      if (kept !== undefined) return kept;
      if (global !== undefined) return global;
      const local = `_${name!}_${hash}`;
      classes[name!] = local;
      return `.${local}`;
    },
  );
  return { css: scoped, classes };
}

/** A CSS module's names as a module: the object by default, each by name. */
function cssModuleExports(classes: Record<string, string>): string {
  const lines = Object.entries(classes).map(
    ([name, local], index) =>
      `const _${index} = ${JSON.stringify(local)};\nexport { _${index} as ${JSON.stringify(name)} };`,
  );
  return [...lines, `export default ${JSON.stringify(classes)};`].join('\n');
}

/**
 * `new URL('./photo.png', import.meta.url)`: Vite serves the file and the
 * URL names it. In the preview the module has no address of its own, so
 * the path is written from the root, where the page serves the file.
 */
const META_URL =
  /\bnew\s+URL\(\s*(["'`])([^"'`$]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/** The env files Vite's dev server reads, later ones winning. */
const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
];

/**
 * The `VITE_*` values the project's env files declare: what the dev server
 * puts on `import.meta.env`.
 */
export function viteEnv(
  byPath: ReadonlyMap<string, { content: string }>,
): Record<string, string> {
  const all: Record<string, string> = {};
  const literal = new Set<string>();
  for (const name of ENV_FILES) {
    const content = byPath.get(name)?.content;
    if (content === undefined) continue;
    for (const line of content.split(/\r?\n/)) {
      const match =
        /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|`([^`]*)`|([^#]*?))\s*(?:#.*)?$/.exec(
          line,
        );
      if (!match) continue;
      const [, key, double, single, backtick, bare] = match;
      all[key!] =
        double !== undefined
          ? double.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1')
          : (single ?? backtick ?? bare ?? '');
      if (single !== undefined) literal.add(key!);
      else literal.delete(key!);
    }
  }
  // Vite expands one variable in another (`VITE_API=${VITE_ORIGIN}/api`,
  // `${NAME:-fallback}`), from any variable in the files, and `\$` is a
  // dollar sign. A single-quoted value is taken as written.
  const expand = (value: string, seen: ReadonlySet<string>): string =>
    value.replace(
      /(\\)?\$(?:\{([A-Za-z_][\w.]*)(?:(:?-)([^}]*))?\}|([A-Za-z_]\w*))?/g,
      (
        reference: string,
        escaped: string | undefined,
        braced: string | undefined,
        operator: string | undefined,
        fallback: string | undefined,
        plain: string | undefined,
      ) => {
        if (escaped) return reference.slice(1);
        const name = braced ?? plain;
        if (name === undefined) return reference;
        const raw = seen.has(name) ? undefined : all[name];
        if (raw === undefined || (operator === ':-' && raw === '')) {
          return fallback !== undefined ? expand(fallback, seen) : '';
        }
        return literal.has(name) ? raw : expand(raw, new Set([...seen, name]));
      },
    );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('VITE_')) continue;
    env[key] = literal.has(key) ? value : expand(value, new Set([key]));
  }
  return env;
}

/**
 * A package's CDN address for a worker, which has no import map: with its
 * own copy of what the page's packages would share, since nothing maps
 * `react` there.
 */
function workerPackageUrl(
  specifier: string,
  ranges: ReadonlyMap<string, string>,
): string {
  return packageUrl(specifier, ranges).replace(/\?external=[^&]*$/, '');
}

/** A quoted path from the root, `"/src/logo.svg"` or `'/logo.svg?v=2'`. */
const ROOTED_PATH = /["'`]\/([\w@.-][^"'`\s?#]*)(?:[?#][^"'`\s]*)?["'`]/g;

/** Code the bundle compiles, which is never served as a file. */
const SCRIPT = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;

/**
 * The module scripts index.html runs, in order: a project file it loads
 * (`src/main.tsx`) or the code of an inline one. A script from another
 * address is left to the page.
 */
export function moduleScriptsOf(
  html: string,
): ({ path: string } | { code: string })[] {
  const indexHtml = tidyAttributes(html);
  const scripts: ({ path: string } | { code: string })[] = [];
  for (const [, attributes, body] of indexHtml.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (!/\btype=["']?module["']?/i.test(attributes!)) continue;
    const src = attributeOf(attributes!, 'src');
    if (src === undefined) {
      scripts.push({ code: body! });
    } else if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
      scripts.push({ path: normalizePath(/^[^?#]*/.exec(src)![0]) });
    }
  }
  return scripts;
}

/** The project's entries as one module, which runs each in order. */
const ENTRIES = 'vibld:entries';

/** An inline module script of index.html, by its place among them. */
const INLINE = 'vibld:inline/';

/** The tsconfig the project declares, for esbuild's JSX and decorator settings. */
function tsconfigOf(raw: string | undefined): esbuild.TsconfigRaw {
  const fallback: esbuild.TsconfigRaw = {
    compilerOptions: { jsx: 'react-jsx' },
  };
  if (!raw) return fallback;
  try {
    // Comments and trailing commas are allowed in a tsconfig.
    const parsed = JSON.parse(
      raw
        .replace(/\/\*[\s\S]*?\*\/|(?<![:"'])\/\/[^\n]*/g, '')
        .replace(/,(\s*[}\]])/g, '$1'),
    ) as esbuild.TsconfigRaw;
    return typeof parsed === 'object' && parsed !== null ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Bundle `files` from their index.html's module script.
 *
 * Throws `BundleError` with esbuild's first message when the code does not
 * compile or imports a project file that is not there: the same failures
 * the dev server would show, said in the pane instead.
 */
export async function bundleProject(
  builder: Esbuild,
  files: readonly ProjectFile[],
): Promise<ProjectBundle> {
  const byPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const sourceHtml = tidyAttributes(
    byPath.get('index.html')?.content ?? DEFAULT_INDEX_HTML,
  );
  const scripts = moduleScriptsOf(sourceHtml);
  if (scripts.length === 0) scripts.push({ path: entryOf(sourceHtml) });
  const entries = scripts.flatMap((script) =>
    'path' in script ? [script.path] : [],
  );
  for (const path of entries) {
    if (!byPath.has(path)) {
      throw new BundleError(`index.html loads ${path}, which is not a file.`);
    }
  }
  const inline = scripts.flatMap((script) =>
    'code' in script ? [script.code] : [],
  );
  const entry =
    scripts.length === 1 && entries.length === 1 ? entries[0]! : ENTRIES;
  const ranges = declaredRanges(byPath.get('package.json')?.content);
  const external = new Set<string>();
  const stylesheets: { path: string; content: string }[] = [];
  const seenStylesheets = new Set<string>();
  const projectAssets = new Set<string>();
  const cssModules = new Map<string, Record<string, string>>();
  const workerEntries = new Set<string>();
  const sideEffectImports = new Set<string>();
  let bundlingWorker = false;
  // A stylesheet index.html links from the project (`<link rel="stylesheet"
  // href="/src/styles.css">`) is one Vite compiles: it leads the code's own,
  // and its tag gives way to the compiled CSS, put where the first was so
  // the page's own styles after it still come after it.
  let placed = false;
  // An inline module script is bundled, so it leaves the page.
  const withoutInline = sourceHtml.replace(
    /<script\b(?=[^>]*\btype=["']?module["']?)(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi,
    '',
  );
  // A classic script index.html loads from the project (`<script
  // src="/config.js">`, a file in public/) runs as the page is read, before
  // the page could be handed the file, so its code is put in its place.
  const withClassic = withoutInline.replace(
    /<script\b([^>]*)>\s*<\/script>/gi,
    (tag, attributes: string) => {
      const type = attributeOf(attributes, 'type');
      if (
        type !== undefined &&
        !/^(?:text|application)\/javascript$/i.test(type)
      ) {
        return tag;
      }
      const src = attributeOf(attributes, 'src');
      if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return tag;
      const path = normalizePath(/^[^?#]*/.exec(src)![0]);
      const file = byPath.get(path) ?? byPath.get(`public/${path}`);
      if (!file) return tag;
      const rest = attributes.replace(
        /\s+src=(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i,
        '',
      );
      return `<script${rest}>${file.content.replace(/<\/script/gi, '<\\/script')}</script>`;
    },
  );
  const indexHtml = withClassic.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel=["']?stylesheet["']?/i.test(tag)) return tag;
    const href = attributeOf(tag, 'href') ?? '';
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return tag;
    const path = normalizePath(/^[^?#]*/.exec(href)![0]);
    if (extensionOf(path) !== '.css' || !byPath.has(path)) return tag;
    if (!seenStylesheets.has(path)) {
      seenStylesheets.add(path);
      stylesheets.push({ path, content: byPath.get(path)!.content });
    }
    if (placed) return '';
    placed = true;
    return '<style data-vibld-styles></style>';
  });
  // index.html can name a project file itself (`<img src="/src/logo.png">`),
  // which the dev server serves at its path.
  for (const [, name, single, unquoted] of indexHtml.matchAll(
    /\s(?:src|href|poster|srcset)=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
  )) {
    const value = name ?? single ?? unquoted ?? '';
    for (const candidate of value.split(',')) {
      const reference = candidate.trim().split(/\s+/)[0] ?? '';
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
      const path = normalizePath(/^[^?#]*/.exec(reference)![0]);
      if (byPath.has(path) && !entries.includes(path)) projectAssets.add(path);
    }
  }

  function find(path: string): string | null {
    const base = normalizePath(path);
    if (byPath.has(base) && extensionOf(base) !== '') return base;
    for (const extension of EXTENSIONS) {
      if (byPath.has(base + extension)) return base + extension;
    }
    for (const extension of EXTENSIONS) {
      if (byPath.has(`${base}/index${extension}`)) {
        return `${base}/index${extension}`;
      }
    }
    return byPath.has(base) ? base : null;
  }

  const plugin: esbuild.Plugin = {
    name: 'vibld-project',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const [specifier, query = ''] = args.path.split('?', 2) as [
          string,
          string?,
        ];
        if (args.kind === 'entry-point') {
          return specifier === ENTRIES
            ? { path: ENTRIES, namespace: 'entries' }
            : { path: normalizePath(specifier), namespace: 'project' };
        }
        if (specifier.startsWith(INLINE)) {
          return { path: specifier, namespace: 'inline' };
        }
        if (isBareSpecifier(specifier)) {
          if (bundlingWorker) {
            return isPackageStylesheet(specifier, sideEffectImports)
              ? { path: specifier, namespace: 'empty' }
              : { path: workerPackageUrl(specifier, ranges), external: true };
          }
          if (isPackageStylesheet(specifier, sideEffectImports)) {
            // In its place among the project's own, so the cascade is
            // Vite's; styles.ts fetches it from the CDN.
            if (!seenStylesheets.has(specifier)) {
              seenStylesheets.add(specifier);
              stylesheets.push({
                path: specifier,
                content: `@import ${JSON.stringify(specifier)};`,
              });
            }
            return { path: specifier, namespace: 'empty' };
          }
          external.add(specifier);
          return { path: specifier, external: true };
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
          return { path: specifier, external: true };
        }
        const from =
          args.importer && args.namespace === 'project'
            ? dirname(args.importer)
            : '';
        const target = specifier.startsWith('@/')
          ? `src/${specifier.slice(2)}`
          : specifier.startsWith('/')
            ? specifier
            : `${from}/${specifier}`;
        const found = find(target);
        if (!found) {
          // A file under public/ is served at the root by Vite, and an
          // import of one is a URL.
          const publicPath = normalizePath(`public/${normalizePath(target)}`);
          if (byPath.has(publicPath)) {
            return {
              path: publicPath,
              namespace: 'url',
              pluginData: `/${normalizePath(target)}`,
            };
          }
          return {
            errors: [
              {
                text: `Could not find ${specifier} (imported from ${args.importer || entry}).`,
              },
            ],
          };
        }
        if (query === 'raw') return { path: found, namespace: 'raw' };
        // `import AppWorker from './worker.ts?worker'`: a constructor that
        // starts the file, bundled as a worker of its own.
        const flags = query.split('&');
        if (flags.includes('worker') || flags.includes('sharedworker')) {
          workerEntries.add(found);
          return {
            path: found,
            namespace: 'worker-constructor',
            pluginData: flags.includes('sharedworker')
              ? 'SharedWorker'
              : 'Worker',
          };
        }
        if (query === 'url') {
          projectAssets.add(found);
          return { path: found, namespace: 'url', pluginData: `/${found}` };
        }
        if (extensionOf(found) === '.css') {
          const isModule = /\.module\.css$/i.test(found);
          if (!seenStylesheets.has(found)) {
            seenStylesheets.add(found);
            let content = byPath.get(found)!.content;
            if (isModule) {
              const scoped = scopedCssModule(content, found);
              content = scoped.css;
              cssModules.set(found, scoped.classes);
            }
            stylesheets.push({ path: found, content });
          }
          return { path: found, namespace: isModule ? 'css-module' : 'empty' };
        }
        return { path: found, namespace: 'project' };
      });

      // Code names project files by `new URL('./x', import.meta.url)` and
      // by their path from the root (`<img src="/src/assets/logo.svg" />`),
      // which the dev server serves there. It also says which packages it
      // imports only for their effect, as a stylesheet is.
      const withProjectUrls = (code: string, path: string): string => {
        for (const [, , specifier] of code.matchAll(SIDE_EFFECT_IMPORT)) {
          sideEffectImports.add(specifier!);
        }
        const contents = code.replace(
          META_URL,
          (
            match: string,
            _quote: string,
            specifier: string,
            offset: number,
            source: string,
          ) => {
            if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return match;
            const target = specifier.startsWith('/')
              ? normalizePath(specifier)
              : normalizePath(`${dirname(path)}/${specifier}`);
            if (!byPath.has(target)) return match;
            const startsWorker =
              /\bnew\s+(?:Shared)?Worker\(\s*$/.test(
                source.slice(Math.max(0, offset - 40), offset),
              ) && LOADERS[extensionOf(target)] !== undefined;
            if (startsWorker) workerEntries.add(target);
            else projectAssets.add(target);
            return `new URL(${JSON.stringify(`/${target}`)}, import.meta.url)`;
          },
        );
        for (const [, rootedPath] of contents.matchAll(ROOTED_PATH)) {
          if (
            rootedPath !== 'index.html' &&
            byPath.has(rootedPath!) &&
            !SCRIPT.test(rootedPath!) &&
            !workerEntries.has(rootedPath!)
          ) {
            projectAssets.add(rootedPath!);
          }
        }
        return contents;
      };

      build.onLoad({ filter: /.*/, namespace: 'project' }, (args) => {
        const file = byPath.get(args.path)!;
        const loader = LOADERS[extensionOf(args.path)];
        if (!loader) {
          // An asset the browser would fetch by URL: an image, a font.
          projectAssets.add(args.path);
          return {
            contents: `export default ${JSON.stringify(`/${args.path}`)};`,
            loader: 'js',
          };
        }
        const contents =
          loader === 'json' || loader === 'text'
            ? file.content
            : withProjectUrls(file.content, args.path);
        return { contents, loader, resolveDir: '/' };
      });
      build.onLoad({ filter: /.*/, namespace: 'css-module' }, (args) => ({
        contents: cssModuleExports(cssModules.get(args.path) ?? {}),
        loader: 'js',
      }));
      build.onLoad({ filter: /.*/, namespace: 'entries' }, () => {
        let inlineIndex = 0;
        return {
          contents: scripts
            .map(
              (script) =>
                `import ${JSON.stringify('path' in script ? `/${script.path}` : `${INLINE}${inlineIndex++}`)};`,
            )
            .join('\n'),
          loader: 'js',
          resolveDir: '/',
        };
      });
      // An inline script sits in index.html, at the root.
      build.onLoad({ filter: /.*/, namespace: 'inline' }, (args) => ({
        contents: withProjectUrls(
          inline[Number(args.path.slice(INLINE.length))] ?? '',
          'index.html',
        ),
        loader: 'js',
        resolveDir: '/',
      }));
      build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
        contents: byPath.get(args.path)!.content,
        loader: 'text',
      }));
      build.onLoad({ filter: /.*/, namespace: 'url' }, (args) => ({
        contents: `export default ${JSON.stringify(args.pluginData as string)};`,
        loader: 'js',
      }));
      build.onLoad(
        { filter: /.*/, namespace: 'worker-constructor' },
        (args) => {
          const kind = args.pluginData as string;
          return {
            contents: `export default function ${kind}Wrapper(options) {\n  return new ${kind}(new URL(${JSON.stringify(`/${args.path}`)}, import.meta.url), { type: 'module', name: options?.name });\n}\n`,
            loader: 'js',
          };
        },
      );
      build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({
        contents: '',
        loader: 'js',
      }));
    },
  };

  async function run(entryPoint: string): Promise<string> {
    let result: esbuild.BuildResult;
    try {
      result = await builder.build({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        jsx: 'automatic',
        tsconfigRaw: tsconfigOf(byPath.get('tsconfig.json')?.content),
        define: {
          'import.meta.env': JSON.stringify({
            ...viteEnv(byPath),
            MODE: 'development',
            DEV: true,
            PROD: false,
            SSR: false,
            BASE_URL: '/',
          }),
          'process.env.NODE_ENV': '"development"',
        },
        logLevel: 'silent',
        plugins: [plugin],
      });
    } catch (error) {
      const failure = error as { errors?: esbuild.Message[] };
      const first = failure.errors?.[0];
      if (first) throw new BundleError(describe(first));
      throw new BundleError(
        error instanceof Error
          ? error.message
          : 'The project could not be bundled.',
      );
    }
    return result.outputFiles?.[0]?.text ?? '';
  }

  const output = await run(entry);
  // A worker can start workers of its own, which join the set as it is read.
  bundlingWorker = true;
  const workers: { path: string; js: string }[] = [];
  for (const path of workerEntries) {
    workers.push({ path, js: await run(path) });
  }
  return {
    js: output,
    stylesheets,
    projectAssets: [...projectAssets],
    workers,
    importMap: importMapFor(external, ranges),
    indexHtml,
  };
}

/** One esbuild message as a line a person can act on. */
export function describe(message: esbuild.Message): string {
  const where = message.location
    ? `${message.location.file.replace(/^project:/, '')}:${message.location.line}:${message.location.column + 1}: `
    : '';
  return `${where}${message.text}`;
}
