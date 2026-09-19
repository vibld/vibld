import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * That the sandbox says whether a generated project compiles (#194).
 *
 * Two of six real generations measured against the production provider
 * produced a project that fails `npm run build`, for two unrelated reasons.
 * The only gate on that was publish, which is the last of three exits: a
 * preview showed Vite's own transform error where a page should be, and an
 * export checked nothing at all.
 *
 * The preview is the cheapest place to find out, because the container is
 * already up and the install has already happened. That makes the check a
 * few seconds rather than a second sandbox, which is why it is here and not
 * in the generation path, where every option costs a container start.
 *
 * `preview-sandbox.ts` imports `@cloudflare/sandbox` and cannot be loaded
 * under `node --test`, so it is read as source. Same reasoning as
 * `apps/web/test/access-gate.test.ts`.
 */
const source = readFileSync(
  join(import.meta.dirname, '..', 'worker', 'preview-sandbox.ts'),
  'utf8',
);

describe('what a preview finds out about the project it is running', () => {
  /** The body of one method, from its signature to the next one's. */
  function bodyOf(signature: string, next: string): string {
    const at = source.indexOf(signature);
    assert.ok(at > 0, `${signature} is not where this expected it`);
    const end = source.indexOf(next, at);
    assert.ok(end > at, `${next} is not where this expected it`);
    return source.slice(at, end);
  }

  it('typechecks the installed project', () => {
    assert.match(
      source,
      /npm run typecheck --if-present/,
      'a project that does not compile starts a preview and says nothing about it',
    );
  });

  it('runs it on the path a preview actually takes', () => {
    // The method existing proves nothing: the first version of this test
    // asserted the command string and went on passing with the call site
    // removed. What has to be true is that provisioning calls it and
    // carries the answer onto the ready state.
    const provision = bodyOf(
      'private async provision(',
      'private async typecheck(',
    );
    assert.match(
      provision,
      /this\.typecheck\(\)/,
      'the typecheck is defined and never run',
    );
    assert.match(
      provision,
      /typecheckFailure \? \{ typecheckFailure \} : \{\}/,
      'the answer is found and then dropped before anyone sees it',
    );
  });

  it('asks only for a script the project declares', () => {
    // The prompt requires a "typecheck" script and a real run wrote one,
    // but a project without it must start a preview rather than fail one.
    // `--if-present` is what makes a missing script exit zero.
    assert.doesNotMatch(
      source,
      /exec\('npm run typecheck'/,
      'a project with no typecheck script would be reported as failing one',
    );
  });

  it('bounds how long it may take', () => {
    // #195 review. The prompt requires a "typecheck" script to exist and
    // cannot require it to exit, so a manifest declaring `tsc --watch
    // --noEmit` would never return: the preview would sit in `starting`
    // until its hard lifetime reclaimed it, holding one of the
    // twenty-five account-wide fleet slots for a diagnostic nobody asked
    // for. A diagnostic that can stop a preview is worse than none.
    const method = bodyOf(
      'private async typecheck(',
      'private async writeProject(',
    );
    assert.match(
      method,
      /timeout: TYPECHECK_TIMEOUT_MS/,
      'the typecheck runs unbounded, so a --watch script holds a fleet slot until the hard lifetime',
    );
  });

  it('does not report being stopped as something the project did', () => {
    // A run that reached the bound was stopped, and being stopped is not
    // evidence about the code. Asserted separately from the bound itself
    // because the two fail independently: the timeout could be set and the
    // result still read as a finding.
    const method = bodyOf(
      'private async typecheck(',
      'private async writeProject(',
    );
    assert.match(
      method,
      /Date\.now\(\) - startedAt >= TYPECHECK_TIMEOUT_MS\) return undefined/,
      'a typecheck that was cut off would be shown to the reader as a failure of theirs',
    );
  });

  it('never lets the typecheck fail the preview', () => {
    // The dev server starts either way and Vite does not typecheck, so the
    // preview really does run. This is a finding about the project, which
    // is the user's to edit, and turning it into a failure would take away
    // a working sandbox over something the reader can fix in place.
    const method = bodyOf(
      'private async typecheck(',
      'private async writeProject(',
    );
    assert.match(method, /catch \{\s*return undefined;/);
    assert.doesNotMatch(method, /throw/);
  });

  it('reads the stream tsc actually writes to', () => {
    // `tsc` writes its diagnostics to stdout. stderr on this path carries
    // npm's own wrapper, so a report built from stderr alone told somebody
    // whose publish was blocked by a type error that npm had exited 2, and
    // nothing else. Both paths that report a failed compile read both.
    for (const method of ['typecheck(', 'buildProject(']) {
      const at = source.indexOf(`async ${method}`);
      assert.ok(at > 0, `${method} is not where this expected it`);
      assert.match(
        source.slice(at, at + 3_000),
        /\.stdout,\s*\w+\.stderr\]/,
        `${method} reports one stream, and not the one tsc writes to`,
      );
    }
  });
});
