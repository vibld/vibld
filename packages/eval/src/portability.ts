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

  // A build plugin nobody configures is a dependency the project installs
  // and never uses, and it means JSX is transformed by whatever the bundler
  // defaults to rather than by the tool the manifest names.
  const usesReactPlugin = dependencyNames(pkg).includes('@vitejs/plugin-react');
  const hasViteConfig = ['vite.config.ts', 'vite.config.js'].some((path) =>
    paths.has(path),
  );
  if (usesReactPlugin && !hasViteConfig) {
    problems.push({
      check: 'runnable-scripts',
      detail:
        '@vitejs/plugin-react is a dependency but there is no vite config to use it',
    });
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

      problems.push(...checkToolConfiguration(parsed.value, paths));
    }
  }

  return problems;
}
