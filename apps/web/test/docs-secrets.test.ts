import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Keep the README's claims about `CLERK_SECRET_KEY` answerable from the code.
 *
 * This is a drift check, not a style one. The README said the secret was
 * "currently unused by any Worker code" and that only the two credit routes
 * turned an email into a Clerk user id. Both were true when written and both
 * stopped being true when inviting started asking Clerk to approve an
 * address. Nothing failed: a deployer reading either sentence would omit the
 * key, every invite would be recorded locally, and nobody would be able to
 * sign in, which is the failure a docs statement is least able to announce.
 *
 * So the pair is asserted rather than the prose. If any Worker module reads
 * `env.CLERK_SECRET_KEY`, the README must not say the key is unused, and must
 * name the invite route as one of the things that wants it. Neither half can
 * be satisfied by leaving the other alone.
 */

const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));
const README = fileURLToPath(new URL('../README.md', import.meta.url));

/** Every worker module that reads the secret out of its env. */
async function readersOfTheSecret(): Promise<string[]> {
  const names = (await readdir(WORKER)).filter((name) => name.endsWith('.ts'));
  const readers: string[] = [];
  for (const name of names) {
    const source = await readFile(join(WORKER, name), 'utf8');
    if (/env\.CLERK_SECRET_KEY/.test(source)) readers.push(name);
  }
  return readers;
}

describe('what the README says CLERK_SECRET_KEY is for', () => {
  it('does not call the secret unused while Worker code reads it', async () => {
    const readers = await readersOfTheSecret();
    assert.ok(
      readers.length > 0,
      'nothing reads the secret, so this test is asserting about a key that no longer exists',
    );

    const readme = await readFile(README, 'utf8');
    assert.doesNotMatch(
      readme,
      /CLERK_SECRET_KEY` is currently unused/,
      `the README calls the secret unused, and ${readers.join(', ')} read it`,
    );
  });

  it('tells a deployer that inviting wants the key too', async () => {
    // The specific omission that costs somebody their sign-in. A deployer who
    // reads only "the credit routes use it" concludes a deployment with no
    // credit tool does not need it, which is exactly the deployment where
    // every invite is then half an action.
    const readers = await readersOfTheSecret();
    assert.ok(
      readers.includes('clerk-waitlist.ts'),
      'the invite route stopped asking Clerk, so this test is about a path that no longer exists',
    );

    const readme = await readFile(README, 'utf8');
    assert.match(readme, /\/api\/admin\/invite` uses it to ask Clerk/);
  });
});
