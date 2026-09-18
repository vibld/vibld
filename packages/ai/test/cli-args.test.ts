import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMockupArgs, parsePlanArgs } from '../src/cli-args.ts';

describe('parsePlanArgs', () => {
  it('takes an unquoted prompt as the words before any flag', () => {
    assert.deepEqual(parsePlanArgs(['a', 'landing', 'page']), {
      prompt: 'a landing page',
    });
  });

  it('reads both flags whichever order they come in', () => {
    // A --base swallowed into the prompt would quietly run a fresh
    // generation while reporting an iteration -- and bill for it.
    const expected = { prompt: 'add a footer', out: 'o', base: 'b' };
    assert.deepEqual(
      parsePlanArgs(['add', 'a', 'footer', '--base', 'b', '--out', 'o']),
      expected,
    );
    assert.deepEqual(
      parsePlanArgs(['add', 'a', 'footer', '--out', 'o', '--base', 'b']),
      expected,
    );
  });

  it('omits a flag that was not given, rather than setting it undefined', () => {
    const args = parsePlanArgs(['x', '--out', 'o']);
    assert.equal('base' in args, false);
    assert.equal(args.out, 'o');
  });

  it('reports an empty prompt when there is only a flag', () => {
    assert.equal(parsePlanArgs(['--base', 'b']).prompt, '');
    assert.equal(parsePlanArgs([]).prompt, '');
  });

  it('does not let a flag value leak into the prompt', () => {
    assert.equal(
      parsePlanArgs(['make', 'it', 'dark', '--base', './generated']).prompt,
      'make it dark',
    );
  });
});

describe('parseMockupArgs', () => {
  it('reads a style and an output directory in either order', () => {
    const expected = { prompt: 'a bakery', out: 'o', style: 'quiet-editorial' };
    assert.deepEqual(
      parseMockupArgs([
        'a',
        'bakery',
        '--style',
        'quiet-editorial',
        '--out',
        'o',
      ]),
      expected,
    );
    assert.deepEqual(
      parseMockupArgs([
        'a',
        'bakery',
        '--out',
        'o',
        '--style',
        'quiet-editorial',
      ]),
      expected,
    );
  });

  it('does not let a style value leak into the prompt', () => {
    // The prompt is what the model is paid to answer. A preset id carried
    // into it asks for a bakery called "--style".
    assert.equal(
      parseMockupArgs(['a', 'bakery', '--style', 'bold-poster']).prompt,
      'a bakery',
    );
  });

  it('omits a flag that was not given', () => {
    const args = parseMockupArgs(['a bakery']);
    assert.equal('style' in args, false);
    assert.equal('out' in args, false);
  });

  it('does not read the flags that belong to the plan CLI', () => {
    // --base means something to a build and nothing to a look, so it stays
    // part of the prompt here rather than being silently accepted.
    assert.equal(
      parseMockupArgs(['a', 'bakery', '--base', './generated']).prompt,
      'a bakery --base ./generated',
    );
  });
});
