import type { ProjectFile } from '@vibld/core';

import { backdropFiles, isBackdropPath } from './backdrops.ts';
import {
  OPTIONAL_PACKAGES,
  STACK_PACKAGES,
  stackDependencies,
} from './stack.ts';

/**
 * The files of a generated project that Vibld writes itself rather than
 * asking the model for (docs/decisions.md, D71, "Template ours only").
 *
 * Every build used to have the model type these out: package.json from a
 * version list the prompt dictated, a tsconfig.json and a vite.config.ts
 * the prompt described almost line by line, a main.tsx and a utils.ts that
 * were identical in every example, and a README derived from the scripts.
 * About 16% of a build's visible output, plus the reasoning behind it, on
 * files with one right answer, and the tsconfig was where the prompt spent
 * the most words preventing a build error. So they are templated here, from
 * the stack (`stack.ts`) and the plan: its title and description, and the
 * packages its files import.
 *
 * What stays the model's: src/styles.css, src/App.tsx, src/lib/motion.ts,
 * pages and components, and the shadcn/ui primitives. No shadcn/ui source is
 * vendored here.
 *
 * The facts the model needs about these files (the alias, what main.tsx
 * imports, what utils.ts exports) are stated in `SCAFFOLD_SECTION`, which
 * is written from the same constants as the files, so the prompt cannot
 * come to describe a template that is no longer the one written.
 */

/** The paths written by `scaffoldFiles`, never by the model. */
export const SCAFFOLD_PATHS = [
  'package.json',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'src/main.tsx',
  'src/lib/utils.ts',
  'README.md',
] as const;

export type ScaffoldPath = (typeof SCAFFOLD_PATHS)[number];

const SCAFFOLD_SET = new Set<string>(SCAFFOLD_PATHS);

export function isScaffoldPath(path: string): path is ScaffoldPath {
  return SCAFFOLD_SET.has(path);
}

/**
 * Whether Vibld writes the file at `path` rather than the model: a scaffold
 * file, or an animated background (`backdrops.ts`).
 */
export function isTemplatedPath(path: string): boolean {
  return isScaffoldPath(path) || isBackdropPath(path);
}

/** A package beyond the stack, as an outline declares it. */
export interface ExtraDependency {
  name: string;
  version: string;
}

/** What the templates take from the plan. */
export interface ScaffoldInput {
  /** The site's name, for the browser tab, the README and package.json. */
  title: string;
  /** One sentence, for the meta description and the README. */
  description: string;
  /**
   * Packages beyond the stack the outline said its files import, with the
   * range to declare them at. Only the ones a file actually imports are
   * declared; this list supplies their versions.
   */
  dependencies?: readonly ExtraDependency[];
  /**
   * The title and description the outline of a follow-up gave, only where
   * it gave them (no fallback), for `retitledIndexHtml`: a follow-up that
   * renames or re-describes the site changes them in the project's own
   * index.html. Absent on a repair, which never renames anything.
   */
  retitle?: { title?: string; description?: string };
}

/**
 * The scripts every project declares. `build` type-checks before it
 * bundles: Vite strips types without checking them, so a build without tsc
 * ships a type error as a crash on load.
 */
export const PROJECT_SCRIPTS = {
  dev: 'vite',
  build: 'tsc --noEmit && vite build',
  preview: 'vite preview',
  lint: 'tsc --noEmit',
  typecheck: 'tsc --noEmit',
} as const;

/** The alias every import of a project file outside its folder goes through. */
export const SOURCE_ALIAS = { name: '@', target: './src' } as const;

/**
 * The settings `npm create vite@latest` produces for React and TypeScript,
 * with the two the prompt's TYPESCRIPT rules are written against
 * (`verbatimModuleSyntax`, `isolatedModules`), Vite's client types so
 * `import './styles.css'` compiles, and the `@/*` path shadcn/ui components
 * import through. No `baseUrl`: TypeScript 7 removed it (TS5102), and
 * `paths` resolves from the tsconfig's own folder without it.
 */
export const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    types: ['vite/client', 'node'],
    paths: { [`${SOURCE_ALIAS.name}/*`]: [`${SOURCE_ALIAS.target}/*`] },
  },
  include: ['src'],
} as const;

export const VITE_CONFIG = `import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '${SOURCE_ALIAS.name}': fileURLToPath(new URL('${SOURCE_ALIAS.target}', import.meta.url)),
    },
  },
});
`;

