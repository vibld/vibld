import { compile } from 'tailwindcss';
import type { ProjectFile } from '@vibld/core';

import { normalizePath } from './bundle.ts';
import { RELATIVE, rootedImports } from './css-paths.ts';

export { rootedImports };
import { packageStylesheetUrl, splitSpecifier } from './import-map.ts';

/**
 * A project's stylesheets compiled in the viewer's browser (D125).
 *
 * A generated project's src/styles.css is Tailwind 4 source (`@import
 * "tailwindcss"`, `@theme`, `@custom-variant`), which no browser reads as
 * it is. Tailwind's own compiler is plain JavaScript, so it runs here, on
 * the classes the project's files name, the way `@tailwindcss/vite` runs
 * it on the dev server.
 *
 * Stylesheets the compiler has to read come from three places: Tailwind's
 * own and tw-animate-css's, which the builder ships (`builtin`), the
 * project's files, and any other package's, fetched from the CDN as text.
 */

export class StylesError extends Error {
  override name = 'StylesError';
}

/** Stylesheets the builder ships, by the name a project imports them by. */
export type BuiltinStylesheets = Readonly<Record<string, string>>;

/**
 * A file's text by its URL; with the address it was read from after any
 * redirect, which its own relative addresses are resolved against.
 */
export type FetchText = (
  url: string,
) => Promise<string | { text: string; url: string }>;

/** The files Tailwind should look for class names in. */
const SCANNED = /\.(?:tsx|ts|jsx|js|mjs|html|md|mdx)$/i;

