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

describe('the secrets file this deployment tells you to create', () => {
  const read = (path: string) =>
    readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('is ignored by git', async () => {
    // `.env.example` says to copy it to `.dev.vars`, and for one commit it
    // said that file was ignored while nothing ignored it. Following the
    // instruction would have committed a live Stripe key and a GitHub App
    // private key on the next `git add .`.
    //
    // Asserted against `.gitignore` rather than by running `git`, so it
    // holds in a checkout where git is not available.
    const ignored = await read('../../../.gitignore');
    const lines = ignored
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    assert.ok(
      lines.includes('.dev.vars'),
      'the local secrets file is not ignored',
    );
    assert.ok(
      lines.includes('.dev.vars.*'),
      'a per-environment .dev.vars.<name> is not ignored',
    );
  });

  it('is the file the example tells you to write secrets into', async () => {
    // The pairing is the point: an example that named some other path would
    // leave the ignore rule above guarding a file nobody creates.
    const example = await read('../.env.example');
    assert.match(example, /\.dev\.vars/);
  });

  it('carries no value that looks like a credential', async () => {
    // Placeholders shaped like real keys trip secret scanners, and GitHub's
    // push protection rejected the first version of this file for exactly
    // that. Every credential line is left empty with its shape described in
    // a comment instead.
    const example = await read('../.env.example');
    const assignments = example
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));

    for (const line of assignments) {
      const [name, value] = line.split(/=(.*)/s) as [string, string];
      assert.doesNotMatch(
        value,
        /^(sk|pk|rk|whsec|re)[-_]/,
        `${name} holds something shaped like a real key`,
      );
    }
  });
});
