import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectSnapshot } from '@vibld/core';
import {
  BoundedPlanProvider,
  SCAFFOLD_PATHS,
  createScriptedBuildClient,
} from '@vibld/ai';
import { CASES, stubPlan } from '../src/cases.ts';
import { checkPortability, rangeHighestMajor } from '../src/portability.ts';

function snapshot(files: { path: string; content: string }[]): ProjectSnapshot {
  return { revision: 'r00000000', files };
}

const MANIFEST = JSON.stringify({
  name: 'site',
  scripts: { dev: 'vite', build: 'vite build' },
  dependencies: { react: '19.2.0' },
  devDependencies: { vite: '8.3.0' },
});

describe('portability', () => {
  it('accepts a conventional, independent project', () => {
    const problems = checkPortability(
      snapshot([
        { path: 'package.json', content: MANIFEST },
        { path: 'README.md', content: '# site\n' },
      ]),
    );
    assert.deepEqual(problems, []);
  });

  it('rejects a project that needs Vibld to install', () => {
    const problems = checkPortability(
      snapshot([
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'site',
            scripts: { dev: 'vite', build: 'vite build' },
            dependencies: { '@vibld/runtime': '1.0.0' },
            devDependencies: { vite: '8.3.0' },
          }),
        },
        { path: 'README.md', content: '# site\n' },
      ]),
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.check, 'no-vibld-dependency');
  });

  it('accepts a .vibld directory that nothing needs (ADR-0002, D94)', () => {
    const problems = checkPortability(
      snapshot([
        { path: 'package.json', content: MANIFEST },
        { path: 'README.md', content: '# site\n' },
        { path: '.vibld/state.json', content: '{}' },
      ]),
    );
    assert.ok(
      !problems.some((problem) => problem.check === 'vibld-metadata-optional'),
    );
  });

  it('rejects a project file that needs the .vibld metadata', () => {
    const problems = checkPortability(
      snapshot([
        { path: 'package.json', content: MANIFEST },
        { path: 'README.md', content: '# site\n' },
        { path: '.vibld/state.json', content: '{}' },
        {
          path: 'src/main.tsx',
          content: "import state from '../.vibld/state.json';\n",
        },
      ]),
    );
    const found = problems.filter(
      (problem) => problem.check === 'vibld-metadata-optional',
    );
    assert.equal(found.length, 1);
    assert.match(found[0]!.detail, /src\/main\.tsx/);
  });

  it('names every missing required file, not just the first', () => {
    const problems = checkPortability(
      snapshot([{ path: 'index.html', content: '' }]),
    );
    const details = problems.map((problem) => problem.detail).join(' ');
    assert.match(details, /package\.json/);
    assert.match(details, /README\.md/);
  });

  it('rejects a manifest without conventional scripts', () => {
    const problems = checkPortability(
      snapshot([
        { path: 'package.json', content: JSON.stringify({ name: 'site' }) },
        { path: 'README.md', content: '# site\n' },
      ]),
    );
    const checks = problems.map((problem) => problem.check);
    assert.ok(checks.includes('conventional-scripts'));
  });

  it('rejects a manifest no tool can read', () => {
    const problems = checkPortability(
      snapshot([
        { path: 'package.json', content: 'not json at all' },
        { path: 'README.md', content: '# site\n' },
      ]),
    );
    assert.ok(problems.some((problem) => problem.check === 'valid-manifest'));
  });
});

