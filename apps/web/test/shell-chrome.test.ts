import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Where the builder's chrome puts things, and whether the documentation
 * still agrees.
 *
 * The header used to carry the brand, a sentence describing the deployment,
 * a billing readout with three buttons, the whole GitHub connection panel
 * and the account button, all competing for one row. #170 moved every piece
 * of configuration behind the gear, and three documentation pages went on
 * telling readers to look in the header for a readout that is no longer
 * there. Every check in the repository stayed green, because nothing
 * compared the two.
 *
 * So this is two rules, and the second is the one that was missing. The
 * configuration lives behind the gear, and the marketing docs do not send
 * anybody to the header to find it. Same shape as `shell-brand.test.ts`,
 * which reaches into apps/marketing for the same reason: the two halves of
 * this product are read side by side, and the worst place for them to
 * disagree is where a person can see both.
 */

const APP = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const DOCS = fileURLToPath(
  new URL('../../marketing/app/routes/', import.meta.url),
);

/** The pieces #170 moved. Each one was in the header and is not any more. */
const BEHIND_THE_GEAR = [
  'BillingStatusWidget',
  'GitHubPanel',
  'describeMode',
] as const;

async function app(): Promise<string> {
  return readFile(APP, 'utf8');
}

/** The `<SettingsMenu>...</SettingsMenu>` block, which is where they live. */
function settingsMenu(source: string): string {
  const from = source.indexOf('<SettingsMenu>');
  assert.notEqual(from, -1, 'the settings menu is gone; this test is stale');
  const to = source.indexOf('</SettingsMenu>', from);
  assert.notEqual(to, -1, 'the settings menu never closes');
  return source.slice(from, to);
}

describe("the builder's chrome", () => {
  it('keeps every piece of configuration behind the gear', async () => {
    const source = await app();
    const menu = settingsMenu(source);
    for (const piece of BEHIND_THE_GEAR) {
      assert.match(
        menu,
        new RegExp(`\\b${piece}\\b`),
        `${piece} is no longer inside the settings menu`,
      );
      // Once each, so a second copy left behind in the header cannot hide
      // behind the one that moved.
      const uses = source.match(new RegExp(`<${piece}\\b|\\b${piece}\\(`, 'g'));
      assert.equal(
        uses?.length,
        1,
        `${piece} is rendered ${uses?.length ?? 0} times, not once`,
      );
    }
  });

  it('leaves the header carrying only the brand and the controls', async () => {
    const source = await app();
    const from = source.indexOf('<header');
    assert.notEqual(from, -1, 'the shell has no header');
    const header = source.slice(from, source.indexOf('</header>', from));
    // The controls row is inside the header, so anything it holds is found
    // here too. Cutting it out leaves what the header carries in its own
    // right, which should be the brand and nothing else.
    const controls = header.indexOf('shell__controls');
    const brand = controls === -1 ? header : header.slice(0, controls);
    for (const piece of BEHIND_THE_GEAR) {
      assert.doesNotMatch(
        brand,
        new RegExp(`\\b${piece}\\b`),
        `${piece} is back in the header`,
      );
    }
  });
});

/**
 * Words that name something now behind the gear. A documentation paragraph
 * may talk about the header, and several rightly do; it may not place one of
 * these in it.
 */
const MOVED =
  /Manage billing|your allowance|spend against|GitHub connection|provider and model|model served/;

describe('what the documentation says the header carries', () => {
  it('sends nobody to the header for something behind the gear', async () => {
    const offenders: string[] = [];
    const files = (await readdir(DOCS)).filter((name) => name.endsWith('.tsx'));

    for (const name of files) {
      const text = await readFile(join(DOCS, name), 'utf8');
      // Paragraph by paragraph: a page that describes the header in one
      // breath and the gear in the next is correct, and a rule over whole
      // files could not tell that from the mistake.
      for (const paragraph of text.split('</p>')) {
        if (!/\bheader\b/i.test(paragraph)) continue;
        const moved = MOVED.exec(paragraph);
        if (moved) {
          offenders.push(`${name}: "${moved[0]}" placed in the header`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });
});
