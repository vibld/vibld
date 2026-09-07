import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectSnapshot } from '@vibld/core';
import { deriveBrief } from '../src/generation/brief.ts';
import { buildProjectFiles } from '../src/generation/plan-builder.ts';
import {
  DEFAULT_LIMITS,
  pathProblem,
  validateSnapshot,
} from '../src/generation/validator.ts';

function snapshot(files: ProjectSnapshot['files']): ProjectSnapshot {
  return { revision: 'r00000000', files };
}

describe('staged project validation', () => {
  it('accepts a generated project', () => {
    const files = buildProjectFiles(
      deriveBrief('a pricing page for a security product'),
    );
    assert.deepEqual(validateSnapshot(snapshot(files)), {
      ok: true,
      errors: [],
    });
  });

  it('rejects a file that escapes the project root', () => {
    const files = buildProjectFiles(deriveBrief('anything'), 'fail-validation');
    const result = validateSnapshot(snapshot(files));
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) => error.includes('escapes the project root')),
    );
  });

  it('rejects non-canonical, absolute and traversing paths', () => {
    assert.ok(pathProblem('/etc/passwd'));
    assert.ok(pathProblem('C:/windows/system32'));
    assert.ok(pathProblem('src/../../secret.txt'));
    assert.ok(pathProblem('src//App.tsx'));
    assert.ok(pathProblem('src\\App.tsx'));
    assert.equal(pathProblem('src/App.tsx'), undefined);
  });

  it('rejects duplicates, oversized files and missing required files', () => {
    const duplicate = validateSnapshot(
      snapshot([
        { path: 'package.json', content: '{}' },
        { path: 'package.json', content: '{}' },
      ]),
    );
    assert.ok(
      duplicate.errors.some((error) => error.includes('staged more than once')),
    );
    assert.ok(
      duplicate.errors.some((error) => error.includes('missing "index.html"')),
    );

    const oversized = validateSnapshot(
      snapshot([
        {
          path: 'big.txt',
          content: 'x'.repeat(DEFAULT_LIMITS.maxFileBytes + 1),
        },
      ]),
    );
    assert.ok(
      oversized.errors.some((error) => error.includes('above the limit')),
    );
  });

  it('rejects an empty project', () => {
    const result = validateSnapshot(snapshot([]));
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('The staged project contains no files'));
  });
});