describe('scripts that cannot actually run', () => {
  // Declares the tools its scripts run, so each test here sees only the
  // problem it is about.
  function manifest(extra: Record<string, unknown> = {}) {
    const { devDependencies, ...rest } = extra;
    return JSON.stringify({
      name: 'site',
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build' },
      ...rest,
      devDependencies: {
        vite: '8.3.0',
        typescript: '7.0.2',
        ...(devDependencies as Record<string, string> | undefined),
      },
    });
  }

  function withFiles(paths: string[], pkg = manifest()) {
    return checkPortability(
      snapshot([
        { path: 'package.json', content: pkg },
        { path: 'README.md', content: '# site\n' },
        ...paths.map((path) => ({ path, content: '{}' })),
      ]),
    );
  }

  it('catches a tsc script with no tsconfig', () => {
    // This is the real failure: the planner's own project declared this
    // script, shipped no tsconfig, and `npm run build` on the export stopped
    // at tsc printing its usage. Every other check here passed it.
    const problems = withFiles([]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.check, 'runnable-scripts');
    assert.match(problems[0]!.detail, /"build" script runs tsc/);
    assert.match(problems[0]!.detail, /prints usage/);
  });

  it('is satisfied by a tsconfig', () => {
    assert.deepEqual(withFiles(['tsconfig.json']), []);
  });

  it('accepts a script that names its own project file', () => {
    // `tsc -p config/tsconfig.build.json` does not need a root tsconfig.
    assert.deepEqual(
      withFiles(
        [],
        manifest({
          scripts: {
            dev: 'vite',
            build: 'tsc -p tsconfig.build.json && vite build',
          },
        }),
      ),
      [],
    );
    assert.deepEqual(
      withFiles(
        [],
        manifest({
          scripts: { dev: 'vite', build: 'tsc --project tsconfig.build.json' },
        }),
      ),
      [],
    );
  });

  it('finds tsc wherever it sits in the command', () => {
    for (const command of [
      'tsc --noEmit',
      'vite build && tsc --noEmit',
      'npm run clean; tsc',
      'npx tsc --noEmit',
      'rimraf dist || tsc --noEmit',
    ]) {
      const problems = withFiles(
        [],
        manifest({
          scripts: { dev: 'vite', build: command },
        }),
      );
      // Only the tsconfig problem: `rimraf dist || tsc` is also a build
      // that can succeed without checking, which another test covers.
      assert.equal(
        problems.filter((problem) => /prints usage/.test(problem.detail))
          .length,
        1,
        command,
      );
    }
  });

  it('is not fooled by a word that merely contains "tsc"', () => {
    for (const command of ['run-tsc-wrapper', 'echo tscheck', 'vitest run']) {
      assert.deepEqual(
        withFiles(
          [],
          manifest({
            // Not "build": a TypeScript build has to run tsc, and this is
            // only about the tsconfig check reading a word.
            scripts: {
              dev: 'vite',
              build: 'tsc -p tsconfig.app.json && vite build',
              check: command,
            },
            devDependencies: { vitest: '4.0.0' },
          }),
        ),
        [],
        command,
      );
    }
  });

  it('catches a build plugin that nothing configures', () => {
    const problems = withFiles(
      ['tsconfig.json'],
      manifest({ devDependencies: { '@vitejs/plugin-react': '^5.1.0' } }),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0]!.detail, /no vite config/);
  });

  it('accepts either vite config extension', () => {
    for (const config of ['vite.config.ts', 'vite.config.js']) {
      assert.deepEqual(
        withFiles(
          ['tsconfig.json', config],
          manifest({ devDependencies: { '@vitejs/plugin-react': '^5.1.0' } }),
        ),
        [],
        config,
      );
    }
  });
  it('rejects a script whose tool the project does not install', () => {
    // The CI stub's own shape, reported accepted until internal PR 59: `vite build` with
    // no vite dependency, which stops at "vite: not found".
    const problems = checkPortability(
      snapshot([
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'site',
            scripts: { dev: 'vite', build: 'tsc -b && npx vite build' },
            dependencies: { react: '19.2.0' },
          }),
        },
        { path: 'README.md', content: '# site\n' },
        { path: 'tsconfig.json', content: '{}' },
      ]),
    );
    const details = problems.map((problem) => problem.detail);
    assert.ok(
      details.some((d) =>
        /"dev" script runs vite, but no dependency installs it/.test(d),
      ),
    );
    assert.ok(details.some((d) => /"build" script runs vite/.test(d)));
    assert.ok(
      details.some((d) =>
        /"build" script runs tsc, but no dependency installs it \(typescript\)/.test(
          d,
        ),
      ),
    );
  });

  it("accepts either package that ships Tailwind's CLI", () => {
    // v4 moved the executable into @tailwindcss/cli; v3's tailwindcss
    // package ships it itself. Requiring the v4 one refused a working v3
    // project (internal PR 237 review).
    const withTailwind = (dependency: string, range: string) =>
      checkPortability(
        snapshot([
          {
            path: 'package.json',
            content: JSON.stringify({
              name: 'site',
              scripts: {
                dev: 'vite',
                build:
                  'tailwindcss -i src/in.css -o dist/out.css && vite build',
              },
              devDependencies: { vite: '8.3.0', [dependency]: range },
            }),
          },
          { path: 'README.md', content: '# site\n' },
        ]),
      );
    assert.deepEqual(withTailwind('tailwindcss', '^3.4.17'), []);
    assert.deepEqual(withTailwind('@tailwindcss/cli', '^4.3.3'), []);
    const missing = (dependency: string, range: string) =>
      withTailwind(dependency, range)
        .map((problem) => problem.detail)
        .join('\n');
    // v4 moved the executable out of the tailwindcss package, and a range
    // that names no version, or that npm may resolve to v4, cannot be taken
    // to be v3.
    for (const range of [
      '^4.3.3',
      '4.x',
      'latest',
      '*',
      '>=3',
      '3.0.0 - 4.0.0',
      '^3 || ^4',
      '>=4 <4',
    ]) {
      assert.match(
        missing('tailwindcss', range),
        /runs tailwindcss, but no dependency installs it/,
        range,
      );
    }
    assert.match(missing('postcss', '^8.5.0'), /no dependency installs it/);
  });

  it('refuses a project whose own install runs a script (#237 review)', () => {
    for (const hook of [
      'preinstall',
      'install',
      'postinstall',
      'prepare',
      'prepublish',
    ]) {
      const problems = withFiles(
        ['tsconfig.json'],
        manifest({
          scripts: {
            dev: 'vite',
            build: 'tsc --noEmit && vite build',
            [hook]: 'node scripts/generate.js',
          },
        }),
      );
      assert.equal(problems.length, 1, hook);
      assert.match(
        problems[0]!.detail,
        new RegExp(`"${hook}" script runs during npm install`),
      );
    }
    // A script npm does not run on install is the project's own business.
    assert.deepEqual(
      withFiles(
        ['tsconfig.json'],
        manifest({
          scripts: {
            dev: 'vite',
            build: 'tsc --noEmit && vite build',
            generate: 'node scripts/generate.js',
          },
        }),
      ),
      [],
    );
  });

  it('refuses a dependency declared without a version string (#237 review)', () => {
    for (const spec of [null, 4, {}, true]) {
      const problems = withFiles(
        ['tsconfig.json'],
        JSON.stringify({
          name: 'site',
          scripts: { dev: 'vite', build: 'tsc --noEmit && vite build' },
          devDependencies: { vite: spec, typescript: '7.0.2' },
        }),
      );
      const details = problems.map((problem) => problem.detail).join('\n');
      assert.match(details, /vite is declared without a version string/);
      // And it installs nothing, so the scripts that run it are refused too.
      assert.match(
        details,
        /"dev" script runs vite, but no dependency installs it/,
      );
    }
  });

  it('refuses a TypeScript build that never runs tsc', () => {
    // DeepSeek V4 Pro's pottery booking app: `vite build` alone, with a
    // "typecheck" script nothing ran. It built, and threw a ReferenceError
    // on load that tsc would have stopped.
    const problems = withFiles(
      ['tsconfig.json', 'src/App.tsx'],
      manifest({
        scripts: {
          dev: 'vite',
          build: 'vite build',
          typecheck: 'tsc --noEmit',
        },
      }),
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.check, 'runnable-scripts');
    assert.match(
      problems[0]!.detail,
      /"build" script \(vite build\) never runs tsc/,
    );
  });

  it('accepts a build that runs tsc through another script', () => {
    for (const build of [
      'npm run typecheck && vite build',
      'npm run -s typecheck && vite build',
      'pnpm typecheck && vite build',
      'yarn run check && vite build',
    ]) {
      const pkg = manifest({
        scripts: {
          dev: 'vite',
          build,
          typecheck: 'tsc --noEmit',
          check: 'npm run typecheck',
        },
      });
      assert.deepEqual(
        withFiles(['tsconfig.json', 'src/App.tsx'], pkg),
        [],
        build,
      );
    }
  });

  it('counts only a tsc that checks on the way to a successful build (#247 review)', () => {
    const refused = [
      'echo tsc && vite build',
      'tsc --version && vite build',
      'vite build || tsc',
      'tsc --noEmit || true && vite build',
      'tsc --noEmit; vite build',
      'tsc --noEmit | tee log && vite build',
      'tsc --noCheck && vite build',
      'npm run lint && vite build',
      'yarn tsc --noCheck && vite build',
      // Round two of the review: a file list, watch mode, a || that can
      // succeed without the check.
      'tsc --noEmit scripts/noop.ts && vite build',
      'tsc --watch --noEmit && vite build',
      'tsc -w && vite build',
      'tsc --noEmit && vite build || true',
      'tsc --noEmit && vite build || exit 0',
    ];
    for (const build of refused) {
      const pkg = manifest({
        scripts: { dev: 'vite', build, lint: 'echo tsc' },
      });
      const problems = withFiles(['tsconfig.json', 'src/App.tsx'], pkg);
      assert.match(
        problems.map((problem) => problem.detail).join('\n'),
        /never runs tsc/,
        build,
      );
    }
    for (const build of [
      'tsc -b && vite build',
      'rm -rf dist; tsc --noEmit && vite build',
      'NODE_ENV=production npx --no-install tsc --noEmit && vite build',
      'pnpm exec tsc --noEmit && vite build',
      'yarn tsc && vite build',
      'tsc -b src/app && vite build',
      'tsc --noEmit && vite build || exit 1',
      'tsc --noEmit || exit 1; vite build',
      'vue-tsc --noEmit && vite build',
    ]) {
      const pkg = manifest({
        scripts: { dev: 'vite', build },
        devDependencies: { 'vue-tsc': '3.0.0' },
      });
      assert.deepEqual(
        withFiles(['tsconfig.json', 'src/App.tsx'], pkg),
        [],
        build,
      );
    }
  });

  it('reports vue-tsc that nothing installs (#247 review)', () => {
    const pkg = manifest({
      scripts: { dev: 'vite', build: 'vue-tsc --noEmit && vite build' },
    });
    const problems = withFiles(['tsconfig.json', 'src/App.tsx'], pkg);
    assert.match(
      problems.map((problem) => problem.detail).join('\n'),
      /runs vue-tsc, but no dependency installs it/,
    );
  });

  it('does not loop on a script that runs itself', () => {
    const pkg = manifest({
      scripts: {
        dev: 'vite',
        build: 'npm run build:all',
        'build:all': 'npm run build:all && vite build',
      },
    });
    const problems = withFiles(['tsconfig.json', 'src/App.tsx'], pkg);
    assert.match(problems.map((p) => p.detail).join('\n'), /never runs tsc/);
  });

  it('asks nothing of a build with no TypeScript in it', () => {
    const pkg = JSON.stringify({
      name: 'site',
      scripts: { dev: 'vite', build: 'vite build' },
      devDependencies: { vite: '8.3.0' },
    });
    assert.deepEqual(withFiles(['src/main.js', 'src/vite-env.d.ts'], pkg), []);
  });

  it('reads the tool past an environment assignment and ignores tools it does not know', () => {
    const problems = checkPortability(
      snapshot([
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'site',
            scripts: {
              dev: 'NODE_ENV=development vite',
              build: 'vite build',
              clean: 'rm -rf dist && node scripts/clean.js',
            },
            devDependencies: { vite: '8.3.0' },
          }),
        },
        { path: 'README.md', content: '# site\n' },
      ]),
    );
    assert.deepEqual(problems, []);
  });
});

