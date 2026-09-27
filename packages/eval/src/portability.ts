import type { ProjectSnapshot } from '@vibld/core';

/**
 * Whether an accepted project could be handed to someone who has never heard
 * of Vibld.
 *
 * ADR-0002 makes portability a property of the output, not a promise in the
 * README, so it has to be checked on the artefact. These are checks a person
 * could not run by eye across thirty snapshots, and they are the ones that
 * quietly stop being true: a `.vibld/` directory creeping in, a dependency on
 * a Vibld package, a lockfile that never got written.
 *
 * Deliberately separate from the builder's own staged-file validator. That one
 * asks "is this snapshot safe to promote"; this one asks "is this project
 * independent". A snapshot can pass the first and fail this.
 */

export interface PortabilityProblem {
  check: string;
  detail: string;
}

const REQUIRED_FILES = ['package.json', 'README.md'];

/** Paths that would make the project depend on Vibld to build or run. */
const FORBIDDEN_PREFIXES = ['.vibld/'];

function parsePackageJson(
  content: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function dependencyNames(pkg: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const group = pkg[field];
    if (typeof group === 'object' && group !== null) {
      names.push(...Object.keys(group as Record<string, unknown>));
    }
  }
  return names;
}

/**
 * The major version one simple range names: `^3.4.17`, `~3.4`, `=3.4.17`,
 * `3.4.17`, `3.x`, `3`, `v3.4.0`. Every one of these is satisfiable and
 * cannot reach the next major.
 */
function simpleRangeMajor(text: string): number | undefined {
  // A prerelease or build suffix only after a whole major.minor.patch:
  // `3.4.0-beta.1` is a version, while `3.4-beta` is a dist-tag to npm,
  // which may name any version or none (internal PR 237 review).
  const match =
    /^(?:[\^~]|=)?\s*v?(\d+)(?:(?:\.(?:\d+|[xX*])(?:\.(?:\d+|[xX*]))?)?|\.\d+\.\d+[-+][0-9A-Za-z.+-]+)$/.exec(
      text,
    );
  return match ? Number(match[1]) : undefined;
}

/**
 * The highest major version a dependency range can resolve to, read only
 * from simple ranges and `||` alternatives of them: `^3.4.17` and
 * `^2 || ^3` give 3, `^3 || ^4` gives 4.
 *
 * Anything else, `latest`, `*`, a git URL, and comparator or hyphen ranges
 * such as `>=3`, `>=3 <4` or `3.0.0 - 4.0.0`, gives `undefined`: an
 * open-ended one can reach a later major, a bounded one can be
 * unsatisfiable (`>=4 <4`), and telling those apart needs a semver range
 * solver this check does not carry (internal PR 237 review). A project that names its
 * Tailwind v3 with one of those spellings is refused, not guessed at.
 */
export function rangeHighestMajor(range: string): number | undefined {
  let highest: number | undefined;
  for (const alternative of range.split('||')) {
    const major = simpleRangeMajor(alternative.trim());
    if (major === undefined) return undefined;
    highest = Math.max(highest ?? major, major);
  }
  return highest;
}

/**
 * The packages that install each command a generated project is likely to
 * run; any one of them declared is enough. A package can also require its
 * range to qualify: Tailwind's CLI is `@tailwindcss/cli` from v4, and the
 * `tailwindcss` package itself only up to v3, so `tailwindcss@^4` with a
 * `tailwindcss` script does not install the command (internal PR 237 review).
 */
const TOOL_PACKAGES: Record<
  string,
  readonly { name: string; accepts?: (range: string) => boolean }[]
> = {
  vite: [{ name: 'vite' }],
  tsc: [{ name: 'typescript' }],
  'vue-tsc': [{ name: 'vue-tsc' }],
  'react-router': [{ name: '@react-router/dev' }],
  eslint: [{ name: 'eslint' }],
  prettier: [{ name: 'prettier' }],
  vitest: [{ name: 'vitest' }],
  tailwindcss: [
    { name: '@tailwindcss/cli' },
    {
      name: 'tailwindcss',
      accepts: (range) => {
        const major = rangeHighestMajor(range);
        return major !== undefined && major <= 3;
      },
    },
  ],
};

