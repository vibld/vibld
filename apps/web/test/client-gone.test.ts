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
describe('how a route learns the caller has gone', () => {
  it('registers no abort listener without the already-gone check', async () => {
    const worker = join(
      fileURLToPath(new URL('../worker/', import.meta.url)),
      'index.ts',
    );
    const source = await readFile(worker, 'utf8');
    const bare = source.match(/\.addEventListener\(\s*['"]abort['"]/g);
    assert.equal(
      bare,
      null,
      'a route registers an abort listener directly; use whenClientGone, which also fires for a caller who had already left',
    );
  });

  it('is what both streaming routes use', async () => {
    const worker = join(
      fileURLToPath(new URL('../worker/', import.meta.url)),
      'index.ts',
    );
    const source = await readFile(worker, 'utf8');
    assert.equal(
      source.match(/whenClientGone\(/g)?.length,
      2,
      'expected the build route and the mockup route to use it',
    );
  });
});
