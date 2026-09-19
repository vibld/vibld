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
      /onDiscarded: async \(spent\) => \{\s*absorbedMicroUsd =\s*\(absorbedMicroUsd \?\? 0\) \+ microUsdOf\(spent, prices\);/,
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

  it('reconciles the finished attempt before holding for the next', async () => {
    // An unsettled reservation counts at its worst case, so asking for a
    // second hold beside the first makes the day see two whole worst
    // cases for a run that will spend one and a bit (#191 review). That
    // refuses retries the budget could actually cover, which fails a
    // reader for a provider defect while their deployment had room.
    //
    // The order is the whole fix: settle, then reserve.
    const source = await readFile(workerSource(), 'utf8');
    const hook = source.indexOf('onDiscarded: async (spent) => {');
    assert.ok(hook > -1, 'the absorbed attempt is not reported at all');
    const block = source.slice(hook, source.indexOf('},', hook));
    const settled = block.indexOf(
      '.settle(settleParams.accountReservationId, absorbedMicroUsd)',
    );
    const reserved = block.indexOf('reserveAccount(env, worstCase');
    assert.ok(
      settled > -1,
      'the finished attempt is left at its worst case while the retry asks for another',
    );
    assert.ok(
      reserved > settled,
      'the retry hold is taken before the attempt it follows is reconciled',
    );
    // And inside the try, because a reconciliation that throws is the
    // same fact as a ceiling that cannot be read: the ledger did not
    // answer, so the retry is refused rather than allowed to escape as
    // an exception that never sets the flag settlement reads.
    assert.match(
      block,
      /try \{[\s\S]*?\.settle\(settleParams\.accountReservationId, absorbedMicroUsd\)[\s\S]*?\} catch/,
      'the reconciliation sits outside the try, so a ledger failure skips the refusal',
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

  it('records that the retry was refused, not merely that it did not run', async () => {
    // Without the flag, settlement cannot tell a refused retry from any
    // other run that reported no usage, and `settleBudget` charges the
    // full worst case for those (#191 review).
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /retryRefused = !retryHold\.verdict\.allow;/,
      'a denied hold is not recorded, so settlement cannot see it',
    );
    assert.match(
      source,
      /console\.error\('mockup retry hold failed', error\);\s*retryRefused = true;/,
      'a ledger that threw refuses the retry without saying so to settlement',
    );
  });

  it('settles a refused retry at nothing, ahead of the cancelled case', async () => {
    // Two things at once, and the order is the substance. The reader owes
    // nothing: the run was one attempt and that attempt was absorbed.
    // And the check has to come before the cancelled branch, because a
    // refused retry never reaches the progress reset, so the streamed
    // counts still belong to the absorbed attempt and settling from them
    // would bill it by the other door.
    const source = await readFile(workerSource(), 'utf8');
    const refused = source.indexOf('? NOTHING_TO_BILL');
    const cancelledBranch = source.indexOf(
      ': cancelled && providerRan',
      refused === -1 ? 0 : refused,
    );
    assert.ok(refused > -1, 'a refused retry is not settled at nothing');
    assert.ok(
      cancelledBranch > refused,
      'the cancelled case is reached first, and it prices the absorbed attempt',
    );
  });

  it('carries the figure into settlement', async () => {
    // Where the account layer and the caller's allowance are allowed to
    // differ, and the only place they are.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /settleBudget\([\s\S]*?\n\s*absorbedMicroUsd,\s*\);/,
      'the mockup settlement drops the absorbed spend on the floor',
    );
  });

  it('keeps an attempt that priced at nothing distinguishable from none', async () => {
    // The falsy trap `settleBudget` was taught to avoid, moved to its
    // call site (#191 review). A discarded attempt that prices to zero is
    // not the same fact as no discarded attempt: the first says this
    // reservation covered an attempt that cost nothing, the second says
    // it covered the run the reader is charged for. Collapsing them
    // charges the retry to both reservations.
    //
    // Kept unrepresentable rather than merely avoided: the variable is
    // undefined until an attempt is absorbed, so presence and price
    // cannot part company.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /let absorbedMicroUsd: number \| undefined;/,
      'a zero-priced discarded attempt is indistinguishable from none',
    );
    assert.doesNotMatch(
      source,
      /absorbedMicroUsd > 0/,
      'a truthiness test on the absorbed figure is back',
    );
    assert.match(
      source,
      /absorbedMicroUsd =\s*\(absorbedMicroUsd \?\? 0\) \+ microUsdOf\(spent, prices\);/,
      'the absorbed figure is not accumulated from its undefined start',
    );
  });

  it('settles each reservation with the attempt it admitted', async () => {
    // The midnight case (#191 review). An empty reply whose retry crosses
    // into the next UTC day holds that day's ceiling, so settling the
    // hold at nothing and putting both attempts on the first reservation
    // makes one day forget a real request while the day before is pushed
    // past a ceiling it never spent.
    //
    // An unsettled hold is worse than either: the reclaim closes it at
    // its full worst case fifteen minutes later.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /if \(retryHold\?\.id !== undefined\) \{[\s\S]*?\.settle\(retryHold\.id, actual\)/,
      'the retry hold is left open or settled at a figure that is not the retry',
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
