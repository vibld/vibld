import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { usablePublishableKey } from '../src/auth/publishable-key.ts';

/**
 * What counts as a Clerk publishable key.
 *
 * The bug this exists for is specific: `Boolean(key)` called a key of one
 * space configured, so `ClerkProvider` was handed a space instead of taking
 * the unconfigured fallback that renders without Clerk on purpose. A
 * provider that cannot mint a session is worse than no provider, because
 * every `/api/*` request on this deployment needs the token it cannot make.
 */
describe('usablePublishableKey', () => {
  it('refuses anything that is not a key', () => {
    for (const raw of [
      undefined,
      null,
      42,
      '',
      ' ',
      '\t',
      '\n',
      '   \n  ',
      // Whitespace inside is not a key that was typed correctly, and cannot
      // authenticate anybody.
      'pk live key',
      'pk_test_a b',
    ]) {
      assert.equal(
        usablePublishableKey(raw),
        null,
        `${JSON.stringify(raw)} was taken for a key`,
      );
    }
  });

  it('takes a key that only needs trimming', () => {
    // The other direction matters as much. Refusing a deploy over a stray
    // newline in a secret field is the same outage from the other side.
    assert.equal(usablePublishableKey('  pk_live_abc  '), 'pk_live_abc');
    assert.equal(usablePublishableKey('pk_test_abc\n'), 'pk_test_abc');
    assert.equal(usablePublishableKey('pk_live_abc'), 'pk_live_abc');
  });

  it('does not judge the prefix', () => {
    // Deliberate. The failure guarded against is a key that is not a key;
    // refusing a valid one because Clerk changed a prefix would be this
    // codebase's third instance of a check stricter than the thing it
    // checks.
    assert.equal(
      usablePublishableKey('whatever_clerk_ships_next'),
      'whatever_clerk_ships_next',
    );
  });

  it('is what the shell asks, so the deploy and the browser agree', async () => {
    // The deploy preflight imports this. If the shell goes back to its own
    // truthiness test, a deployment can pass the check and still hand
    // `ClerkProvider` something it cannot use.
    const source = await readFile(
      fileURLToPath(new URL('../src/auth/clerk-token.ts', import.meta.url)),
      'utf8',
    );
    assert.match(source, /usablePublishableKey\(/);
    assert.doesNotMatch(
      source,
      /Boolean\(PUBLISHABLE_KEY\)/,
      'the shell decides for itself again',
    );
  });
});
