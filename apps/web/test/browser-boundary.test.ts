import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * ADR-0006: no provider SDK in the browser bundle.
 *
 * This is not theoretical. Importing a style preset from the `@vibld/ai`
 * barrel -- which re-exports the Anthropic client -- pulled the whole SDK
 * into the browser build and doubled it, from 225 kB to 488 kB, in a change
 * that had nothing to do with model calls. Nothing about that was visible in
 * the diff; it showed up only because the build output was read.
 *
 * The barrel is therefore off limits to browser code. Deep imports of the
 * modules that carry no SDK (`@vibld/ai/style-presets`) are fine.
 */
async function browserSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await browserSources(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe('the browser bundle boundary', () => {
  it('never imports a provider SDK, directly or through a barrel', async () => {
    const sources = await browserSources(
      new URL('../src', import.meta.url).pathname,
    );
    assert.ok(sources.length > 5, 'the walk must actually find the sources');

    for (const path of sources) {
      const text = await readFile(path, 'utf8');
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map(
        (match) => match[1]!,
      );
      for (const specifier of imports) {
        assert.notEqual(
          specifier,
          '@vibld/ai',
          `${path} imports the @vibld/ai barrel, which carries the Anthropic SDK into the browser bundle. Use a deep import such as @vibld/ai/style-presets.`,
        );
        assert.equal(
          specifier.startsWith('@anthropic-ai/'),
          false,
          `${path} imports a provider SDK`,
        );
        assert.notEqual(
          specifier,
          'stripe',
          `${path} imports the Stripe SDK, which carries the secret key into the browser bundle -- Stripe billing (worker/stripe-client.ts) is Worker-only.`,
        );
      }
    }
  });
});
