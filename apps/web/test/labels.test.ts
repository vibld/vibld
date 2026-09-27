import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeMode } from '../src/generation/labels.ts';

describe('describeMode', () => {
  it('claims nothing about the provider before a run has used one', () => {
    const label = describeMode(null);
    assert.equal(/fake/i.test(label), false);
    assert.equal(/credential/i.test(label), false);
  });

  it('says so plainly when the deterministic fake served the run', () => {
    // Presenting the fake's output as a real result would be worse than an
    // error, so the shell has to name it.
    assert.match(describeMode('fake'), /Deterministic fake/);
  });

  it('names the model provider that actually served the run', () => {
    const label = describeMode('anthropic:claude-opus-5');
    assert.match(label, /anthropic:claude-opus-5/);
    assert.equal(
      /fake|no model credentials/i.test(label),
      false,
      'the stale claim must not survive a real generation',
    );
  });
});
