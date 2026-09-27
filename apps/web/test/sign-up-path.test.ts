import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SIGN_UP_PATH, isSignUpPath } from '../src/auth/clerk-token.ts';

/**
 * The sign-up form's own address (open beta, 2026-09-27).
 *
 * vibld.com's "Sign up" links to `https://app.vibld.com/sign-up`
 * (`SITE.signUpUrl` in apps/marketing), so this path is a public promise: if
 * it stops showing the sign-up form, every sign-up call to action on the
 * site lands on a sign-in form instead.
 */
describe('the sign-up path', () => {
  it('is the path vibld.com links to', async () => {
    assert.equal(SIGN_UP_PATH, '/sign-up');
    const site = await readFile(
      join(import.meta.dirname, '..', '..', 'marketing', 'app', 'site.ts'),
      'utf8',
    );
    assert.match(site, /signUpUrl: `\$\{APP_URL\}\/sign-up`/);
  });

  it('covers the form and its own steps, and nothing else', () => {
    assert.equal(isSignUpPath('/sign-up'), true);
    assert.equal(isSignUpPath('/sign-up/verify-email-address'), true);
    assert.equal(isSignUpPath('/'), false);
    assert.equal(isSignUpPath('/sign-upx'), false);
    assert.equal(isSignUpPath('/admin'), false);
  });

  it('is what the signed-out shell switches on, and what Clerk links to', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'src', 'auth', 'clerk.tsx'),
      'utf8',
    );
    assert.match(source, /signUpUrl=\{SIGN_UP_PATH\}/);
    assert.match(source, /isSignUpPath\(usePathname\(\)\)/);
    assert.match(source, /<SignUp /);
  });
});
