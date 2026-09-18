import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The two rules that decide whether the builder can be used at all.
 *
 * On a wide screen the page is bounded to the viewport and told not to
 * scroll, which is what lets the conversation scroll inside it. Anything
 * else in that bounded box which can grow has to be able to scroll too, or
 * its contents go off the bottom of a page that has already been told it may
 * not move: no scrollbar, no overflow, nothing to drag.
 *
 * That is not hypothetical. The composer was unbounded, and with the admin
 * panels on screen -- which is every admin, every session -- the model picker
 * and the controls under it were unreachable.
 *
 * Asserted against the stylesheet's own text because the thing that broke is
 * a stylesheet rule. A DOM test would need a layout engine to see it, and
 * the harness has none: jsdom reports every height as zero, so a test that
 * mounted the shell would pass against exactly this bug.
 */

const STYLES = join(
  fileURLToPath(new URL('../src/', import.meta.url)),
  'styles.css',
);

/**
 * The wide-screen block that bounds the page to the viewport.
 *
 * There is more than one `min-width: 68.01rem` block in this stylesheet, so
 * this finds the one that actually holds these rules rather than the first
 * that matches the breakpoint. Picking by position was the first cut, and it
 * read a block that has nothing to do with scrolling.
 */
async function viewportBlock(): Promise<string> {
  const css = await readFile(STYLES, 'utf8');
  const blocks: string[] = [];

  for (
    let start = css.indexOf('@media (min-width: 68.01rem)');
    start >= 0;
    start = css.indexOf('@media (min-width: 68.01rem)', start + 1)
  ) {
    // Balance braces from the media query's own opening one, so the block
    // ends where it really ends rather than at whichever `}` comes first.
    let depth = 0;
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(start, index + 1));
          break;
        }
      }
    }
  }

  const found = blocks.find((block) => block.includes('.conversation {'));
  assert.ok(found, 'the wide-screen scrolling layout is gone');
  return found;
}

/** The body of one rule inside a block, by selector. */
function ruleBody(block: string, selector: string): string {
  const at = block.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} has no rule in the wide-screen layout`);
  const open = block.indexOf('{', at);
  const close = block.indexOf('}', open);
  return block.slice(open + 1, close);
}

describe('the wide-screen builder layout', () => {
  it('bounds the page to the viewport', async () => {
    const block = await readFile(STYLES, 'utf8');
    assert.match(block, /height: 100vh/);
  });

  it('lets the conversation scroll', async () => {
    const conversation = ruleBody(await viewportBlock(), '.conversation');

    assert.match(conversation, /overflow-y:\s*auto/);
    // Without this a flex child refuses to shrink below its content, and the
    // scroller never engages.
    assert.match(conversation, /min-height:\s*0/);
  });

  it('lets the composer scroll, so the model picker is reachable', async () => {
    // The bug this file exists for. Everything below the fold of an
    // unbounded composer is unreachable inside a page that may not scroll.
    const composer = ruleBody(await viewportBlock(), '.composer');

    assert.match(composer, /overflow-y:\s*auto/);
    assert.match(composer, /min-height:\s*0/);
  });

  it('stops the composer squeezing the conversation to nothing', async () => {
    const composer = ruleBody(await viewportBlock(), '.composer');

    // A ceiling rather than a fixed height: the composer takes what it needs
    // while there is room, and the conversation keeps a usable minimum when
    // there is not.
    assert.match(composer, /max-height:\s*\d+%/);
  });

  it('lets the admin page scroll, so its lower tools are reachable', async () => {
    // The same rule, one page over (#184). These four tools are what grew
    // the composer past the fold in the first place; a page that dropped
    // the grid without taking a scroller would have moved the bug rather
    // than fixed it, and an expanded panel's fields would sit below a page
    // already told it may not move.
    //
    // Read from the whole stylesheet rather than the wide-screen block:
    // the rule is unconditional, because a scroller on an unbounded page
    // costs nothing and a rule that only exists above a breakpoint is one
    // more thing that has to keep being true.
    const css = await readFile(STYLES, 'utf8');
    const at = css.indexOf('.shell__body--page {');
    assert.ok(at >= 0, 'the admin page layout is gone');
    const page = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));

    assert.match(page, /overflow-y:\s*auto/);
    // Without this a flex child refuses to shrink below its content, and
    // the scroller never engages.
    assert.match(page, /min-height:\s*0/);
  });
});
