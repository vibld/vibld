import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkDco } from './check-dco.mjs';
import { checkWorkspaces } from './check-workspaces.mjs';

/** @param {import('node:test').TestContext} context */
function workspaceFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'vibld-workspace-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const root of ['apps', 'packages', 'examples'])
    mkdirSync(join(directory, root));
  return directory;
}

test('foundation has an explicit zero-workspace state', (context) => {
  assert.equal(checkWorkspaces(workspaceFixture(context)), 0);
});

test('source directories cannot hide from workspace checks', (context) => {
  const directory = workspaceFixture(context);
  mkdirSync(join(directory, 'apps/web'));
  assert.throws(() => checkWorkspaces(directory), /missing package.json/);
});

test('each workspace must declare all quality tasks', (context) => {
  const directory = workspaceFixture(context);
  mkdirSync(join(directory, 'apps/web'));
  const scripts = {
    lint: 'eslint .',
    typecheck: 'tsc --noEmit',
    test: 'vitest run',
    build: 'vite build',
  };
  for (const task of Object.keys(scripts)) {
    const incomplete = { ...scripts, [task]: '' };
    writeFileSync(
      join(directory, 'apps/web/package.json'),
      JSON.stringify({ name: '@vibld/web', scripts: incomplete }),
    );
    assert.throws(
      () => checkWorkspaces(directory),
      new RegExp(`missing ${task} script`),
    );
  }
  writeFileSync(
    join(directory, 'apps/web/package.json'),
    JSON.stringify({ name: '@vibld/web', scripts }),
  );
  assert.equal(checkWorkspaces(directory), 1);
});

test('DCO rejects unsigned, mismatched, and body-only sign-offs; accepts a real trailer', (context) => {
  const cwd = mkdtempSync(join(tmpdir(), 'vibld-dco-test-'));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Fixture Contributor']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['commit', '--allow-empty', '-m', 'base']);
  let base = git(['rev-parse', 'HEAD']);
  for (const message of [
    'unsigned contribution',
    'wrong author\n\nSigned-off-by: Someone Else <other@example.test>',
    'body mention\n\nSigned-off-by: Fixture Contributor <fixture@example.test>\n\nThis is prose, not a trailer.',
  ]) {
    git(['commit', '--allow-empty', '-m', message]);
    const head = git(['rev-parse', 'HEAD']);
    assert.throws(() => checkDco(base, head, cwd), /missing author-matching/);
    base = head;
  }
  git(['commit', '--allow-empty', '-s', '-m', 'signed contribution']);
  const head = git(['rev-parse', 'HEAD']);
  assert.equal(checkDco(base, head, cwd), 1);
  assert.throws(() => checkDco(head, head, cwd), /no contribution commits/);
  assert.throws(() => checkDco('--all', head, cwd), /full base and head/);
});