/**
 * The project's own scripts that `npm install` runs in its root, `prepublish`
 * included: npm still runs it on a plain install
 * (https://docs.npmjs.com/cli/v11/using-npm/scripts#life-cycle-operation-order).
 */
const INSTALL_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
];

/**
 * Each declared dependency's range, dependencies and devDependencies alike.
 * Only a string is a range: npm refuses any other spec ("must provide
 * string spec"), so one declared that way installs nothing (internal PR 237 review).
 */
function dependencyRanges(pkg: Record<string, unknown>): Map<string, string> {
  const ranges = new Map<string, string>();
  for (const field of ['dependencies', 'devDependencies']) {
    const group = pkg[field];
    if (typeof group !== 'object' || group === null) continue;
    for (const [name, range] of Object.entries(
      group as Record<string, unknown>,
    )) {
      if (typeof range === 'string') ranges.set(name, range);
    }
  }
  return ranges;
}

/** Dependencies declared with something npm cannot install from. */
function unreadableSpecs(pkg: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const group = pkg[field];
    if (typeof group !== 'object' || group === null) continue;
    for (const [name, range] of Object.entries(
      group as Record<string, unknown>,
    )) {
      if (typeof range !== 'string') names.push(name);
    }
  }
  return names;
}

/**
 * The first word of each command in a script: `tsc -b && vite build` runs
 * `tsc` and `vite`. `npx` is skipped because it runs the next word, and a
 * leading `NAME=value` sets the environment for the command after it.
 */
function commandTools(command: string): string[] {
  const tools: string[] = [];
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    let index = 0;
    while (
      index < words.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!)
    ) {
      index += 1;
    }
    if (words[index] === 'npx') index += 1;
    const tool = words[index];
    if (tool) tools.push(tool);
  }
  return tools;
}

/**
 * A declared script whose tool has no configuration cannot run.
 *
 * The checks above ask whether the conventional scripts are *present*. That
 * is not the same as whether they work, and the difference is not academic:
 * the deterministic planner's own project declared `tsc --noEmit && vite
 * build` and shipped no tsconfig.json, so `npm run build` on an exported
 * project stopped at tsc printing its usage. It passed every check here.
 *
 * `tsc` with no project file does not compile the directory -- it prints
 * help and exits. `tsc -p somewhere.json` names its own, so only an
 * unqualified invocation needs the root file.
 */
