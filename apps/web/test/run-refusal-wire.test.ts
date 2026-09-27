import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RUN_REFUSALS, isRunRefusal } from '@vibld/core';

const read = (path: string) =>
  readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const SOURCES = [
  '../worker/index.ts',
  '../worker/principal.ts',
  '../worker/access-handlers.ts',
];

/**
 * Every identifier these files declare as a refusal.
 *
 * Two extractions rather than one, because they answer different questions.
 * `reason:` literals are what lands in a response body, so every one of them
 * has to be in the vocabulary. `refuse(...)` arguments are matched loosely,
 * across the whole call including a ternary's two branches, because the test
 * should find an identifier wherever the code puts it rather than dictating
 * how the call is written. The first version matched only a literal first
 * argument and missed the one call that picks between two.
 */
async function wireReasons(): Promise<{ stated: string[]; used: Set<string> }> {
  const sources = await Promise.all(SOURCES.map(read));
  const stated: string[] = [];
  const used = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/reason: '([a-z-]+)'/g)) {
      stated.push(match[1]!);
      used.add(match[1]!);
    }
    for (const call of source.matchAll(/refuse\(([\s\S]{0,200}?)\)/g)) {
      for (const literal of call[1]!.matchAll(/'([a-z]+(?:-[a-z]+)*)'/g)) {
        if (isRunRefusal(literal[1]!)) used.add(literal[1]!);
      }
    }
  }
  return { stated, used };
}

describe('the refusal identifiers this Worker answers with', () => {
  it('are all in the shared vocabulary', async () => {
    // The point of a stable identifier is that a caller can match on it. One
    // spelled only here is a value nothing else in the system knows, which
    // is the drift this vocabulary exists to stop.
    const { stated } = await wireReasons();
    assert.ok(stated.length > 0, 'no refusal reasons reach the wire at all');
    for (const reason of new Set(stated)) {
      assert.ok(isRunRefusal(reason), `"${reason}" is not a RunRefusal`);
    }
  });

  it('tell a spent allowance apart from a run already going', async () => {
    const { used } = await wireReasons();
    assert.ok(used.has('account-ceiling'), 'no account-ceiling refusal');
    assert.ok(used.has('already-running'), 'no already-running refusal');
  });

  it('tell an unreadable ledger apart from a spent one', async () => {
    const { used } = await wireReasons();
    assert.ok(used.has('accounting-unavailable'));
  });

  it('never put the invite list on the wire', async () => {
    // `access.ts` separates not-invited from unverified-identity internally
    // and `handleAccessStatus` refuses to report which, so that nobody can
    // test whether an address has been invited. A machine-readable reason
    // that split them would defeat that more completely than prose would,
    // because it would be reliable.
    const { used } = await wireReasons();
    assert.ok(!used.has('not-invited'), 'the wire names the invite list');
    assert.ok(
      !used.has('unverified-identity'),
      'the wire names why access was refused',
    );
    assert.ok(used.has('access-refused'), 'no access refusal reason at all');
    assert.ok(
      !(RUN_REFUSALS as readonly string[]).includes('not-invited'),
      'the vocabulary itself offers the disclosure',
    );
  });

  it('answer one reason for every way identity can be missing', async () => {
    // A missing token and a token that failed verification are different
    // internally and deliberately the same to a caller. Two reasons here
    // would tell an attacker which half of the problem to work on.
    const source = await read('../worker/principal.ts');
    const reasons = [...source.matchAll(/reason: '([a-z-]+)'/g)].map(
      (match) => match[1],
    );
    const identity = reasons.filter((reason) => reason !== 'not-configured');
    assert.ok(identity.length >= 2, 'expected both identity paths to answer');
    assert.equal(
      new Set(identity).size,
      1,
      'the two identity failures answer with different reasons',
    );
  });
});
