import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildSandboxName } from '../worker/build-sandbox.ts';

/**
 * That a build does not run in the sandbox the user's preview is running in
 * (#196 review).
 *
 * The old arrangement shared one instance per user and refused a build as
 * `busy` whenever a preview was live. That was correct about the filesystem
 * race and wrong about how often it happens: `Workspace` owns the preview
 * so it survives a tab switch, and `BuilderSession.submit` does not stop it,
 * so the ordinary follow-up edit met a live preview. `worthRepairing` reads
 * `busy` as "nothing to do with the project", quite rightly, so #194's
 * verification quietly did nothing for exactly the readers who were
 * iterating hardest -- and it never failed, which is why nothing said so.
 */
describe('where a build runs', () => {
  it('does not run where the preview runs', () => {
    assert.notEqual(buildSandboxName('user_abc'), 'user_abc');
  });

  it('cannot be confused with another user sandbox', () => {
    // Prefixed rather than suffixed, and that is the whole argument: a
    // suffix would have to be trusted to survive `normalizeId`, and a name
    // like `user_abcbuild` is one a user id could in principle be. Every
    // name here begins with `build`, and a Clerk user id begins with
    // `user_`, so no rewriting of the rest can make the two meet.
    assert.ok(buildSandboxName('user_abc').startsWith('build'));
    assert.notEqual(buildSandboxName('user_a'), buildSandboxName('user_ab'));
  });

  it('is what the build route actually asks for', () => {
    // `index.ts` imports `@cloudflare/sandbox` and cannot be loaded under
    // `node --test`, and this is the line that carries the fix: the helper
    // above can be perfectly correct while the route still names the
    // preview's own instance, and every test here would still pass.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'worker', 'index.ts'),
      'utf8',
    );
    const at = source.indexOf('async function handleBuild(');
    assert.ok(at > 0, 'handleBuild is not where this expected it');
    const body = source.slice(
      at,
      source.indexOf('\nfunction shareUrlFor(', at),
    );
    assert.match(
      body,
      /getSandbox\(env\.Sandbox, buildSandboxName\(userId\)/,
      'the build route names the preview sandbox, so a live preview blocks it',
    );
  });
});
