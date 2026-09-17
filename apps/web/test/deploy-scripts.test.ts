import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A deploy that skips the migrations is a Worker live against a schema it
 * does not have, and this repository has already paid for that once:
 * `deploy-web-preview.yml` carries a comment recording that
 * `0002_billing.sql` and `0003_publish.sql` sat unapplied for two days after
 * their pull requests merged, and every `/api/plan` call answered "Usage
 * accounting is unavailable" until somebody applied them by hand.
 *
 * The workflow learned that lesson. The package script had not: it ran
 * `wrangler deploy` alone, so deploying from a terminal, or through
 * Cloudflare's Deploy button (which runs the `deploy` script and provisions
 * an empty D1), reproduced exactly the same outage.
 *
 * Asserted against the manifest rather than by running anything, because the
 * failure is a missing step rather than a broken one.
 */
const scripts = async (): Promise<Record<string, string>> => {
  const raw = await readFile(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  );
  return (JSON.parse(raw) as { scripts: Record<string, string> }).scripts;
};

describe('deploying this Worker', () => {
  it('applies the migrations before it deploys', async () => {
    const deploy = (await scripts()).deploy;
    assert.ok(deploy, 'no deploy script, so nothing runs the migrations');
    assert.match(deploy, /migrate/, 'the deploy script skips the migrations');

    const migrateAt = deploy.indexOf('migrate');
    const deployAt = deploy.search(/wrangler@[\d.]+ deploy/);
    assert.ok(deployAt > -1, 'the deploy script does not deploy');
    assert.ok(
      migrateAt < deployAt,
      'the Worker goes live before the schema it expects exists',
    );
  });

  it('runs the migrations against the remote database', async () => {
    // `wrangler d1 migrations apply` without --remote writes to the local
    // development database and reports success, which is the shape of this
    // bug that would be hardest to notice: a deploy that says it migrated.
    const migrate = (await scripts()).migrate;
    assert.ok(migrate, 'no migrate script');
    assert.match(migrate, /d1 migrations apply/);
    assert.match(migrate, /--remote/, 'migrated the local database instead');
  });

  it('leaves no way to deploy that skips them', async () => {
    // Every script whose name says it deploys has to reach the migration
    // step. An alias that called wrangler directly would be a second door
    // into the same outage.
    //
    // `pnpm run` references are followed rather than matched as text: an
    // alias that delegates to the safe script is safe, and a test that
    // demanded the word `migrate` appear in every deploy script would be
    // asserting the spelling instead of the property. That is what the first
    // version of this test did, and it failed a script that was correct.
    const all = await scripts();
    const expand = (name: string, seen = new Set<string>()): string => {
      if (seen.has(name)) return '';
      seen.add(name);
      const body = all[name] ?? '';
      return body.replace(/pnpm run ([\w:-]+)/g, (_, ref: string) =>
        expand(ref, seen),
      );
    };

    for (const name of Object.keys(all)) {
      if (!name.startsWith('deploy')) continue;
      assert.match(
        expand(name),
        /d1 migrations apply/,
        `${name} deploys without applying the migrations`,
      );
    }
  });
});