describe('the highest major version a range can resolve to', () => {
  it('reads simple ranges', () => {
    for (const [range, major] of [
      ['^4.3.3', 4],
      ['~3.4.1', 3],
      ['~3.4', 3],
      ['3.x', 3],
      ['3', 3],
      ['v3.4.0', 3],
      ['=3.4.17', 3],
      ['3.4.17', 3],
      ['^2 || ^3', 3],
      ['3.4.0-beta.1', 3],
      ['^3.4.0-beta.1', 3],
      ['3.4.17+build.5', 3],
    ] as const) {
      assert.equal(rangeHighestMajor(range), major, range);
    }
  });

  it('gives the highest alternative, not the first (#237 review)', () => {
    for (const [range, major] of [
      ['^3 || ^4', 4],
      ['^4 || ^3', 4],
    ] as const) {
      assert.equal(rangeHighestMajor(range), major, range);
    }
  });

  it('reads nothing from a range it cannot bound or satisfy (#237 review)', () => {
    for (const range of [
      '>=3',
      '>3.4.0',
      '<4',
      '>=3.0.0 <4.0.0',
      '>=4 <4',
      '>=4 <=3',
      '3.0.0 - 4.0.0',
      '^3 || >=4',
      'latest',
      '*',
      'x',
      'github:tailwindlabs/tailwindcss',
      'npm:tailwindcss@3',
      // Dist-tags, which npm resolves to whatever was published under them.
      '3.4-beta',
      '3.x-beta',
      '3-next',
      '^3.4-beta',
      'file:../tailwind',
      '',
      '^3 ||',
    ]) {
      assert.equal(rangeHighestMajor(range), undefined, range);
    }
  });
});