/** A class name with brackets, nested one deep, whose insides may hold quotes. */
const ARBITRARY_WITH_QUOTES =
  /[^\s"'`{}<>;\\[\]]*(?:\[(?:[^\s[\]]|\[[^\s[\]]*\])*\][^\s"'`{}<>;\\[\]]*)+/g;

/**
 * Every token in the project's code that could be a class name.
 *
 * Tailwind's own scanner (`@tailwindcss/oxide`) is native code, so this is
 * a plainer one: the text split on what cannot appear in a class name.
 * Whatever is not a real utility is ignored by the compiler, so a token
 * too many costs nothing; a token too few is a missing style, which is why
 * this splits on little.
 */
export function candidatesIn(files: readonly ProjectFile[]): string[] {
  const found = new Set<string>();
  for (const file of files) {
    if (!SCANNED.test(file.path)) continue;
    for (const token of file.content.split(/[\s"'`{}<>;\\]+/)) {
      if (token.length === 0 || token.length > 200) continue;
      found.add(token);
      // `className={cn('a', x && 'b')}` leaves pieces like `cn(a,`; the
      // edges are trimmed for a second try.
      const trimmed = token.replace(/^[(,=!?&|:]+|[),=!?&|:]+$/g, '');
      if (trimmed && trimmed !== token) found.add(trimmed);
    }
    // An arbitrary value or variant can hold quotes or a child selector of
    // its own (`[&_svg:not([class*='size-'])]:size-4`, `[&>a]:underline`), which the
    // split above breaks apart: it is read whole here.
    for (const [token] of file.content.matchAll(ARBITRARY_WITH_QUOTES)) {
      if (token.length <= 200 && /['"<>]/.test(token)) found.add(token);
    }
  }
  return [...found];
}

/**
 * `@import url(https://...)` and `@import "https://..."` lines, which load
 * at run time, taken out of a stylesheet so they can lead the compiled one:
 * a browser ignores an @import that comes after any other rule.
 */
export function hoistRemoteImports(css: string): {
  imports: string[];
  rest: string;
} {
  const imports: string[] = [];
  const rest = css.replace(
    /@import\s+(?:url\(\s*(['"]?)(?:https?:)?\/\/[^)]*\1\s*\)|(['"])(?:https?:)?\/\/[^'"]*\2)[^;]*;/gi,
    (statement) => {
      imports.push(statement.trim());
      return '';
    },
  );
  return { imports, rest };
}

/**
 * A package stylesheet's relative references (`url(./files/font.woff2)`,
 * `@import "./base.css"`) as CDN addresses, read from where the
 * stylesheet was fetched, since the compiled CSS is served from the page.
 */
export function addressedFrom(css: string, from: string): string {
  const absolute = (id: string) => {
    try {
      return new URL(id, from).href;
    } catch {
      return id;
    }
  };
  return css
    .replace(
      /(@import\s+)(['"])(\.\.?\/[^'"]*)\2/g,
      (_, lead: string, quote: string, id: string) =>
        `${lead}${quote}${absolute(id)}${quote}`,
    )
    .replace(
      /(^|[^\w-])url\(\s*(['"]?)([^'")]*)\2\s*\)/g,
      (reference, before: string, quote: string, id: string) =>
        RELATIVE.test(id.trim()) || /^\/(?!\/)/.test(id.trim())
          ? `${before}url(${quote}${absolute(id.trim())}${quote})`
          : reference,
    );
}

/**
 * The compiled CSS for `stylesheets` (the project's own, in import order),
 * with every class `files` name.
 */
export async function compileStyles(options: {
  stylesheets: readonly { path: string; content: string }[];
  files: readonly ProjectFile[];
  builtin: BuiltinStylesheets;
  ranges: ReadonlyMap<string, string>;
  fetchText: FetchText;
  /** Filled with the project files the stylesheets name by `url()`. */
  assets?: Set<string>;
}): Promise<string> {
  const { stylesheets, files, builtin, ranges, fetchText, assets } = options;
  const byPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const remote: string[] = [];
  const parts: string[] = [];
  for (const sheet of stylesheets) {
    const { imports, rest } = hoistRemoteImports(sheet.content);
    remote.push(...imports);
    parts.push(rootedImports(rest, sheet.path, byPath, assets));
  }
  if (parts.every((part) => part.trim() === '')) return remote.join('\n');

  const loadStylesheet = async (id: string, base: string) => {
    if (id in builtin) {
      return { path: id, base: '/', content: builtin[id]! };
    }
    if (id.startsWith('.') || id.startsWith('/')) {
      const bare = id.replace(/[?#].*$/, '');
      const path = normalizePath(
        bare.startsWith('/') ? bare : `${base.replace(/^\//, '')}/${bare}`,
      );
      // From the root, a file in public/ is served there too.
      const file =
        byPath.get(path) ??
        byPath.get(`${path}.css`) ??
        (bare.startsWith('/') ? byPath.get(`public/${path}`) : undefined);
      if (!file) throw new StylesError(`Could not find the stylesheet ${id}.`);
      const { imports, rest } = hoistRemoteImports(file.content);
      remote.push(...imports);
      return {
        path,
        base: '/',
        content: rootedImports(rest, file.path, byPath, assets),
      };
    }
    // A package's stylesheet: `pkg`, `pkg/file.css`, or a package whose
    // package.json names a `style` entry, which esm.sh serves at its root;
    // or one that a package's stylesheet imports, by its CDN address.
    const { name, subpath } = splitSpecifier(id);
    const url = /^https:\/\//.test(id)
      ? id
      : packageStylesheetUrl(subpath ? id : `${name}`, ranges);
    let text: string;
    let address = url;
    try {
      const fetched = await fetchText(url);
      if (typeof fetched === 'string') text = fetched;
      else ({ text, url: address } = fetched);
    } catch {
      throw new StylesError(`Could not load the stylesheet ${id} from ${url}.`);
    }
    return { path: id, base: '/', content: addressedFrom(text, address) };
  };

  let compiler: Awaited<ReturnType<typeof compile>>;
  try {
    compiler = await compile(parts.join('\n'), {
      base: '/',
      loadStylesheet,
      loadModule: async (id) => {
        throw new StylesError(
          `The in-browser preview cannot load the Tailwind plugin or config ${id}.`,
        );
      },
    });
  } catch (error) {
    if (error instanceof StylesError) throw error;
    throw new StylesError(
      `src/styles.css: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const css = compiler.build(candidatesIn(files));
  return [...remote, css].join('\n');
}
