import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Spend the reader is spared, which the deployment still paid (#191 review).
 *
 * The mockup route absorbs one discarded empty reply on the reader's
 * behalf. The first version of that let the money disappear: settlement saw
 * only the second attempt, so the account-wide daily ceiling never learned
 * the first had happened, and one admitted request could send two full
 * requests against a reservation for one.
 *
 * Source-reading, and weaker than a behavioural test, for the reason
 * `client-gone.test.ts` and `access-gate.test.ts` already give: this route
 * lives in `worker/index.ts`, which imports `cloudflare:workers` and cannot
 * be loaded here. What it pins is the wiring, which is exactly what was
 * missing: the pieces all existed and nothing connected them.
 */
function workerSource(): string {
  return join(
    fileURLToPath(new URL('../worker/', import.meta.url)),
    'index.ts',
  );
}

describe('accounting for an attempt nobody was billed for', () => {
  it('reports the discarded attempt at all', async () => {
    // The `MockupProvider` construction supplied no `onDiscarded`, so the
    // one callback that exists to make absorbed spend visible was never
    // passed by the only caller that absorbs any.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /onDiscarded: async \(spent\) => \{/,
      'the mockup route absorbs a discarded attempt without being told of it',
    );
  });

  it('prices it before deciding anything else about it', async () => {
    // Recorded first because it has already happened: whatever is decided
    // about the retry, that money is gone.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /onDiscarded: async \(spent\) => \{\s*absorbedMicroUsd \+= microUsdOf\(spent, prices\);/,
      'the absorbed attempt is not priced, or not priced first',
    );
  });

  it('asks the account ceiling before sending the second attempt', async () => {
    // The half that bounds what is in flight rather than what is recorded.
    // Returning false stops the retry, and the run then fails on the empty
    // reply it already had.
    const source = await readFile(workerSource(), 'utf8');
    const hook = source.indexOf('onDiscarded: async (spent) => {');
    assert.ok(hook > -1, 'nothing decides whether the retry may be sent');
    const block = source.slice(hook, source.indexOf('},', hook));
    assert.match(
      block,
      /retryHold = await reserveAccount\(env, worstCase, Date\.now\(\)\)/,
      'the retry is sent without holding anything against the daily ceiling',
    );
    assert.match(
      block,
      /return retryHold\.verdict\.allow/,
      'the ceiling is asked and its answer is discarded',
    );
  });

  it('refuses the retry when the ledger cannot be reached', async () => {
    // This path exists to bound spend, and "the ceiling could not be read"
    // is not a reason to spend again.
    const source = await readFile(workerSource(), 'utf8');
    const hook = source.indexOf('onDiscarded: async (spent) => {');
    const block = source.slice(hook, source.indexOf('},', hook));
    assert.match(
      block,
      /catch \(error\) \{[\s\S]*return false;/,
      'a ledger that throws lets the retry through',
    );
  });

  it('carries the figure into settlement', async () => {
    // Where the account layer and the caller's allowance are allowed to
    // differ, and the only place they are.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /settleBudget\(\s*env\.USER_BUDGET!,\s*settleParams,\s*settled,\s*providerRan,\s*absorbedMicroUsd,\s*\)/,
      'the mockup settlement drops the absorbed spend on the floor',
    );
  });

  it('closes the retry hold rather than leaving it to the reclaim', async () => {
    // An unsettled reservation is closed at its full worst case fifteen
    // minutes later, which would charge the day for a second whole run.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /if \(retryHold\?\.id !== undefined\) \{[\s\S]*?\.settle\(retryHold\.id, 0\)/,
      'the retry hold is left open, and the reclaim will charge it in full',
    );
  });

  it('keeps one spelling of the account reservation', async () => {
    // Two spellings of a ceiling is a ceiling that can be enforced two
    // ways, which is the shape of three findings on this pull request.
    const source = await readFile(workerSource(), 'utf8');
    assert.equal(
      source.match(/\.reserve\(\s*worstCase,\s*accountCeiling,/g)?.length,
      1,
      'the account ceiling is reserved somewhere other than reserveAccount',
    );
    assert.equal(
      source.match(/reserveAccount\(/g)?.length,
      3,
      'expected the helper, the admission path, and the retry hold',
    );
  });
});
