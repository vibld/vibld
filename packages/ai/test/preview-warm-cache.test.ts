import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { OPTIONAL_PACKAGES, stackDependencies } from '../src/stack.ts';

/**
 * The preview image starts from the stack a generated project is built
 * from, already installed (D74).
 *
 * `apps/preview/Dockerfile` installs `apps/preview/warm/package.json` once
 * at build time, and each preview moves that node_modules into its project
 * before its own `npm install`, which then only has to reconcile it. The
 * list there is a copy of the one here, because a Docker build cannot run
 * this package's TypeScript; this is what keeps the copy honest. A stack
 * that moved on without it would not break anything, it would quietly make
 * every preview's install slow again, which is what D74 removed.
 *
 * Exactly the stack, and nothing optional: every package.json the scaffold
 * writes declares the whole stack, so none of it is ever extraneous there,
 * and a package only some projects use is left for those projects' own
 * installs to fetch.
 *
 * Here rather than in apps/preview, because this is the file that changes
 * when the stack does, and the test that fails should be the one run for
 * that change.
 */
const warm = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'apps',
      'preview',
      'warm',
      'package.json',
    ),
    'utf8',
  ),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("the preview image's installed stack", () => {
  it('is every stack package, at the range projects declare it', () => {
    const { dependencies, devDependencies } = stackDependencies();
    assert.deepEqual(warm.dependencies, dependencies);
    assert.deepEqual(warm.devDependencies, devDependencies);
  });

  it('leaves the optional packages to the projects that use them', () => {
    for (const name of Object.keys(OPTIONAL_PACKAGES)) {
      assert.equal(warm.dependencies?.[name], undefined, name);
    }
  });
});
