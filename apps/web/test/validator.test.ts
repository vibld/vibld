import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectSnapshot } from '@vibld/core';
import { deriveBrief } from '../src/generation/brief.ts';
import { buildProjectFiles } from '../src/generation/plan-builder.ts';
import {
  DEFAULT_LIMITS,
  contrastWarnings,
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

describe('contrastWarnings', () => {
  const snapshot = (css: string): ProjectSnapshot => ({
    revision: 'r1',
    files: [{ path: 'src/styles.css', content: css }],
  });

  it('reports a failing pair with both values and the measured ratio', () => {
    const warnings = contrastWarnings(
      snapshot(':root { --primary: #FF385C; --primary-foreground: #FFFFFF; }'),
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /src\/styles\.css/);
    assert.match(warnings[0], /#FF385C/);
    assert.match(warnings[0], /3\.5\d:1/);
  });

  it('says nothing when every declared pair passes', () => {
    assert.deepEqual(
      contrastWarnings(
        snapshot(
          ':root { --primary: #1D4ED8; --primary-foreground: #FFFFFF; }',
        ),
      ),
      [],
    );
  });

  it('checks every stylesheet, not only the one the prompt names', () => {
    const warnings = contrastWarnings({
      revision: 'r1',
      files: [
        { path: 'src/styles.css', content: ':root { --a: #000000; }' },
        {
          path: 'src/tokens.css',
          content:
            ':root { --primary: #FF385C; --primary-foreground: #FFFFFF; }',
        },
      ],
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /src\/tokens\.css/);
  });
});

describe('validateSnapshot and contrast', () => {
  it('warns without failing, because the project still works', () => {
    const result = validateSnapshot({
      revision: 'r1',
      files: [
        { path: 'package.json', content: '{}' },
        { path: 'index.html', content: '<!doctype html>' },
        { path: 'src/main.tsx', content: '' },
        { path: 'src/App.tsx', content: '' },
        {
          path: 'src/styles.css',
          content:
            ':root { --primary: #FF385C; --primary-foreground: #FFFFFF; }',
        },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings?.length, 1);
  });

  it('omits the channel entirely when there is nothing to say', () => {
    const result = validateSnapshot({
      revision: 'r1',
      files: [
        { path: 'package.json', content: '{}' },
        { path: 'index.html', content: '<!doctype html>' },
        { path: 'src/main.tsx', content: '' },
        { path: 'src/App.tsx', content: '' },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.warnings, undefined);
  });
});
