import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { decideAccessFor } from '../worker/access-handlers.ts';
import { isGated } from '../worker/access-gate.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The open paid beta is ready and not open (Chris, 2026-09-27).
 *
 * Everything the beta needs ships closed. The flip is one value,
 * `VIBLD_ACCESS_MODE=open` on the `preview` environment, which Chris sets
 * himself after a live billing check. These pin that nothing in the
 * repository has made that decision on his behalf: not the Worker's own
 * config, not the deploy workflow's default, and not the code's reading of
 * an absent value.
 */

const WEB = join(import.meta.dirname, '..');
const ROOT = join(WEB, '..', '..');

const STRANGER = {
  userId: 'user_stranger',
  email: 'stranger@example.com',
  emailVerified: true,
  policyIdentity: 'stranger@example.com',
};

describe('the open-beta gate, before the flip', () => {
  it('refuses a verified stranger on a deployment that has not been opened', async () => {
    const decision = await decideAccessFor(
      { DB: new SqliteD1Database(schemaSql()) },
      STRANGER,
    );
    assert.equal(decision.allowed, false);
  });

  it('is not opened by the Worker config committed here', async () => {
    // A var in wrangler.jsonc would be deployed by every `wrangler deploy`,
    // and would open the door from a file review rather than from the one
    // place the deploy records it.
    const config = await readFile(join(WEB, 'wrangler.jsonc'), 'utf8');
    assert.doesNotMatch(config, /"VIBLD_ACCESS_MODE"\s*:/);
  });

  it('deploys invite-only unless the environment says exactly open', async () => {
    const workflow = await readFile(
      join(ROOT, '.github', 'workflows', 'deploy-web-preview.yml'),
      'utf8',
    );
    const step = workflow.slice(
      workflow.indexOf('- name: Sync the access mode'),
      workflow.indexOf('- name: Apply D1 migrations'),
    );
    assert.match(step, /if \[ "\$\{VIBLD_ACCESS_MODE:-\}" = "open" \]; then/);
    assert.match(
      step,
      /printf 'invite' \| pnpm dlx wrangler@[\d.]+ secret put VIBLD_ACCESS_MODE/,
    );
    // Sourced from the environment secret, not written into the workflow.
    assert.match(
      step,
      /VIBLD_ACCESS_MODE: \$\{\{ secrets\.VIBLD_ACCESS_MODE \}\}/,
    );
  });

  it('keeps the card flow behind the gate until then', () => {
    // Saving a card is the first half of the welcome credit, so an
    // uninvited account must not be able to start it on a closed deployment.
    assert.equal(isGated('/api/billing/card', 'POST'), true);
  });
});
