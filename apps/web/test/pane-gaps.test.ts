import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  PANE_GAPS,
  PREVIEW_SENTENCE,
  footerNote,
  noteFor,
} from '../src/generation/pane-gaps.ts';

/**
 * The rules that stop a corrected limitation from being corrected in one
 * place only.
 *
 * This has been wrong three times in a row, and each time the code was
 * right and the copy was not, which no test in this suite was looking at.
 * Two of these rules are about the source text rather than the rendered
 * output on purpose: what went wrong was somebody (me) writing the same
 * claim a second time somewhere else, and only a rule that reads the
 * sources can see that happen.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

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

describe('the gaps between the builder panes and the sandbox', () => {
  it('states every pane gap in the footer as well', () => {
    const footer = footerNote();
    assert.ok(footer.startsWith(PREVIEW_SENTENCE));
    for (const [pane, gap] of Object.entries(PANE_GAPS)) {
      assert.ok(
        footer.includes(gap.footerSentence),
        `the footer does not state the ${pane} gap`,
      );
    }
  });

  it('names each pane in the sentence that stands in for it', () => {
    // The footer is read by somebody who never opened the pane, so it has to
    // say which pane it is talking about, not just what is missing.
    assert.match(footerNote(), /console/);
    assert.match(footerNote(), /Problems/);
  });

  it('gives each pane the note that pane is meant to render', () => {
    assert.equal(noteFor('console'), PANE_GAPS.console.note);
    assert.equal(noteFor('problems'), PANE_GAPS.problems.note);
    assert.notEqual(noteFor('console'), noteFor('problems'));
  });

  it('leaves no second copy of the claim in the browser sources', async () => {
    const sources = await browserSources(SRC);
    assert.ok(sources.length > 5, 'the walk must actually find the sources');

    const owner = join(SRC, 'generation', 'pane-gaps.ts');
    for (const path of sources) {
      if (path === owner) continue;
      const text = await readFile(path, 'utf8');
      assert.equal(
        text.includes('Sandbox execution exists'),
        false,
        `${path} writes out a sandbox limitation of its own. Add it to generation/pane-gaps.ts and render it from there, or the next correction will fix one copy and leave the other.`,
      );
    }
  });

  it('builds the footer from the list rather than restating it', async () => {
    const app = await readFile(join(SRC, 'App.tsx'), 'utf8');
    assert.match(app, /\{footerNote\(\)\}/);
  });
});
