import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { whenClientGone } from '../worker/client-gone.ts';

/**
 * Noticing a caller who left before anyone was listening (#189 review).
 *
 * Both streaming routes did real work -- identity, allowance, reservation --
 * before registering their `cancel`. A caller who disconnected during any
 * of it had already aborted the signal, and `addEventListener` does not
 * replay an abort that has happened, so nothing fired and the run started
 * for somebody who was not there.
 */
describe('noticing that the caller has gone', () => {
  it('fires for an abort that already happened', () => {
    const controller = new AbortController();
    controller.abort();

    let cancelled = 0;
    whenClientGone(controller.signal, () => (cancelled += 1));

    assert.equal(cancelled, 1, 'a caller who had already left went unnoticed');
  });

  it('fires for an abort that happens later', () => {
    const controller = new AbortController();
    let cancelled = 0;
    whenClientGone(controller.signal, () => (cancelled += 1));
    assert.equal(cancelled, 0, 'cancelled before the caller left');

    controller.abort();
    assert.equal(cancelled, 1);
  });

  it('does nothing for a caller who is still there', () => {
    let cancelled = 0;
    whenClientGone(new AbortController().signal, () => (cancelled += 1));
    assert.equal(cancelled, 0);
  });

  it('tolerates a runtime with no signal at all', () => {
    // `request.signal` is optional in this codebase, and the keepalive
    // write failure is the documented backstop for that case.
    assert.doesNotThrow(() => whenClientGone(undefined, () => {}));
  });

  it('is safe to fire twice, which the callers rely on', () => {
    // Registering before checking leaves the listener live for the window
    // in between, at the cost of a possible double fire. Both routes guard
    // on a `cancelled` flag, so this pins the contract rather than the
    // count.
    const controller = new AbortController();
    controller.abort();

    let cancelled = 0;
    const once = () => {
      if (cancelled > 0) return;
      cancelled += 1;
    };
    whenClientGone(controller.signal, once);
    controller.abort();

    assert.equal(cancelled, 1);
  });
});

/**
 * The rule, rather than the two places that currently follow it.
 *
 * A mutation showed why this is needed: reverting both routes to a bare
 * `addEventListener` was caught only by an unused import, which is an
 * accident rather than a guard -- remove the import too and nothing
 * complains. The same shape as several findings in this review, where the
 * assertion lived a layer away from the thing that had been wrong.
 *
 * So this reads the Worker's own source, the way `access-gate.test.ts`
 * reads the router's, and fails on any abort listener registered without
 * `whenClientGone`. The next streaming route cannot copy the hole.
 */
function workerSource(): string {
  return join(
    fileURLToPath(new URL('../worker/', import.meta.url)),
    'index.ts',
  );
}

describe('how a route learns the caller has gone', () => {
  it('registers no abort listener without the already-gone check', async () => {
    const source = await readFile(workerSource(), 'utf8');
    const bare = source.match(/\.addEventListener\(\s*['"]abort['"]/g);
    assert.equal(
      bare,
      null,
      'a route registers an abort listener directly; use whenClientGone, which also fires for a caller who had already left',
    );
  });

  /**
   * Where the check happens, not only that it happens (#189 review).
   *
   * Source-level, and weaker than a behavioural test, which I would rather
   * say than dress up: `handlePlan` and `handleMockups` need Clerk, D1,
   * Durable Objects and a Workflow binding to exercise, and standing all of
   * that up is its own change. What this does catch is the ordering, which
   * is the whole of both findings -- a check after the Workflow exists is a
   * check that can only terminate, and terminating lands at a step boundary
   * with the reservation left to the reclaim.
   */
  it('asks whether the caller is gone before creating a workflow', async () => {
    const source = await readFile(workerSource(), 'utf8');
    const abortCheck = source.indexOf('if (request.signal?.aborted)');
    const create = source.indexOf('GENERATION_WORKFLOW!.create(');
    assert.ok(abortCheck > -1, 'no early check for a caller who already left');
    assert.ok(create > -1, 'the test fixture lost the workflow creation');
    assert.ok(
      abortCheck < create,
      'the check happens after the workflow exists, so it can only terminate one',
    );
  });

  it('skips the provider when cancellation already happened', async () => {
    // The other half: `whenClientGone` aborts the controller for a caller
    // who had already gone, and without this the run still marked the
    // provider as having run and called it with a pre-aborted signal --
    // so settlement charged the full input estimate for a request that
    // never left the Worker.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /if \(cancelled\) return;\s+providerRan = true;/,
      'the mockup run marks the provider as having run without checking whether the caller is still there',
    );
  });

  it('is what both streaming routes use', async () => {
    const source = await readFile(workerSource(), 'utf8');
    assert.equal(
      source.match(/whenClientGone\(/g)?.length,
      2,
      'expected the build route and the mockup route to use it',
    );
  });
});
