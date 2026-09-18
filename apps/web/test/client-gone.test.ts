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
  it('is listening for the caller before it creates a workflow', async () => {
    // This asserted a *check* before `create()` until the round after, which
    // found what one check cannot cover: `create()` is an awaited RPC, so a
    // Cancel arriving while it is in flight passes the check and is seen
    // only afterwards, with a Workflow already running. A listener has no
    // such window, so that is what is pinned now.
    const source = await readFile(workerSource(), 'utf8');
    const listener = source.indexOf('clientGone = true;');
    const create = source.indexOf('GENERATION_WORKFLOW!.create(');
    assert.ok(listener > -1, 'nothing is listening for a caller who leaves');
    assert.ok(create > -1, 'the test fixture lost the workflow creation');
    assert.ok(
      listener < create,
      'the listener is registered after the workflow exists, so an abort during create() is seen too late',
    );
  });

  it('acts on a caller who left while the workflow was being created', async () => {
    // Noticing is half of it. The window closes only if the answer is used
    // on the far side of `create()` as well: terminate what now exists, and
    // settle rather than leave the reservation to the reclaim, which closes
    // an abandoned one at the full worst case.
    const source = await readFile(workerSource(), 'utf8');
    const create = source.indexOf('GENERATION_WORKFLOW!.create(');
    const acted = source.indexOf('if (clientGone) {', create);
    const stream = source.indexOf('new TransformStream()');
    assert.ok(acted > -1, 'nothing acts on an abort that landed during create');
    assert.ok(
      acted < stream,
      'the run streams to a caller who is not there before anything stops it',
    );
    const block = source.slice(acted, stream);
    assert.match(
      block,
      /instance\.terminate\(\)/,
      'the workflow is left running',
    );
    assert.match(
      block,
      /releaseWithoutCharging\(\)/,
      'the reservation is left to the reclaim, which closes it at the worst case',
    );
  });

  it('settles a cancelled run in one place, not two', async () => {
    // Both sides of `create()` give the reservation back, and two copies of
    // a settlement is two things that can come to disagree about what a
    // cancelled run costs -- which is a shape this review found four times
    // in other files.
    const source = await readFile(workerSource(), 'utf8');
    const plan = source.indexOf('const releaseWithoutCharging =');
    assert.ok(plan > -1, 'the shared settlement is gone');
    assert.equal(
      source
        .slice(plan, source.indexOf('new TransformStream()'))
        .match(/settleBudget\(/g)?.length,
      1,
      'a cancelled build settles its reservation in more than one place',
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

  it('settles a cancelled run from what was sent, not from the bound', async () => {
    // Source-level and weaker than a behavioural test, as above. The point
    // is which figure reaches `cancelledUsage`: `inputChars` is the
    // reservation's bound and `sentChars` is the prompt that really went
    // (#189 review).
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /cancelledUsage\(streamedCharacters, maxTokens, sentChars\)/,
      'the cancellation settlement is reading the reservation bound again',
    );
  });

  it('takes the sent size from the client rather than rebuilding it', async () => {
    // The route cannot work this out for itself: DeepSeek appends the
    // output instruction to the system message and the other two clients
    // carry the schema structurally (#189 review). Reconstructing it here
    // was short by 430-odd characters on the provider production runs.
    const source = await readFile(workerSource(), 'utf8');
    assert.match(
      source,
      /onPromptChars: \(characters\) => \{\s*sentChars = characters;/,
      'the route is rebuilding the prompt size instead of being told it',
    );
  });

  it('is what every route that can be abandoned uses', async () => {
    // Three, not two: the build route registers twice on purpose. The first
    // covers the window around `create()`, where there is nothing to cancel
    // yet and the only useful answer is a flag; the second cancels the
    // stream, which needs an `instance` and a keepalive that do not exist
    // at the first. The mockup route is the third.
    const source = await readFile(workerSource(), 'utf8');
    assert.equal(
      source.match(/whenClientGone\(/g)?.length,
      3,
      'expected the build route (twice) and the mockup route to use it',
    );
  });
});
