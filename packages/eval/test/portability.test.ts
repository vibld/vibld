import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectSnapshot } from '@vibld/core';
import { checkPortability } from '../src/portability.ts';

function snapshot(files: { path: string; content: string }[]): ProjectSnapshot {
  return { revision: 'r00000000', files };
}

const MANIFEST = JSON.stringify({
  name: 'site',
  scripts: { dev: 'vite', build: 'vite build' },
  dependencies: { react: '19.2.0' },
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
          }),
        },
        { path: 'README.md', content: '# site\n' },
      ]),
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.check, 'no-vibld-dependency');
  });

  it('rejects a .vibld directory', () => {
    const problems = checkPortability(
      snapshot([
        { path: 'package.json', content: MANIFEST },
        { path: 'README.md', content: '# site\n' },
        { path: '.vibld/state.json', content: '{}' },
      ]),
    );
    assert.ok(
      problems.some((problem) => problem.check === 'no-vibld-directory'),
    );
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
  function manifest(extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      name: 'site',
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build' },
      ...extra,
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
      assert.equal(problems.length, 1, command);
    }
  });

  it('is not fooled by a word that merely contains "tsc"', () => {
    for (const command of ['run-tsc-wrapper', 'echo tscheck', 'vitest run']) {
      assert.deepEqual(
        withFiles([], manifest({ scripts: { dev: 'vite', build: command } })),
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
});
