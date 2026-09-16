import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { GATED_PATHS, UNGATED_PATHS, isGated } from '../worker/access-gate.ts';

/**
 * The rule that keeps the gate honest.
 *
 * A gate applied inside each handler fails silently: the next endpoint that
 * spends money and forgets the call is open, and nothing says so. This reads
 * the router's own source, takes every route literal it dispatches on, and
 * fails on any that appears in neither list.
 *
 * Adding a route therefore forces a decision about it, and the decision is
 * written down next to a reason rather than implied by an omission.
 */

const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));

async function routedPaths(): Promise<string[]> {
  const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
  return [
    ...new Set(
      [...source.matchAll(/pathname === '(\/api\/[^']+)'/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}

describe('the invite gate', () => {
  it('classifies every route the worker dispatches on', async () => {
    const paths = await routedPaths();
    assert.ok(paths.length > 15, `only found ${paths.length} routes`);

    const unclassified = paths.filter(
      (path) => !GATED_PATHS.includes(path) && !(path in UNGATED_PATHS),
    );
    assert.deepEqual(
      unclassified,
      [],
      `these routes are behind no decision at all: ${unclassified.join(', ')}`,
    );
  });

  it('gates everything that spends money or writes somewhere else', async () => {
    // Named individually rather than by prefix. A prefix rule would quietly
    // absorb a future sibling route, which is the failure this file exists
    // to prevent.
    for (const path of [
      '/api/plan',
      '/api/preview',
      '/api/publish',
      '/api/github/push',
      '/api/billing/checkout',
    ]) {
      assert.ok(isGated(path), `${path} is not gated`);
    }
  });

  it('never lists a route as both gated and ungated', async () => {
    const both = GATED_PATHS.filter((path) => path in UNGATED_PATHS);
    assert.deepEqual(both, []);
  });

  it('gives every ungated route a reason', () => {
    // "Why is this open" is the question somebody will ask in six months,
    // and an empty string is how it stops being answerable.
    for (const [path, reason] of Object.entries(UNGATED_PATHS)) {
      assert.ok(reason.trim().length > 10, `${path} has no real reason`);
    }
  });

  it('leaves the webhook open, because Stripe has no invite', () => {
    // Gating it would drop deliveries for uninvited accounts, which is how a
    // payment that succeeded ends up unmirrored.
    assert.equal(isGated('/api/stripe/webhook'), false);
  });

  it('leaves the shell able to render its own refusal', () => {
    assert.equal(isGated('/api/config'), false);
    assert.equal(isGated('/api/access/status'), false);
  });
});
