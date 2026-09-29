import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  importSql,
  isClerkUserId,
  isGeneratedPath,
  readProject,
  revisionFor,
} from './import-project.mjs';

describe('import-project', () => {
  it('computes the revision the generation machine would', async () => {
    const machine = await readFile(
      join(
        import.meta.dirname,
        '..',
        'packages/core/src/generation-machine.ts',
      ),
      'utf8',
    );
    // The hash is copied, not imported, so the copy is pinned to the source.
    assert.match(machine, /let hash = 2166136261;/);
    assert.match(machine, /Math\.imul\(hash, 16777619\)/);
    assert.equal(revisionFor([]), revisionFor([]));
    assert.match(revisionFor([{ path: 'a', content: 'b' }]), /^r[0-9a-f]{8}$/);
  });

  it('keeps what the model wrote and drops what the build left', async () => {
    const root = await mkdtemp(join(tmpdir(), 'import-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules/x'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'src/App.tsx'), 'export {}');
    await writeFile(join(root, 'node_modules/x/index.js'), '');
    await writeFile(join(root, 'dist/index.html'), '');
    await writeFile(join(root, 'package-lock.json'), '{}');
    await writeFile(join(root, 'build.log'), '');
    const files = await readProject(root);
    assert.deepEqual(
      files.map((file) => file.path),
      ['package.json', 'src/App.tsx'],
    );
    assert.equal(isGeneratedPath('src/dist/x.ts'), true);
  });

  it('escapes the name and accepts only a Clerk user id', () => {
    const sql = importSql({
      id: 'p',
      owner: 'user_abcdefghijk',
      name: "Chris's site",
      revision: 'r00000000',
      now: 't',
    });
    assert.match(sql, /'Chris''s site'/);
    assert.equal(isClerkUserId('user_3JCOOkONFMoGGvYXTMxi3dfitCI'), true);
    assert.equal(isClerkUserId("user_x'; DROP TABLE projects; --"), false);
  });
});
