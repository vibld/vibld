import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlanArgs } from '../src/cli-args.ts';

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