function checkToolConfiguration(
  pkg: Record<string, unknown>,
  paths: Set<string>,
): PortabilityProblem[] {
  const problems: PortabilityProblem[] = [];
  const scripts = pkg.scripts;
  if (typeof scripts !== 'object' || scripts === null) return problems;

  const hasTsconfig = paths.has('tsconfig.json');
  for (const [name, command] of Object.entries(
    scripts as Record<string, unknown>,
  )) {
    if (typeof command !== 'string') continue;
    const callsBareTsc = /(^|&&|\|\||;)\s*(npx\s+)?tsc\b/.test(command);
    const namesItsProject = /\s(-p|--project)\s/.test(command);
    if (callsBareTsc && !namesItsProject && !hasTsconfig) {
      problems.push({
        check: 'runnable-scripts',
        detail: `the "${name}" script runs tsc but the project has no tsconfig.json, so it prints usage instead of building`,
      });
    }
  }

  // A script's command has to be installed by the project itself. `vite
  // build` with no vite dependency passes every check above and then stops
  // at `vite: not found` -- the stub this harness runs against in CI did
  // exactly that and was reported accepted (internal PR 59). Only tools this map knows
  // are checked: `node`, `rm` and the like come with the machine, and a
  // guess about an unfamiliar name would be a false alarm.
  const ranges = dependencyRanges(pkg);
  for (const [name, command] of Object.entries(
    scripts as Record<string, unknown>,
  )) {
    if (typeof command !== 'string') continue;
    for (const tool of commandTools(command)) {
      const owners = TOOL_PACKAGES[tool];
      if (!owners) continue;
      const installed = owners.some((owner) => {
        const range = ranges.get(owner.name);
        return range !== undefined && (!owner.accepts || owner.accepts(range));
      });
      if (!installed) {
        problems.push({
          check: 'runnable-scripts',
          detail: `the "${name}" script runs ${tool}, but no dependency installs it (${tool === 'tailwindcss' ? '@tailwindcss/cli, or tailwindcss as a v3 range such as ^3.4' : owners.map((owner) => owner.name).join(' or ')}), so it fails with "${tool}: not found"`,
        });
      }
    }
  }

  // The candidates are installed with --ignore-scripts, because the install
  // is code a model wrote (bin/build-candidates.ts). A project whose own
  // install hook writes something its build needs would then fail its build
  // for a reason that is not in its build. So a project that relies on one
  // is refused here, by name, rather than reported as a build failure it
  // does not have (internal PR 237 review).
  for (const name of INSTALL_SCRIPTS) {
    if (typeof (scripts as Record<string, unknown>)[name] === 'string') {
      problems.push({
        check: 'runnable-scripts',
        detail: `the "${name}" script runs during npm install, which the eval runs with --ignore-scripts, so nothing it would produce is there to build from`,
      });
    }
  }

  // React ships no types. A TypeScript project that renders JSX and does not
  // depend on @types/react fails to typecheck on every element it contains --
  // and `build` runs the typecheck first, so it never reaches the bundler.
  const names = dependencyNames(pkg);
  const usesReact = names.includes('react');
  const typechecks = Object.values(scripts as Record<string, unknown>).some(
    (command) => typeof command === 'string' && /\btsc\b/.test(command),
  );
  if (usesReact && typechecks && !names.includes('@types/react')) {
    problems.push({
      check: 'runnable-scripts',
      detail:
        'the project renders React with TypeScript but does not depend on @types/react, so every JSX element fails to typecheck',
    });
  }

  // A TypeScript project whose build never runs tsc ships what its code does
  // at run time: Vite strips types one file at a time and checks none of
  // them. DeepSeek V4 Pro's pottery booking app built with `vite build`
  // alone, called React.useRef without importing React, and threw a
  // ReferenceError on load; tsc would have stopped the build there. The
  // build has to run the check, itself or through a script it runs.
  const writesTypeScript =
    names.includes('typescript') ||
    [...paths].some(
      (path) => /\.(ts|tsx|mts|cts)$/.test(path) && !/\.d\.[cm]?ts$/.test(path),
    );
  const build = (scripts as Record<string, unknown>).build;
  if (
    writesTypeScript &&
    typeof build === 'string' &&
    !runsTsc(build, scripts as Record<string, unknown>, new Set(['build']))
  ) {
    problems.push({
      check: 'runnable-scripts',
      detail: `the "build" script (${build}) never runs tsc, so a type error ships as a crash on load instead of stopping the build`,
    });
  }

  // A build plugin nobody configures is a dependency the project installs
  // and never uses, and it means JSX is transformed by whatever the bundler
  // defaults to rather than by the tool the manifest names.
  const usesReactPlugin = dependencyNames(pkg).includes('@vitejs/plugin-react');
  const hasViteConfig = VITE_CONFIGS.some((path) => paths.has(path));
  if (usesReactPlugin && !hasViteConfig) {
    problems.push({
      check: 'runnable-scripts',
      detail:
        '@vitejs/plugin-react is a dependency but there is no vite config to use it',
    });
  }

  return problems;
}

const VITE_CONFIGS = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
];

const SOURCE_FILE = /\.(?:tsx?|jsx?|mts|mjs)$/;

