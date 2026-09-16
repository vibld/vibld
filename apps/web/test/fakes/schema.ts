import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');

/**
 * Every migration, in the order D1 applies them.
 *
 * Tests used to name the migrations they wanted, which made a schema change
 * a rename away from a failure with nothing to do with the test: the subset
 * is a copy of the migration list, and a copy drifts. It also let a test
 * pass against a schema production never has, because the tables it did not
 * name were simply absent.
 *
 * Reading the directory removes both. The fake gets exactly the schema the
 * deployment gets, and adding or renumbering a migration needs no edit here.
 * Ordering is the filename's numeric prefix, which is the same thing
 * `wrangler d1 migrations apply` orders by.
 */
export function schemaSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}
