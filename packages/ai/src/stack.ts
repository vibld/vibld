/**
 * The packages a generated project is built from, and the versions they are
 * declared at (ADR-0014).
 *
 * One list, read by everything that writes a package.json: the STACK section
 * of the system prompt, the fake scaffold in apps/web, and the eval's stub
 * plan. The stub is built in CI (`packages/eval/bin/build-candidates.ts`),
 * so a set that stops installing or compiling together fails there before a
 * user's generation finds out.
 *
 * Versions are named, where `primitives.ts` once refused to name one,
 * because the reason changed. One unstyled package could be left to the
 * model; a dozen packages with peer ranges between them cannot. A model that
 * picks its own versions picks ones that do not agree (a `@tailwindcss/vite`
 * that wants a different vite, a `lucide-react` from before the icon it
 * imports), and an install that fails buys a paid repair. Caret ranges, so a
 * patch release is taken without anyone editing this file.
 *
 * The set was installed and built together on 2026-09-26: a cold
 * `npm install --ignore-scripts` took 20 seconds and 162 MB, and the build
 * 2 seconds, well inside `build-limits.ts`.
 */

export interface StackPackage {
  name: string;
  version: string;
  /** Whether it belongs in devDependencies rather than dependencies. */
  dev: boolean;
  /** What it is for, as the prompt says it. */
  role: string;
}

export const STACK_PACKAGES: readonly StackPackage[] = [
  { name: 'react', version: '^19.3.0', dev: false, role: 'UI' },
  { name: 'react-dom', version: '^19.3.0', dev: false, role: 'UI' },
  {
    name: 'motion',
    version: '^13.4.4',
    dev: false,
    role: 'animation, imported from "motion/react"',
  },
  { name: 'lucide-react', version: '^1.48.0', dev: false, role: 'icons' },
  {
    name: 'radix-ui',
    version: '^1.6.7',
    dev: false,
    role: 'the primitives under shadcn/ui components',
  },
  {
    name: 'class-variance-authority',
    version: '^0.7.1',
    dev: false,
    role: 'component variants',
  },
  { name: 'clsx', version: '^2.1.1', dev: false, role: 'cn()' },
  { name: 'tailwind-merge', version: '^3.7.0', dev: false, role: 'cn()' },
  { name: 'vite', version: '^8.3.0', dev: true, role: 'build' },
  {
    name: '@vitejs/plugin-react',
    version: '^6.1.1',
    dev: true,
    role: 'build',
  },
  { name: 'tailwindcss', version: '^4.3.3', dev: true, role: 'styles' },
  {
    name: '@tailwindcss/vite',
    version: '^4.3.3',
    dev: true,
    role: 'styles',
  },
  {
    name: 'tw-animate-css',
    version: '^1.4.0',
    dev: true,
    role: 'the enter and exit animations shadcn/ui components use',
  },
  { name: 'typescript', version: '^7.0.2', dev: true, role: 'types' },
  { name: '@types/react', version: '^19.3.0', dev: true, role: 'types' },
  { name: '@types/react-dom', version: '^19.3.0', dev: true, role: 'types' },
  { name: '@types/node', version: '^24.0.0', dev: true, role: 'types' },
];

/**
 * Packages a project adds only for a component that needs one, named here so
 * the version is in one place too: shadcn/ui's Command (and so its combobox)
 * is built on cmdk rather than on Radix.
 */
export const OPTIONAL_PACKAGES = {
  cmdk: '^1.1.1',
} as const;

/** The two blocks of a package.json, from `STACK_PACKAGES`. */
export function stackDependencies(): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  for (const pkg of STACK_PACKAGES) {
    (pkg.dev ? devDependencies : dependencies)[pkg.name] = pkg.version;
  }
  return { dependencies, devDependencies };
}

/**
 * The list as the prompt states it, name@range, wrapped to the prompt's
 * width and indented to sit under a list item.
 */
export function stackVersionLine(width = 76, indent = '  '): string {
  const lines: string[] = [];
  let line = '';
  for (const pkg of STACK_PACKAGES) {
    const item = `${pkg.name}@${pkg.version}`;
    const next = line === '' ? item : `${line}, ${item}`;
    if (indent.length + next.length + 1 > width && line !== '') {
      lines.push(`${line},`);
      line = item;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines.map((text) => indent + text).join('\n');
}
