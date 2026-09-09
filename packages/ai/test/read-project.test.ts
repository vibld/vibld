import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { diffProjects, readProject } from '../src/read-project.ts';

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibld-read-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return root;
}

describe('readProject', () => {
  it('reads a project into the shape the provider sends', async () => {
    const root = await fixture({
      'package.json': '{}',
      'src/App.tsx': 'export function App() {}',
      'src/styles.css': 'body {}',
    });
    const snapshot = await readProject(root);
    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ['package.json', 'src/App.tsx', 'src/styles.css'],
    );
    assert.equal(snapshot.files[1]!.content, 'export function App() {}');
  });

  it('uses forward slashes whatever the platform separator is', async () => {
    const root = await fixture({ 'src/sections/Hero.tsx': 'x' });
    const [file] = (await readProject(root)).files;
    assert.equal(file!.path, 'src/sections/Hero.tsx');
  });

  it('skips build output and dependencies', async () => {
    // Sending node_modules to a model would be absurd, and dist is generated.
    const root = await fixture({
      'src/App.tsx': 'x',
      'node_modules/react/index.js': 'huge',
      'dist/assets/index.js': 'built',
      '.git/config': 'secret-ish',
    });
    assert.deepEqual(
      (await readProject(root)).files.map((file) => file.path),
      ['src/App.tsx'],
    );
  });

  it('is ordered, so two reads of one project agree', async () => {
    const root = await fixture({ b: '2', a: '1', 'c/d': '3' });
    const first = await readProject(root);
    const second = await readProject(root);
    assert.deepEqual(first, second);
  });
});

describe('diffProjects', () => {
  const before = {
    revision: 'r1',
    files: [
      { path: 'a.tsx', content: 'one' },
      { path: 'b.tsx', content: 'two' },
      { path: 'c.tsx', content: 'three' },
    ],
  };

  it('names what a follow-up kept, changed, added and removed', () => {
    const diff = diffProjects(before, {
      files: [
        { path: 'a.tsx', content: 'one' },
        { path: 'b.tsx', content: 'TWO' },
        { path: 'd.tsx', content: 'four' },
      ],
    });
    assert.deepEqual(diff.kept, ['a.tsx']);
    assert.deepEqual(diff.changed, ['b.tsx']);
    assert.deepEqual(diff.added, ['d.tsx']);
    assert.deepEqual(diff.removed, ['c.tsx']);
  });

  it('reports a wholesale rewrite as removals, which is what it is', () => {
    // This is the failure ADR-0009 exists to prevent: a model that was never
    // shown the project returns only what it wrote, and everything else is
    // deleted on promotion.
    const diff = diffProjects(before, {
      files: [{ path: 'a.tsx', content: 'rewritten' }],
    });
    assert.deepEqual(diff.removed, ['b.tsx', 'c.tsx']);
    assert.deepEqual(diff.kept, []);
  });

  it('reports an untouched project as entirely kept', () => {
    const diff = diffProjects(before, { files: before.files });
    assert.equal(diff.kept.length, 3);
    assert.deepEqual(diff.removed, []);
  });
});
