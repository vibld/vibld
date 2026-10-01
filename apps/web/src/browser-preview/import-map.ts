/**
 * Where the in-browser preview (D125) loads a project's packages from: an
 * ES-module CDN, through an import map written into the preview page.
 *
 * The bundle leaves every bare import (`react`, `motion/react`,
 * `lucide-react`) as it was written, and the page's import map points each
 * one at esm.sh at the range the project's own package.json declares. One
 * React for the whole page is what keeps hooks working: every package but
 * React itself is asked for with React left external, so its own
 * `import 'react'` goes back through the same map to the same copy.
 *
 * Framework-free and JSX-free, so the tests import it directly.
 */

/** The CDN every package comes from. */
export const PACKAGE_CDN = 'https://esm.sh';

/** Packages that must exist once on the page, and everything else shares. */
const SHARED = ['react', 'react-dom'] as const;

/**
 * Entry points of the shared packages a dependency can import on its own,
 * mapped even when the project's code never names them, because the
 * packages it loads will.
 */
const SHARED_ENTRIES = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
] as const;

/** `@scope/name/sub` as its package name and the rest. */
export function splitSpecifier(specifier: string): {
  name: string;
  subpath: string;
} {
  const parts = specifier.split('/');
  const take = specifier.startsWith('@') ? 2 : 1;
  return {
    name: parts.slice(0, take).join('/'),
    subpath: parts.length > take ? `/${parts.slice(take).join('/')}` : '',
  };
}

/** Whether `specifier` names a package rather than a file of the project. */
export function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('@/') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(specifier)
  );
}

/** The ranges package.json declares, dependencies and devDependencies both. */
export function declaredRanges(
  packageJson: string | undefined,
): Map<string, string> {
  const ranges = new Map<string, string>();
  if (!packageJson) return ranges;
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    return ranges;
  }
  if (typeof parsed !== 'object' || parsed === null) return ranges;
  for (const block of ['devDependencies', 'dependencies'] as const) {
    const entries = (parsed as Record<string, unknown>)[block];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [name, range] of Object.entries(entries)) {
      if (typeof range === 'string' && range.trim() !== '') {
        ranges.set(name, range.trim());
      }
    }
  }
  return ranges;
}

/**
 * The CDN address of one import. A range is passed as written (esm.sh
 * resolves `^19.3.0` itself), and a package with no declared range is
 * asked for at its latest, which is what `npm install` would refuse: the
 * build check says so, and the preview still shows what it can.
 */
export function packageUrl(
  specifier: string,
  ranges: ReadonlyMap<string, string>,
): string {
  const { name, subpath } = splitSpecifier(specifier);
  const range = ranges.get(name);
  const versioned = range ? `${name}@${encodeURIComponent(range)}` : name;
  const external =
    name === 'react'
      ? ''
      : name === 'react-dom'
        ? '?external=react'
        : `?external=${SHARED.join(',')}`;
  return `${PACKAGE_CDN}/${versioned}${subpath}${external}`;
}

/**
 * React Router's entry points, whose browser routers cannot run in the
 * preview: its page has no origin, so the browser refuses any change of
 * its URL. Each is mapped to a module that is the package with its
 * browser and hash routers swapped for the memory router, which routes
 * the same way without touching the URL.
 */
const ROUTERS = new Set(['react-router', 'react-router-dom']);

function routerShim(packageModule: string): string {
  const source = [
    `export * from ${JSON.stringify(packageModule)};`,
    `export { MemoryRouter as BrowserRouter, MemoryRouter as HashRouter, createMemoryRouter as createBrowserRouter, createMemoryRouter as createHashRouter } from ${JSON.stringify(packageModule)};`,
  ].join('\n');
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

export interface ImportMap {
  imports: Record<string, string>;
}

/**
 * The import map for a bundle that left `specifiers` external: each of
 * them, and React's own entry points whenever React is on the page.
 */
export function importMapFor(
  specifiers: Iterable<string>,
  ranges: ReadonlyMap<string, string>,
): ImportMap {
  const wanted = new Set(specifiers);
  const usesReact = [...wanted].some((specifier) =>
    (SHARED as readonly string[]).includes(splitSpecifier(specifier).name),
  );
  if (ranges.has('react') || usesReact) {
    for (const entry of SHARED_ENTRIES) wanted.add(entry);
  }
  const imports: Record<string, string> = {};
  for (const specifier of [...wanted].sort()) {
    const url = packageUrl(specifier, ranges);
    imports[specifier] = ROUTERS.has(specifier) ? routerShim(url) : url;
  }
  return { imports };
}

/** The CDN address of a stylesheet a project imports from a package. */
export function packageStylesheetUrl(
  specifier: string,
  ranges: ReadonlyMap<string, string>,
): string {
  const { name, subpath } = splitSpecifier(specifier);
  const range = ranges.get(name);
  const versioned = range ? `${name}@${encodeURIComponent(range)}` : name;
  return `${PACKAGE_CDN}/${versioned}${subpath}`;
}