/**
 * The configuration the generated stack needs to build, and that a project
 * can declare without providing (ADR-0014). Each was a real failure mode of
 * the stack, not a style preference:
 *
 * - `@tailwindcss/vite` in the manifest does nothing until the Vite config
 *   adds the plugin. The build succeeds, and every utility class on the
 *   page is missing from the CSS.
 * - shadcn/ui components import through `@/`. TypeScript resolves it from
 *   tsconfig's `paths` and Vite from its `resolve.alias`, and each ignores
 *   the other, so a project with one of the two fails in the other tool.
 * - `import './styles.css'` is an error under TypeScript 7 (TS2882) unless
 *   Vite's client types are loaded, which is what `types: ["vite/client"]`
 *   or a `/// <reference types="vite/client" />` file does.
 * - TypeScript 7 removed `baseUrl` (TS5102), and `tsc` stops at the
 *   tsconfig before reading a source file. Models reach for it next to
 *   `paths` out of habit: GPT-6 Sol and DeepSeek V4 Pro both did, in every
 *   project of the first bakeoff on this stack.
 */
/**
 * A tsconfig path as TypeScript resolves one named from `dir`. A project
 * (`tsc -p`, or a reference) that is not a .json file is a directory, and
 * means the tsconfig.json in it; an `extends` without .json has it added.
 */
function configPath(
  dir: string,
  named: string,
  kind: 'project' | 'extends',
): string {
  const parts: string[] = dir === '' ? [] : dir.split('/');
  for (const part of named.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const path = parts.join('/');
  if (path.endsWith('.json')) return path;
  if (kind === 'extends') return `${path}.json`;
  return path === '' ? 'tsconfig.json' : `${path}/tsconfig.json`;
}

/** What one simple command in a script can do to the script's outcome. */
type CommandKind =
  | { type: 'checks' | 'either' | 'succeeds' | 'fails' | 'skip' }
  | { type: 'exit'; code: number };

/**
 * Whether a script command type-checks on every way it can succeed: each
 * path through its `&&`, `||` and `;` that ends in exit status 0 has to pass
 * through a tsc that checked the project and succeeded (internal PR 247 review). A tsc
 * after `||`, before a `;` or in a pipe can fail without failing the
 * command; `tsc && vite build || exit 1` cannot. A script run by name counts
 * if it type-checks the same way. `seen` stops a script that runs itself.
 */
function runsTsc(
  command: string,
  scripts: Record<string, unknown>,
  seen: Set<string>,
): boolean {
  const parts = command.split(/(&&|\|\||;|\n)/);
  const kinds = parts
    .filter((_, index) => index % 2 === 0)
    .map((part) => commandKind(part, scripts, seen));
  const ops = parts.filter((_, index) => index % 2 === 1);
  // Whether some path from command `at` on ends in success with no check.
  const unchecked = (at: number, status: number, checked: boolean): boolean => {
    if (at === kinds.length) return status === 0 && !checked;
    const op = at === 0 ? ';' : ops[at - 1];
    const runs = op === '&&' ? status === 0 : op === '||' ? status !== 0 : true;
    const kind = kinds[at]!;
    if (!runs || kind.type === 'skip') {
      return unchecked(at + 1, status, checked);
    }
    if (kind.type === 'exit') return kind.code === 0 && !checked;
    const outcomes =
      kind.type === 'succeeds' ? [0] : kind.type === 'fails' ? [1] : [0, 1];
    return outcomes.some((outcome) =>
      unchecked(
        at + 1,
        outcome,
        checked || (outcome === 0 && kind.type === 'checks'),
      ),
    );
  };
  return !unchecked(0, 0, false);
}

/**
 * One simple command, read for what `runsTsc` needs: a tsc that checks the
 * project (not `--version`, `--noCheck`, `--watch` or a list of files), a
 * script run by name that does, or `exit`, `true` and `false`.
 */
function commandKind(
  segment: string,
  scripts: Record<string, unknown>,
  seen: Set<string>,
): CommandKind {
  if (segment.trim() === '') return { type: 'skip' };
  if (/[|&]/.test(segment)) return { type: 'either' };
  const words = segment.trim().split(/\s+/);
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '')) index += 1;
  // The word after a runner's own flags: `npx --yes tsc`, `npm run -s x`.
  const next = (from: number) => {
    let at = from;
    while ((words[at] ?? '').startsWith('-')) at += 1;
    return at;
  };
  let at = index;
  let tool = words[at];
  if (tool === 'exit') {
    const code = Number(words[at + 1] ?? 'NaN');
    return Number.isInteger(code) ? { type: 'exit', code } : { type: 'either' };
  }
  if (tool === 'true' || tool === ':') return { type: 'succeeds' };
  if (tool === 'false') return { type: 'fails' };
  if (tool === 'npx' || tool === 'bunx') {
    at = next(at + 1);
    tool = words[at];
  } else if (
    tool === 'npm' ||
    tool === 'pnpm' ||
    tool === 'yarn' ||
    tool === 'bun'
  ) {
    at = next(at + 1);
    const verb = words[at];
    const named = verb === 'run' || verb === 'run-script' || verb === 'exec';
    if (!named && (tool === 'npm' || tool === 'bun')) return { type: 'either' };
    if (named) at = next(at + 1);
    const name = words[at];
    const script = name === undefined ? undefined : scripts[name];
    if (verb !== 'exec' && typeof script === 'string') {
      if (seen.has(name!)) return { type: 'either' };
      seen.add(name!);
      return { type: runsTsc(script, scripts, seen) ? 'checks' : 'either' };
    }
    tool = name;
  }
  if (tool === undefined || !/(^|\/)(vue-)?tsc$/.test(tool)) {
    return { type: 'either' };
  }
  const args = words.slice(at + 1);
  const build = args.includes('-b') || args.includes('--build');
  const checks =
    !args.some((arg) =>
      /^(-v|--version|-h|--help|--init|--showConfig|--listFilesOnly|--noCheck|-w|--watch)$/.test(
        arg,
      ),
    ) &&
    // Files named on the command line are all tsc checks, not the project.
    (build || !args.some((arg) => /\.[cm]?[jt]sx?$/.test(arg)));
  return { type: checks ? 'checks' : 'either' };
}

