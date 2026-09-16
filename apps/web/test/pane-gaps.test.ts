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

  it('leaves no second copy of any recorded wording in the browser sources', async () => {
    // The first cut of this matched one exact phrase, `Sandbox execution
    // exists`, and claimed to enforce that pane-gaps.ts is the only source of
    // these limitations. It did not: restating a gap in the footer's own
    // words, or any paraphrase, walked straight past it. Codex found that
    // after the PR had merged.
    //
    // The phrases now come from the record itself, so every sentence this
    // module publishes is one no other file may contain. A copy is the drift
    // that has happened three times; someone writing a fresh paraphrase from
    // scratch is not something a string search can see, and the heuristic
    // below is the nearest thing to a catch for it.
    const sources = await browserSources(SRC);
    assert.ok(sources.length > 5, 'the walk must actually find the sources');

    const recorded = [
      ...Object.values(PANE_GAPS).flatMap((gap) => [
        gap.note,
        gap.footerSentence,
      ]),
      PREVIEW_SENTENCE,
    ];
    assert.ok(recorded.length >= 5, 'nothing recorded to check against');

    const owner = join(SRC, 'generation', 'pane-gaps.ts');
    const offenders: string[] = [];
    for (const path of sources) {
      if (path === owner) continue;
      const text = await readFile(path, 'utf8');
      for (const phrase of recorded) {
        if (text.includes(phrase)) offenders.push(`${path}: "${phrase}"`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'a file other than pane-gaps.ts writes out a sandbox limitation of its own. Render it from the record instead, or the next correction will fix one copy and leave the other.',
    );
  });

  it("catches a limitation written in somebody else's own words", async () => {
    // Weaker than the rule above and deliberately kept separate: it cannot
    // know what a paraphrase looks like, so it looks for the shape these
    // sentences have taken every time. A line that says the sandbox does not
    // reach something is the thing being centralised, whatever its wording.
    const sources = await browserSources(SRC);
    const owner = join(SRC, 'generation', 'pane-gaps.ts');
    const offenders: string[] = [];

    for (const path of sources) {
      if (path === owner) continue;
      const text = await readFile(path, 'utf8');
      for (const [index, line] of text.split('\n').entries()) {
        const lower = line.toLowerCase();
        if (!lower.includes('sandbox')) continue;
        // "not ... yet", "not piped", "not reported", "does not" -- the way a
        // gap gets written when somebody is describing one.
        if (!/\b(not|no)\b/.test(lower)) continue;
        if (/\byet\b|piped|reported|shows|output/.test(lower)) {
          offenders.push(`${path}:${index + 1}: ${line.trim()}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('builds the footer from the list rather than restating it', async () => {
    const app = await readFile(join(SRC, 'App.tsx'), 'utf8');
    assert.match(app, /\{footerNote\(\)\}/);
  });
});
