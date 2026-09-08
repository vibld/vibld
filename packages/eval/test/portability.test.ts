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