/** A tsconfig a script's tsc reads, and whether in build mode (`-b`). */
interface TscInvocation {
  path: string;
  build: boolean;
}

/**
 * Each tsc a script command runs, with the tsconfig it reads: the one
 * `-p` names, each project `-b` names (internal PR 244 review), or the root one.
 */
function tscInvocations(command: string): TscInvocation[] {
  const found: TscInvocation[] = [];
  for (const segment of command.split(/&&|\|\||;/)) {
    const words = segment.trim().split(/\s+/);
    const at = words.findIndex((word) => /(^|\/)tsc$/.test(word));
    if (at === -1) continue;
    const args = words
      .slice(at + 1)
      .map((word) => word.replace(/^['"]|['"]$/g, ''));
    const build = args.some((arg) => arg === '-b' || arg === '--build');
    if (build) {
      const projects = args.filter((arg) => !arg.startsWith('-'));
      for (const project of projects.length > 0 ? projects : ['.']) {
        found.push({ path: configPath('', project, 'project'), build });
      }
      continue;
    }
    const flag = args.findIndex((arg) => arg === '-p' || arg === '--project');
    const named = flag === -1 ? undefined : args[flag + 1];
    found.push({
      path:
        named === undefined
          ? 'tsconfig.json'
          : configPath('', named, 'project'),
      build,
    });
  }
  return found;
}

/** JSONC with its comments removed, strings left as they are. */
function withoutJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      out += text.slice(i, end + 1);
      i = end;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * The tsconfig files tsc loads from `names`: each one, and every project
 * file it extends or references, followed inside the project.
 */
function loadedConfigs(
  invocations: readonly TscInvocation[],
  files: readonly { path: string; content: string }[],
): { path: string; content: string }[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const loaded: { path: string; content: string }[] = [];
  const queue = invocations.map((invocation) => ({ ...invocation }));
  while (queue.length > 0) {
    const { path, build } = queue.shift()!;
    // Seen in build mode covers project mode, not the other way round.
    const key = `${build ? 'b' : 'p'}:${path}`;
    if (seen.has(key) || (!build && seen.has(`b:${path}`))) continue;
    seen.add(key);
    const file = byPath.get(path);
    if (!file) continue;
    loaded.push(file);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const extended = /["']extends["']\s*:\s*("[^"]*"|\[[^\]]*\])/.exec(
      file.content,
    )?.[1];
    for (const target of extended?.match(/"[^"]*"/g) ?? []) {
      const name = target.slice(1, -1);
      // A package's config (`@tsconfig/vite-react`) is outside the project.
      if (name.startsWith('.')) {
        queue.push({ path: configPath(dir, name, 'extends'), build });
      }
    }
    const references = /["']references["']\s*:\s*\[([^\]]*)\]/.exec(
      file.content,
    )?.[1];
    for (const match of references?.matchAll(/["']path["']\s*:\s*"([^"]*)"/g) ??
      []) {
      // Only `tsc -b` builds a referenced project; `tsc -p` reads its
      // declarations and never its tsconfig's options (internal PR 244 review).
      if (build) {
        queue.push({ path: configPath(dir, match[1]!, 'project'), build });
      }
    }
  }
  return loaded;
}

function checkStackConfiguration(
  pkg: Record<string, unknown>,
  files: readonly { path: string; content: string }[],
): PortabilityProblem[] {
  const problems: PortabilityProblem[] = [];
  const names = dependencyNames(pkg);
  const viteConfig = files
    .filter((file) => VITE_CONFIGS.includes(file.path))
    .map((file) => file.content)
    .join('\n');
  const sources = files.filter((file) => SOURCE_FILE.test(file.path));

  if (
    names.includes('@tailwindcss/vite') &&
    !(
      /@tailwindcss\/vite/.test(viteConfig) &&
      /\btailwindcss\s*\(/.test(viteConfig)
    )
  ) {
    problems.push({
      check: 'runnable-scripts',
      detail:
        '@tailwindcss/vite is a dependency but the vite config does not add the plugin, so no utility class is generated',
    });
  }

  const importsAlias = sources.some((file) =>
    /\bfrom\s*['"]@\/|\bimport\s*\(\s*['"]@\/|\bimport\s*['"]@\//.test(
      file.content,
    ),
  );
  if (importsAlias) {
    const tsconfigs = files
      .filter((file) => /(^|\/)tsconfig[\w.-]*\.json$/.test(file.path))
      .map((file) => file.content)
      .join('\n');
    if (!/["']@\/\*["']\s*:/.test(tsconfigs)) {
      problems.push({
        check: 'runnable-scripts',
        detail:
          'the code imports from "@/" but no tsconfig maps "@/*" in paths, so TypeScript cannot resolve it',
      });
    }
    if (!/["']?@["']?\s*:|find\s*:\s*["']@["']/.test(viteConfig)) {
      problems.push({
        check: 'runnable-scripts',
        detail:
          'the code imports from "@/" but the vite config has no "@" alias, so the bundler cannot resolve it',
      });
    }
  }

  const scripts = pkg.scripts;
  const typescriptRange = [pkg.devDependencies, pkg.dependencies]
    .map((deps) =>
      typeof deps === 'object' && deps !== null
        ? (deps as Record<string, unknown>).typescript
        : undefined,
    )
    .find((value): value is string => typeof value === 'string');
  const typescriptMajor = typescriptRange
    ? rangeHighestMajor(typescriptRange)
    : undefined;
  const typechecks =
    typeof scripts === 'object' &&
    scripts !== null &&
    Object.values(scripts as Record<string, unknown>).some(
      (command) => typeof command === 'string' && /\btsc\b/.test(command),
    );
  const importsCss = sources.some((file) =>
    /^\s*import\s+['"][^'"]+\.css['"]/m.test(file.content),
  );
  const loadsViteTypes = files.some((file) =>
    file.content.includes('vite/client'),
  );
  // A declaration of its own types the import as well as Vite's do.
  const declaresCss = files.some((file) =>
    /\bdeclare\s+module\s+['"]\*\.css['"]/.test(file.content),
  );
  // And TS2882 is TypeScript's only where it checks side-effect imports:
  // by default from 6.0, before that where the tsconfig asks.
  // The tsconfig each script builds with: `tsc -p config/tsconfig.json`
  // names its own (internal PR 241 review).
  const invocations: TscInvocation[] = [];
  for (const command of typeof scripts === 'object' && scripts !== null
    ? Object.values(scripts as Record<string, unknown>)
    : []) {
    if (typeof command === 'string')
      invocations.push(...tscInvocations(command));
  }
  const configs = new Set(invocations.map((invocation) => invocation.path));
  const checksSideEffects = (() => {
    const byDefault = typescriptMajor === undefined || typescriptMajor >= 6;
    return [...configs].some((path) => {
      const tsconfig = files.find((file) => file.path === path);
      const setting =
        /["']?noUncheckedSideEffectImports["']?\s*:\s*(true|false)/.exec(
          tsconfig?.content ?? '',
        )?.[1];
      return setting === undefined ? byDefault : setting === 'true';
    });
  })();
  if (
    typechecks &&
    importsCss &&
    !loadsViteTypes &&
    !declaresCss &&
    checksSideEffects
  ) {
    problems.push({
      check: 'runnable-scripts',
      detail:
        'the code imports a stylesheet and the build typechecks, but nothing loads vite/client types, so tsc fails with TS2882',
    });
  }

  // Only in what tsc loads: the configs the scripts name and those they
  // extend or reference. A config nothing builds with may keep it
  // (internal PR 244 review). And a range that cannot be bounded, `*` or `latest`,
  // installs TypeScript 7 today (internal PR 244 review).
  if (
    typechecks &&
    typescriptRange !== undefined &&
    (typescriptMajor === undefined || typescriptMajor >= 7)
  ) {
    const reported = new Set<string>();
    for (const file of loadedConfigs(invocations, files)) {
      if (reported.has(file.path)) continue;
      // Not in a comment: tsconfig is JSONC (internal PR 244 review).
      if (/["']baseUrl["']\s*:/.test(withoutJsonComments(file.content))) {
        reported.add(file.path);
        problems.push({
          check: 'runnable-scripts',
          detail: `${file.path} sets "baseUrl", which TypeScript 7 removed, so tsc stops with TS5102 before it checks any code`,
        });
      }
    }
  }

  return problems;
}

export function checkPortability(
  snapshot: ProjectSnapshot,
): PortabilityProblem[] {
  const problems: PortabilityProblem[] = [];
  const paths = new Set(snapshot.files.map((file) => file.path));

  for (const required of REQUIRED_FILES) {
    if (!paths.has(required)) {
      problems.push({
        check: 'required-files',
        detail: `${required} is missing; the project cannot be installed or understood without it`,
      });
    }
  }

  for (const path of paths) {
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (path.startsWith(prefix)) {
        problems.push({
          check: 'no-vibld-directory',
          detail: `${path} ties the exported project to Vibld`,
        });
      }
    }
  }

  const manifest = snapshot.files.find((file) => file.path === 'package.json');
  if (manifest) {
    const parsed = parsePackageJson(manifest.content);
    if (!parsed.ok) {
      problems.push({
        check: 'valid-manifest',
        detail: 'package.json is not a JSON object, so no tool can read it',
      });
    } else {
      const scripts = parsed.value.scripts;
      const scriptNames =
        typeof scripts === 'object' && scripts !== null
          ? Object.keys(scripts as Record<string, unknown>)
          : [];
      for (const conventional of ['build', 'dev']) {
        if (!scriptNames.includes(conventional)) {
          problems.push({
            check: 'conventional-scripts',
            detail: `package.json has no "${conventional}" script; the project does not run the way its ecosystem expects`,
          });
        }
      }
      for (const name of dependencyNames(parsed.value)) {
        if (name.startsWith('@vibld/') || name === 'vibld') {
          problems.push({
            check: 'no-vibld-dependency',
            detail: `${name} would require Vibld to install the project`,
          });
        }
      }

      for (const name of unreadableSpecs(parsed.value)) {
        problems.push({
          check: 'valid-manifest',
          detail: `${name} is declared without a version string, so npm install fails on it`,
        });
      }

      problems.push(...checkToolConfiguration(parsed.value, paths));
      problems.push(...checkStackConfiguration(parsed.value, snapshot.files));
    }
  }

  return problems;
}