export const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('The #root element is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

export const UTILS_TS = `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

/** Items joined with commas, wrapped to the prompt's width under a list item. */
function wrapped(items: readonly string[], width = 76, indent = '  '): string {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    const next = line === '' ? item : `${line}, ${item}`;
    if (indent.length + next.length + 1 > width && line !== '') {
      lines.push(`${line},`);
      line = item;
    } else {
      line = next;
    }
  }
  lines.push(`${line}.`);
  return lines.map((text) => indent + text).join('\n');
}

/**
 * What the prompt tells the model about the files it no longer writes: the
 * FILES WRITTEN FOR YOU section of the outline and file-group prompts.
 */
export const SCAFFOLD_SECTION = `FILES WRITTEN FOR YOU
These files are written by the build itself, from the stack and the plan.
Never plan, write or delete them:
${wrapped([...SCAFFOLD_PATHS])}
What they hold, so the files you write fit them:
- package.json: every package in STACK at its range, any package the plan's
  dependencies name that a file imports, and the scripts:
${wrapped(Object.entries(PROJECT_SCRIPTS).map(([name, command]) => `"${name}" (${command})`))}
- tsconfig.json: strict, with isolatedModules and verbatimModuleSyntax,
  "allowImportingTsExtensions" with "noEmit" (so an import can name
  ./App.tsx), "types": ["vite/client", "node"] (so the import of
  src/styles.css compiles), and "${SOURCE_ALIAS.name}/*" mapped to "${SOURCE_ALIAS.target}/*". It
  compiles only src/.
- vite.config.ts: plugins react() and tailwindcss(), and the same alias,
  '${SOURCE_ALIAS.name}' to ${SOURCE_ALIAS.target}.
- index.html: lang="en", the plan's title and description, a
  <div id="root">, and /src/main.tsx as its module script. It loads no
  fonts: load them with @import url(...) at the top of src/styles.css.
- src/main.tsx: imports ./styles.css and renders the default export of
  ./App.tsx inside StrictMode into #root.
- src/lib/utils.ts: exports cn(...inputs: ClassValue[]), clsx merged by
  tailwind-merge. Import it as \`import { cn } from '${SOURCE_ALIAS.name}/lib/utils'\`.
- README.md: what the project is, and how to install, run and build it.
You always write src/styles.css and src/App.tsx, and src/App.tsx
default-exports the app's root component (\`export default function App()\`).`;

// ---------------------------------------------------------------------------
// The templates that take the plan.
// ---------------------------------------------------------------------------

/** One line, trimmed and bounded, for text the model chose. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** The text `escapeHtml` and the usual hand-written entities stand for. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');
}

/**
 * An existing index.html with its title and meta description changed, and
 * nothing else.
 *
 * A follow-up that renames or re-describes the site used to have the model
 * rewrite index.html; the file is templated now (D71), and a project's copy
 * may have been edited by hand since, so it is edited in place rather than
 * written again: the text inside <title> and the content of the
 * <meta name="description"> tag, escaped, and only where the new value
 * differs from what is there (compared as the text they show, so a title
 * written with &amp; is not "changed" to the same title). Where the tag is
 * missing it is added before </head>. The file comes back byte for byte
 * when nothing differs.
 */
export function retitledIndexHtml(
  content: string,
  change: { title?: string | undefined; description?: string | undefined },
): string {
  let html = content;
  const shown = (text: string) => oneLine(unescapeHtml(text), 10_000);
  const beforeHead = (tag: string): string | undefined => {
    const close = /([ \t]*)<\/head\s*>/i.exec(html);
    if (!close) return undefined;
    const indent = `${close[1] ?? ''}  `;
    return (
      html.slice(0, close.index) + `${indent}${tag}\n` + html.slice(close.index)
    );
  };

  const title = change.title === undefined ? '' : oneLine(change.title, 80);
  if (title) {
    const found = /(<title\b[^>]*>)([\s\S]*?)(<\/title\s*>)/i.exec(html);
    if (found) {
      if (shown(found[2]!) !== title) {
        html =
          html.slice(0, found.index) +
          found[1] +
          escapeHtml(title) +
          found[3] +
          html.slice(found.index + found[0].length);
      }
    } else {
      html = beforeHead(`<title>${escapeHtml(title)}</title>`) ?? html;
    }
  }

  const description =
    change.description === undefined ? '' : oneLine(change.description, 300);
  if (description) {
    const tag = /<meta\b[^>]*\bname\s*=\s*(["'])description\1[^>]*>/i.exec(
      html,
    );
    if (tag) {
      const value = /(\bcontent\s*=\s*)(["'])([\s\S]*?)\2/i.exec(tag[0]);
      let next: string | undefined;
      if (!value) {
        next = tag[0].replace(
          /\s*\/?>$/,
          (end) =>
            ` content="${escapeHtml(description)}"${end.trimStart() === '/>' ? ' />' : '>'}`,
        );
      } else if (shown(value[3]!) !== description) {
        // Written back in the quote the tag already used, escaped for it.
        const quote = value[2]!;
        const escaped =
          quote === "'"
            ? escapeHtml(description).replaceAll("'", '&#39;')
            : escapeHtml(description);
        next =
          tag[0].slice(0, value.index) +
          value[1] +
          quote +
          escaped +
          quote +
          tag[0].slice(value.index + value[0].length);
      }
      if (next !== undefined) {
        html =
          html.slice(0, tag.index) +
          next +
          html.slice(tag.index + tag[0].length);
      }
    } else {
      html =
        beforeHead(
          `<meta name="description" content="${escapeHtml(description)}" />`,
        ) ?? html;
    }
  }
  return html;
}

/**
 * The title and description as the templates use them. A title the model
 * left out (DeepSeek's JSON mode enforces no schema) falls back to the
 * summary, which is a sentence and still better than no title.
 */
export function scaffoldText(input: {
  title?: string | undefined;
  description?: string | undefined;
  summary: string;
}): { title: string; description: string } {
  const title = oneLine(input.title ?? '', 80);
  const description = oneLine(input.description ?? '', 300);
  const summary = oneLine(input.summary.replace(/\.\s*$/, ''), 80);
  return {
    title: title || summary || 'Site',
    description: description || oneLine(input.summary, 300),
  };
}

/** A package name npm accepts, from the site's title: "Crumb & Co" as "crumb-co". */
export function packageNameFor(title: string): string {
  const name = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return name || 'site';
}

export function indexHtml(title: string, description: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

/**
 * The README, for a stranger with a terminal (ADR-0002): what the project
 * is, how to install, run and build it with the scripts package.json
 * declares, and where its parts are, listing only the ones it has.
 */
export function readme(
  title: string,
  description: string,
  paths: readonly string[],
): string {
  const has = (test: (path: string) => boolean) => paths.some(test);
  const layout: string[] = [];
  if (has((path) => path === 'src/App.tsx')) {
    layout.push(
      '- `src/App.tsx`: the root component, which src/main.tsx renders.',
    );
  }
  const pages = paths
    .map((path) => /^src\/(pages|routes|views)\//.exec(path)?.[1])
    .find((folder) => folder !== undefined);
  if (pages) layout.push(`- \`src/${pages}/\`: one file per page.`);
  if (
    has(
      (path) =>
        path.startsWith('src/components/') &&
        !path.startsWith('src/components/ui/'),
    )
  ) {
    layout.push("- `src/components/`: the page's sections and parts.");
  }
  if (has((path) => path.startsWith('src/components/ui/'))) {
    layout.push(
      '- `src/components/ui/`: shadcn/ui components, as source you can edit.',
    );
  }
  if (has((path) => path === 'src/styles.css')) {
    layout.push(
      "- `src/styles.css`: Tailwind CSS and the design's colors, fonts and spacing.",
    );
  }
  if (has((path) => path === 'DESIGN.md')) {
    layout.push(
      '- `DESIGN.md`: the design this project is built to, with the exact values.',
    );
  }
  const heading = oneLine(title, 80);
  return `# ${heading}

${oneLine(description, 300)}

A React, TypeScript and Vite project, styled with Tailwind CSS, with
shadcn/ui components, lucide-react icons and Motion for animation.

## Run it

You need Node.js 22 or later, with npm.

\`\`\`bash
npm install
npm run dev
\`\`\`

\`npm run dev\` starts a development server and prints the address to open.

## Build it

\`\`\`bash
npm run build
\`\`\`

This checks the types (\`tsc --noEmit\`) and then bundles the site into
\`dist/\`, which any static host can serve. \`npm run preview\` serves that
build locally.

## Scripts

| Script | Runs |
| --- | --- |
${Object.entries(PROJECT_SCRIPTS)
  .map(([name, command]) => `| \`npm run ${name}\` | \`${command}\` |`)
  .join('\n')}
${layout.length > 0 ? `\n## Where things are\n\n${layout.join('\n')}\n` : ''}`;
}

function sorted(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function packageJson(
  name: string,
  extra: Record<string, string>,
): string {
  const { dependencies, devDependencies } = stackDependencies();
  return `${JSON.stringify(
    {
      name,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: PROJECT_SCRIPTS,
      dependencies: sorted({ ...extra, ...dependencies }),
      devDependencies: sorted(devDependencies),
    },
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------
// The packages a project's files import.
// ---------------------------------------------------------------------------

/** Node's own modules, which a bare import can name without a package. */
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'os',
  'path',
  'process',
  'stream',
  'url',
  'util',
  'zlib',
]);

/** A name npm would accept for a new package, scoped or not. */
export function isPackageName(name: string): boolean {
  return (
    name.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  );
}

/**
 * A version range simple enough to declare as it is: `1.1.1`, `^1.1.1`,
 * `~1.1`, `1`, with a prerelease tag after a whole version. Anything else a
 * model offers (`latest`, `*`, a URL, a comparator) is not taken.
 */
export function isSimpleRange(version: string): boolean {
  return /^[\^~]?\d+(?:\.\d+(?:\.\d+(?:-[0-9A-Za-z.-]+)?)?)?$/.test(version);
}

/** The package an import specifier names, or undefined for a local one. */
export function packageOf(specifier: string): string | undefined {
  const bare = specifier.split('?')[0]!.trim();
  if (
    bare === '' ||
    /^(?:\.|\/|~|#|@\/)/.test(bare) ||
    /^[a-z][a-z0-9+.-]*:/i.test(bare)
  ) {
    return undefined;
  }
  const parts = bare.split('/');
  const name = bare.startsWith('@')
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0];
  if (!name || NODE_BUILTINS.has(name) || !isPackageName(name)) {
    return undefined;
  }
  return name;
}

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Every package the files import, sorted: static imports and re-exports at
 * the start of a line (type-only ones too, since the types come from the
 * package), dynamic `import('...')`, and a stylesheet's `@import` and
 * `@plugin` of a package (Tailwind v4 loads plugins from CSS).
 *
 * Read from the start of a line so that copy on the page ("we import our
 * beans from 'Huila'") is not taken for an import; a name npm would not
 * accept is dropped as well.
 */
export function importedPackages(files: readonly ProjectFile[]): string[] {
  const found = new Set<string>();
  const add = (specifier: string | undefined) => {
    const name = specifier === undefined ? undefined : packageOf(specifier);
    if (name) found.add(name);
  };
  for (const file of files) {
    if (SCRIPT_FILE.test(file.path)) {
      for (const match of file.content.matchAll(
        /^[ \t]*(?:import|export)\b(?:[^'"`;()<>=]*?\bfrom)?\s*['"]([^'"\n]+)['"]/gm,
      )) {
        add(match[1]);
      }
      for (const match of file.content.matchAll(
        /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
      )) {
        add(match[1]);
      }
    } else if (file.path.endsWith('.css')) {
      for (const match of file.content.matchAll(
        /@(?:import|plugin)\s+['"]([^'"\n]+)['"]/g,
      )) {
        add(match[1]);
      }
    }
  }
  return [...found].sort();
}

const STACK_NAMES = new Set(STACK_PACKAGES.map((pkg) => pkg.name));

/**
 * The version to declare an imported package at, when the stack does not
 * name it: the outline's own range if it gave a simple one, then the range
 * `stack.ts` keeps for an optional package, and otherwise `latest`. The
 * last is the cost of a file importing a package nobody named: it installs
 * and builds, where leaving it out fails the build and buys a repair.
 */
export function versionFor(
  name: string,
  declared: readonly ExtraDependency[] = [],
): string {
  const given = declared.find((dependency) => dependency.name === name);
  if (given && isSimpleRange(given.version.trim())) return given.version.trim();
  const optional = (OPTIONAL_PACKAGES as Record<string, string>)[name];
  return optional ?? 'latest';
}

/**
 * The packages beyond the stack that `files` import, with the version each
 * is declared at. A Vibld package is never added (ADR-0002): a file that
 * imports one fails its build, which is the right place to find out.
 */
export function extraDependencies(
  files: readonly ProjectFile[],
  declared: readonly ExtraDependency[] = [],
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const name of importedPackages(files)) {
    if (STACK_NAMES.has(name) || name.startsWith('@vibld/')) continue;
    extra[name] = versionFor(name, declared);
  }
  return extra;
}

// ---------------------------------------------------------------------------
// The files, for a new project and for a follow-up.
// ---------------------------------------------------------------------------

/**
 * The templated files that take nothing from the plan, which a file-writing
 * step can be shown when a file it writes depends on one.
 */
export function fixedScaffoldFiles(): ProjectFile[] {
  return [
    {
      path: 'tsconfig.json',
      content: `${JSON.stringify(TSCONFIG, null, 2)}\n`,
    },
    { path: 'vite.config.ts', content: VITE_CONFIG },
    { path: 'src/main.tsx', content: MAIN_TSX },
    { path: 'src/lib/utils.ts', content: UTILS_TS },
  ];
}

/**
 * Every templated file, for a project whose own files are `files`: the
 * package.json declares what they import, and the README lists what they
 * are.
 */
export function scaffoldFiles(
  input: ScaffoldInput,
  files: readonly ProjectFile[],
): ProjectFile[] {
  const own = files.filter((file) => !isScaffoldPath(file.path));
  const byPath = new Map<string, ProjectFile>([
    [
      'package.json',
      {
        path: 'package.json',
        content: packageJson(
          packageNameFor(input.title),
          extraDependencies(own, input.dependencies),
        ),
      },
    ],
    [
      'index.html',
      {
        path: 'index.html',
        content: indexHtml(input.title, input.description),
      },
    ],
    ...fixedScaffoldFiles().map((file) => [file.path, file] as const),
    [
      'README.md',
      {
        path: 'README.md',
        content: readme(
          input.title,
          input.description,
          own.map((file) => file.path),
        ),
      },
    ],
  ]);
  return SCAFFOLD_PATHS.map((path) => byPath.get(path)!);
}

/**
 * An existing package.json with any package `files` import and it does not
 * declare added to its dependencies, and everything else left as it was.
 * Unchanged, byte for byte, when there is nothing to add or it cannot be
 * read: a follow-up does not rewrite a file it has no reason to touch.
 */
export function withImportedDependencies(
  content: string,
  files: readonly ProjectFile[],
  declared: readonly ExtraDependency[] = [],
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return content;
  }
  const pkg = parsed as Record<string, unknown>;
  const present = new Set<string>();
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const group = pkg[field];
    if (typeof group === 'object' && group !== null) {
      for (const name of Object.keys(group)) present.add(name);
    }
  }
  // A stack package goes where the stack puts it, at the stack's range.
  const stack = stackDependencies();
  const missing = {
    dependencies: {} as Record<string, string>,
    devDependencies: {} as Record<string, string>,
  };
  for (const name of importedPackages(files)) {
    if (present.has(name) || name.startsWith('@vibld/')) continue;
    if (stack.devDependencies[name] !== undefined) {
      missing.devDependencies[name] = stack.devDependencies[name];
    } else {
      missing.dependencies[name] =
        stack.dependencies[name] ?? versionFor(name, declared);
    }
  }
  let changed = false;
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const adding = missing[field];
    if (Object.keys(adding).length === 0) continue;
    const current = pkg[field];
    const kept =
      typeof current === 'object' && current !== null && !Array.isArray(current)
        ? (current as Record<string, string>)
        : {};
    pkg[field] = { ...kept, ...sorted(adding) };
    changed = true;
  }
  return changed ? `${JSON.stringify(pkg, null, 2)}\n` : content;
}

/**
 * `files` with Vibld's own files in place.
 *
 * A new project gets every templated file, replacing any file at those
 * paths, and the animated backgrounds its files import (`backdropFiles`).
 * A follow-up keeps the ones its project already has, so an edit made to
 * them since is not undone. Two things change in place: package.json
 * declares a package a file now imports, and index.html takes a new title
 * or description when the follow-up gave one (`retitle`,
 * `retitledIndexHtml`). A templated file the project lacks (one generated
 * before D71 may) is written, and so is a backdrop a file now imports.
 */
export function withScaffold(
  files: readonly ProjectFile[],
  input: ScaffoldInput,
  followUp: boolean,
): ProjectFile[] {
  if (!followUp) {
    const own = files.filter((file) => !isTemplatedPath(file.path));
    const withBackdrops = [...own, ...backdropFiles(own)];
    return [...withBackdrops, ...scaffoldFiles(input, withBackdrops)];
  }
  const present = new Set(files.map((file) => file.path));
  const added = [
    ...scaffoldFiles(input, files),
    ...backdropFiles(files),
  ].filter((file) => !present.has(file.path));
  // Read over the files it adds as well: a utils.ts written into a project
  // that lacked one imports clsx, which that project may not declare.
  const all = [...files, ...added];
  return [
    ...files.map((file) => {
      if (file.path === 'package.json') {
        return {
          path: file.path,
          content: withImportedDependencies(
            file.content,
            all,
            input.dependencies,
          ),
        };
      }
      if (file.path === 'index.html' && input.retitle) {
        return {
          path: file.path,
          content: retitledIndexHtml(file.content, input.retitle),
        };
      }
      return file;
    }),
    ...added,
  ];
}