/**
 * Configuration the Tailwind, shadcn/ui and Motion stack needs (ADR-0014),
 * checked against the stub plan, which CI builds, so the passing case is a
 * project known to install and compile.
 */
describe('the generated stack', () => {
  const stub = stubPlan(CASES[0]!).files;
  const replace = (path: string, content: string | null) =>
    snapshot(
      content === null
        ? stub.filter((file) => file.path !== path)
        : stub.map((file) => (file.path === path ? { path, content } : file)),
    );
  const details = (problems: { detail: string }[]) =>
    problems.map((problem) => problem.detail).join('\n');

  it('accepts the stub, which CI installs and builds', () => {
    assert.deepEqual(checkPortability(snapshot(stub)), []);
  });

  it("accepts a bounded build's project, whose configuration Vibld writes (D71)", async () => {
    // The model writes only its own files; the outline also lists the
    // configuration, as one written before D71 would, and is not asked.
    const own = stub.filter(
      (file) =>
        !(SCAFFOLD_PATHS as readonly string[]).includes(file.path) &&
        file.path !== 'DESIGN.md',
    );
    const client = createScriptedBuildClient({
      summary: 'A site.',
      title: 'Crumb & Co.',
      description: 'Bread on Elm Street.',
      files: [
        ...stub.filter((file) => file.path !== 'DESIGN.md'),
        {
          path: 'src/components/ui/command.tsx',
          content: "import { Command } from 'cmdk';\nexport { Command };\n",
        },
      ],
    });
    const plan = await new BoundedPlanProvider(client, {
      model: 'claude-opus-5-5',
    }).generate({ prompt: 'A bakery.' });
    for (const path of SCAFFOLD_PATHS) {
      assert.ok(
        plan.files.some((file) => file.path === path),
        `${path} is missing`,
      );
    }
    assert.ok(own.length > 0);
    assert.deepEqual(checkPortability(snapshot(plan.files)), []);
    const pkg = JSON.parse(
      plan.files.find((file) => file.path === 'package.json')!.content,
    ) as { dependencies: Record<string, string> };
    assert.ok(pkg.dependencies.cmdk, 'an imported package is not declared');
  });

  it('refuses @tailwindcss/vite that the vite config never adds', () => {
    const problems = checkPortability(
      replace(
        'vite.config.ts',
        "import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [react()], resolve: { alias: { '@': '/src' } } });\n",
      ),
    );
    assert.match(details(problems), /no utility class is generated/);
  });

  it('refuses an @/ import that one of the two tools cannot resolve', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const withoutPaths = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    delete withoutPaths.compilerOptions.paths;
    assert.match(
      details(
        checkPortability(
          replace('tsconfig.json', JSON.stringify(withoutPaths)),
        ),
      ),
      /no tsconfig maps "@\/\*"/,
    );
    assert.match(
      details(
        checkPortability(
          replace(
            'vite.config.ts',
            "import tailwindcss from '@tailwindcss/vite';\nimport react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [react(), tailwindcss()] });\n",
          ),
        ),
      ),
      /no "@" alias/,
    );
  });

  it('refuses a stylesheet import tsc cannot type', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const withoutTypes = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    delete withoutTypes.compilerOptions.types;
    assert.match(
      details(
        checkPortability(
          replace('tsconfig.json', JSON.stringify(withoutTypes)),
        ),
      ),
      /TS2882/,
    );
  });

  it('accepts a stylesheet import tsc can type another way (#241 review)', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const withoutTypes = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    delete withoutTypes.compilerOptions.types;
    const withoutViteTypes = replace(
      'tsconfig.json',
      JSON.stringify(withoutTypes),
    );
    const withFiles = (
      files: { path: string; content: string }[],
    ): ProjectSnapshot => ({ ...withoutViteTypes, files });
    // Its own declaration of what a stylesheet is.
    assert.doesNotMatch(
      details(
        checkPortability(
          withFiles([
            ...withoutViteTypes.files,
            { path: 'src/css.d.ts', content: "declare module '*.css';\n" },
          ]),
        ),
      ),
      /TS2882/,
    );
    // A TypeScript that does not check side-effect imports.
    const pkg = withoutViteTypes.files.find(
      (file) => file.path === 'package.json',
    )!;
    const manifest = JSON.parse(pkg.content) as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.typescript = '^5.8.0';
    assert.doesNotMatch(
      details(
        checkPortability(
          withFiles(
            withoutViteTypes.files.map((file) =>
              file === pkg
                ? { path: file.path, content: JSON.stringify(manifest) }
                : file,
            ),
          ),
        ),
      ),
      /TS2882/,
    );
  });

  it('refuses a baseUrl that TypeScript 7 removed', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const config = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    config.compilerOptions.baseUrl = '.';
    const withBaseUrl = replace('tsconfig.json', JSON.stringify(config));
    assert.match(
      details(checkPortability(withBaseUrl)),
      /tsconfig\.json sets "baseUrl".*TS5102/,
    );
    // Before TypeScript 7 it is only deprecated, and builds.
    const pkg = withBaseUrl.files.find((file) => file.path === 'package.json')!;
    const manifest = JSON.parse(pkg.content) as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.typescript = '^5.9.0';
    assert.doesNotMatch(
      details(
        checkPortability({
          ...withBaseUrl,
          files: withBaseUrl.files.map((file) =>
            file === pkg
              ? { path: file.path, content: JSON.stringify(manifest) }
              : file,
          ),
        }),
      ),
      /baseUrl/,
    );
  });

  it('reads baseUrl only in the tsconfigs tsc loads (#244 review)', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const config = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    const pkg = stub.find((file) => file.path === 'package.json')!;
    const manifest = JSON.parse(pkg.content) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'tsc -p tsconfig.app.json && vite build';
    manifest.scripts.typecheck = 'tsc --noEmit -p tsconfig.app.json';
    const project = (extra: { path: string; content: string }[]) =>
      snapshot([
        ...stub.filter(
          (file) =>
            file.path !== 'tsconfig.json' && file.path !== 'package.json',
        ),
        { path: 'package.json', content: JSON.stringify(manifest) },
        ...extra,
      ]);
    const legacy = {
      path: 'tsconfig.legacy.json',
      content: JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
    };
    // A config nothing builds with may keep it.
    assert.doesNotMatch(
      details(
        checkPortability(
          project([
            { path: 'tsconfig.app.json', content: JSON.stringify(config) },
            legacy,
          ]),
        ),
      ),
      /baseUrl/,
    );
    // One the built config extends may not.
    assert.match(
      details(
        checkPortability(
          project([
            {
              path: 'tsconfig.app.json',
              content: JSON.stringify({
                ...config,
                extends: './tsconfig.legacy',
              }),
            },
            legacy,
          ]),
        ),
      ),
      /tsconfig\.legacy\.json sets "baseUrl"/,
    );
    // One it references only when tsc builds in build mode: `tsc -p`
    // reads a reference's declarations, never its options.
    const referencing = {
      path: 'tsconfig.app.json',
      content: JSON.stringify({
        ...config,
        references: [{ path: './tsconfig.legacy.json' }],
      }),
    };
    assert.doesNotMatch(
      details(checkPortability(project([referencing, legacy]))),
      /baseUrl/,
    );
    manifest.scripts.build = 'tsc -b tsconfig.app.json && vite build';
    assert.match(
      details(checkPortability(project([referencing, legacy]))),
      /tsconfig\.legacy\.json sets "baseUrl"/,
    );
  });

  it('reads the projects tsc -b names, not only the root one (#244 review)', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const config = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    const pkg = stub.find((file) => file.path === 'package.json')!;
    const manifest = JSON.parse(pkg.content) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'tsc -b tsconfig.app.json && vite build';
    manifest.scripts.typecheck = 'tsc -b tsconfig.app.json';
    assert.match(
      details(
        checkPortability(
          snapshot([
            ...stub.filter((file) => file.path !== 'package.json'),
            { path: 'package.json', content: JSON.stringify(manifest) },
            {
              path: 'tsconfig.app.json',
              content: JSON.stringify({
                ...config,
                compilerOptions: { ...config.compilerOptions, baseUrl: '.' },
              }),
            },
          ]),
        ),
      ),
      /tsconfig\.app\.json sets "baseUrl"/,
    );
  });

  it('does not read a baseUrl that is commented out (#244 review)', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const commented = tsconfig.content.replace(
      '"compilerOptions": {',
      '"compilerOptions": {\n    // "baseUrl": ".",\n    /* "baseUrl": "src", */',
    );
    assert.notEqual(commented, tsconfig.content);
    assert.doesNotMatch(
      details(checkPortability(replace('tsconfig.json', commented))),
      /baseUrl/,
    );
    // A string that looks like a comment is still read as a string.
    const config = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    config.compilerOptions.baseUrl = '.';
    config.compilerOptions.outDir = 'http://example.test//x';
    assert.match(
      details(
        checkPortability(replace('tsconfig.json', JSON.stringify(config))),
      ),
      /sets "baseUrl"/,
    );
  });

  it('reads a TypeScript range it cannot bound as 7 (#244 review)', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const config = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    config.compilerOptions.baseUrl = '.';
    const withBaseUrl = replace('tsconfig.json', JSON.stringify(config));
    const pkg = withBaseUrl.files.find((file) => file.path === 'package.json')!;
    for (const range of ['*', 'latest']) {
      const manifest = JSON.parse(pkg.content) as {
        devDependencies: Record<string, string>;
      };
      manifest.devDependencies.typescript = range;
      assert.match(
        details(
          checkPortability({
            ...withBaseUrl,
            files: withBaseUrl.files.map((file) =>
              file === pkg
                ? { path: file.path, content: JSON.stringify(manifest) }
                : file,
            ),
          }),
        ),
        /sets "baseUrl"/,
        range,
      );
    }
  });

  it('reads the tsconfig a tsc -p build names (#241 review)', () => {
    const tsconfig = stub.find((file) => file.path === 'tsconfig.json')!;
    const withoutTypes = JSON.parse(tsconfig.content) as {
      compilerOptions: Record<string, unknown>;
    };
    delete withoutTypes.compilerOptions.types;
    const pkg = stub.find((file) => file.path === 'package.json')!;
    const manifest = JSON.parse(pkg.content) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'tsc -p config/tsconfig.json && vite build';
    manifest.scripts.typecheck = 'tsc --noEmit -p config/tsconfig.json';
    manifest.scripts.lint = 'tsc --noEmit -p config/tsconfig.json';
    const lenient = {
      ...withoutTypes,
      compilerOptions: {
        ...withoutTypes.compilerOptions,
        noUncheckedSideEffectImports: false,
      },
    };
    const project = (config: object): ProjectSnapshot =>
      snapshot([
        ...stub.filter(
          (file) =>
            file.path !== 'tsconfig.json' && file.path !== 'package.json',
        ),
        { path: 'package.json', content: JSON.stringify(manifest) },
        { path: 'tsconfig.json', content: JSON.stringify(withoutTypes) },
        { path: 'config/tsconfig.json', content: JSON.stringify(config) },
      ]);
    assert.doesNotMatch(details(checkPortability(project(lenient))), /TS2882/);
    assert.match(details(checkPortability(project(withoutTypes))), /TS2882/);
  });
});
