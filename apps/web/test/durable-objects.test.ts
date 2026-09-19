import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { readConfig } from '../scripts/wrangler-var.ts';

/**
 * That every Durable Object this Worker binds can actually be created.
 *
 * Three separate files have to agree before a binding works, and none of
 * them fails until deploy: wrangler.jsonc names the binding and its class,
 * a migration registers that class, and the Worker's entrypoint exports it
 * so the runtime can find it. Miss the migration and `wrangler deploy`
 * refuses the whole Worker; miss the export and it deploys and then throws
 * on first use.
 *
 * Checked here rather than trusted because the failure is not local to the
 * change that causes it. `RUN_PROGRESS` (#183) is the second class this
 * Worker has ever had, and adding it meant the first migration entry was no
 * longer the only one -- the shape that had been correct for one class by
 * accident rather than by rule.
 *
 * `index.ts` imports `cloudflare:workers` and cannot be loaded under
 * `node --test`, so its export line is read as source. Same reasoning as
 * `access-gate.test.ts` and `client-gone.test.ts`.
 */
const here = import.meta.dirname;
const config = readConfig(
  readFileSync(join(here, '..', 'wrangler.jsonc'), 'utf8'),
);
const entrypoint = readFileSync(join(here, '..', 'worker', 'index.ts'), 'utf8');

describe('the Durable Object classes this Worker binds', () => {
  const bindings = config.durable_objects?.bindings ?? [];

  it('binds the ledger and the progress channel', () => {
    assert.deepEqual(bindings.map((binding) => binding.name).sort(), [
      'RUN_PROGRESS',
      'USER_BUDGET',
    ]);
  });

  it('registers every bound class in a migration', () => {
    const migrated = new Set(
      (config.migrations ?? []).flatMap(
        (migration) => migration.new_sqlite_classes ?? [],
      ),
    );
    for (const binding of bindings) {
      assert.ok(
        migrated.has(binding.class_name),
        `${binding.class_name} is bound as ${binding.name} but no migration creates it, so wrangler deploy refuses the Worker`,
      );
    }
  });

  it('gives each migration its own tag', () => {
    // A repeated tag is not a merge conflict anyone sees: wrangler tracks
    // which tags have been applied, so a second entry reusing the first's
    // tag is silently never applied.
    const tags = (config.migrations ?? []).map((migration) => migration.tag);
    assert.equal(new Set(tags).size, tags.length, tags.join(', '));
  });

  it('exports every bound class from the entrypoint', () => {
    for (const binding of bindings) {
      assert.match(
        entrypoint,
        new RegExp(`export \\{[^}]*\\b${binding.class_name}\\b[^}]*\\}`),
        `${binding.class_name} is bound but not exported from worker/index.ts, so the binding throws on first use`,
      );
    }
  });
});
