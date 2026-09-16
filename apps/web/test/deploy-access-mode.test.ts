import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { normaliseEmail } from '../worker/access.ts';
import { parsePlatformAdmins } from '../worker/platform-admins.ts';

/**
 * The deploy step that decides whether a deployment is open, and refuses one
 * nobody could ever open.
 *
 * Tested by running the step's own shell rather than by reading it, because
 * the thing worth knowing is what it does with a given set of secrets, and a
 * grep for "exit 1" would pass against a script that never reaches it.
 *
 * The one piece that is structural is the ordering: a check that runs after
 * the deploy has already happened is not a check, and the YAML is the only
 * place that says which comes first.
 */

/** The step that decides, and the step that writes. */
const CHECK = 'Check who can get in, before any secret is written';
const SYNC = 'Sync the access mode';

const WORKFLOW = fileURLToPath(
  new URL('../../../.github/workflows/deploy-web-preview.yml', import.meta.url),
);

async function workflow(): Promise<string> {
  return readFile(WORKFLOW, 'utf8');
}

/**
 * The `run:` block of a named step, dedented.
 *
 * Extracted textually rather than through a YAML parser: this repository has
 * no YAML dependency, and the alternative is adding one to read a single
 * literal block.
 */
async function stepScript(name: string): Promise<string> {
  const source = await workflow();
  const start = source.indexOf(`- name: ${name}`);
  assert.ok(start > 0, `no step named ${name}`);
  const body = source.slice(start);
  const runAt = body.indexOf('run: |\n');
  assert.ok(runAt > 0, `${name} has no literal run block`);
  const lines = body.slice(runAt + 'run: |\n'.length).split('\n');
  const indent = (lines[0] ?? '').match(/^ */)?.[0].length ?? 0;
  assert.ok(indent > 0, 'expected an indented block');
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() !== '' && (line.match(/^ */)?.[0].length ?? 0) < indent) {
      break;
    }
    out.push(line.slice(indent));
  }
  return out.join('\n');
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  summary: string;
  wrangler: string;
}

/**
 * Run the step with a given environment.
 *
 * `pnpm` is stubbed, because the step's job is to decide and to say; whether
 * Cloudflare accepts the value is not what is under test and cannot be
 * reached from here anyway. The stub records what it was told to put, and
 * its stdin, so "did it set the mode to open" is answerable.
 */
async function run(step: string, env: Record<string, string>): Promise<Run> {
  // Defaulted so the cases about admin lists stay about admin lists. A test
  // that had to spell out every prerequisite would start passing for the
  // wrong reason the moment another one was added.
  const withDefaults = { CLERK_PUBLISHABLE_KEY: 'pk_test_x', ...env };
  const dir = await mkdtemp(join(tmpdir(), 'vibld-deploy-'));
  const summary = join(dir, 'summary.md');
  const wrangler = join(dir, 'wrangler.log');
  const shim = join(dir, 'pnpm');
  await writeFile(
    shim,
    `#!/bin/sh\nprintf '%s ' "$@" >> ${wrangler}\ncat >> ${wrangler}\nprintf '\\n' >> ${wrangler}\n`,
  );
  await chmod(shim, 0o755);
  await writeFile(summary, '');
  await writeFile(wrangler, '');

  const script = await stepScript(step);
  const result = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    execFile(
      'bash',
      ['-c', script],
      {
        env: {
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          GITHUB_STEP_SUMMARY: summary,
          ...withDefaults,
        },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });

  return {
    ...result,
    summary: await readFile(summary, 'utf8'),
    wrangler: await readFile(wrangler, 'utf8'),
  };
}

describe('the access mode a deploy sets', () => {
  it('refuses a closed deployment that nobody could open', async () => {
    // The failure this exists for. Invite-only with no platform admin
    // admits nobody and gives nobody the ability to issue an invite: the
    // only door is the admin panel and this secret is the only key. Green
    // and locked out is the worst of the outcomes available here.
    const result = await run(CHECK, {
      VIBLD_ACCESS_MODE: '',
      VIBLD_PLATFORM_ADMINS: '',
    });

    assert.equal(result.code, 1, 'deployed a product nobody can get into');
    assert.match(result.stdout + result.stderr, /VIBLD_PLATFORM_ADMINS/);
    assert.equal(result.wrangler, '', 'set the mode before refusing');
  });

  it('counts admins the way the Worker will', async () => {
    // Asked of the Worker's own parser rather than a list of remembered
    // answers, because every failure here has been the shell and the Worker
    // disagreeing about what a list means. `" , "` is a non-empty secret and
    // an empty admin set; `a@x.com` and `b@y.com` joined by a newline is one
    // member with a newline inside it, which can never match a verified
    // email, though anything that splits on newlines counts it as two.
    //
    // A check more generous than the thing it checks passes exactly the
    // deployments it exists to stop.
    for (const admins of [
      ' , ',
      ',,',
      '   ',
      '',
      'chris',
      'chris@',
      '@example',
      'a@x.com\nb@y.com',
      // One `@` and nothing a verified email could equal: no dotted domain
      // at all, and a local part that is only punctuation.
      'a@b',
      '.@.',
      `${'a'.repeat(250)}@x.com`,
      'chris@example.com',
      '  chris@example.com  ',
      'chris@example.com\n',
      'bad, chris@example.com',
      'chris@example.com,someone@else.io',
      'a@x.com,\nb@y.com',
    ]) {
      // Both halves asked of the application: `parsePlatformAdmins` for what
      // the list means, `normaliseEmail` for whether a member could be an
      // address at all. A predicate restated here is a predicate that drifts,
      // which is what every finding on this step has been.
      const admitted = [...parsePlatformAdmins(admins)].some(
        (entry) => normaliseEmail(entry) !== null,
      );
      const result = await run(CHECK, {
        VIBLD_ACCESS_MODE: '',
        VIBLD_PLATFORM_ADMINS: admins,
      });

      assert.equal(
        result.code === 0,
        admitted,
        `the deploy and the Worker disagree about ${JSON.stringify(admins)}`,
      );
      if (!admitted) {
        assert.match(result.stdout + result.stderr, /VIBLD_PLATFORM_ADMINS/);
      }
    }
  });

  it('refuses a closed deployment nobody can sign in to', async () => {
    // The other side of the same outage. With no browser Clerk key the
    // Build step inlines nothing, no request carries a token, and
    // `/api/config` cannot say who is asking: the admin named in the list
    // never sees the panel that issues invites, so an invite-only
    // deployment admits nobody.
    const result = await run(CHECK, {
      VIBLD_ACCESS_MODE: '',
      VIBLD_PLATFORM_ADMINS: 'chris@example.com',
      CLERK_PUBLISHABLE_KEY: '',
    });

    assert.equal(result.code, 1, 'shipped a product nobody can sign in to');
    assert.match(result.stdout + result.stderr, /CLERK_PUBLISHABLE_KEY/);

    // An open deployment is a different question. A deploy with no Clerk at
    // all is a supported shape, and it is being closed that makes an
    // identity provider load-bearing.
    const opened = await run(CHECK, {
      VIBLD_ACCESS_MODE: 'open',
      VIBLD_PLATFORM_ADMINS: '',
      CLERK_PUBLISHABLE_KEY: '',
    });
    assert.equal(opened.code, 0, 'refused an open deployment over Clerk');
  });

  it('is invite-only when nothing says otherwise', async () => {
    // Unset is the launch state, and it is written rather than left absent
    // so that going back to closed is possible from here.
    const result = await run(SYNC, {
      VIBLD_ACCESS_MODE: '',
      VIBLD_PLATFORM_ADMINS: 'chris@example.com',
    });

    assert.equal(result.code, 0);
    assert.match(result.wrangler, /VIBLD_ACCESS_MODE/);
    assert.match(result.wrangler, /invite/);
    assert.doesNotMatch(result.wrangler, /open/);
    assert.match(result.summary, /INVITE ONLY/);
  });

  it('opens only on the exact word, and says when it did not', async () => {
    // The Worker compares the raw value, so ` OPEN ` is invite-only there.
    // A deployment that was meant to open and did not is worth seeing in
    // the run rather than discovering from the door.
    for (const mode of ['OPEN', ' open', 'open ', 'opne', 'true']) {
      const checked = await run(CHECK, {
        VIBLD_ACCESS_MODE: mode,
        VIBLD_PLATFORM_ADMINS: 'chris@example.com',
      });
      assert.equal(checked.code, 0, mode);
      assert.match(checked.stdout, /::warning::/, `${mode} passed silently`);

      const written = await run(SYNC, { VIBLD_ACCESS_MODE: mode });
      assert.equal(written.code, 0, mode);
      assert.match(written.summary, /INVITE ONLY/, mode);
      assert.doesNotMatch(written.wrangler, /open/, `${mode} opened it`);
    }

    const opened = await run(SYNC, {
      VIBLD_ACCESS_MODE: 'open',
      VIBLD_PLATFORM_ADMINS: '',
    });
    assert.equal(opened.code, 0);
    assert.match(opened.summary, /OPEN/);
    // No admin required to open a deployment: an open one needs nobody to
    // issue invites, so the refusal above would be answering a question
    // this deployment does not ask.
    assert.match(opened.wrangler, /open/);
  });

  it('decides before any secret is written, not just before the deploy', async () => {
    // `wrangler secret put` creates a new Worker version and deploys it
    // immediately, and the first secret this job syncs is the admin list
    // itself. A check that ran after that would publish the broken list,
    // lock out the admins who could have fixed it, and then fail the run.
    // Failing afterwards is not refusing.
    //
    // The order lives in the YAML and nowhere else, which is why this one
    // rule is structural.
    const source = await workflow();
    const check = source.indexOf(`- name: ${CHECK}`);
    const firstWrite = source.indexOf('wrangler@4.129.1 secret put');
    const deploy = source.indexOf('- name: Deploy to Cloudflare Workers');
    assert.ok(check > 0 && firstWrite > 0 && deploy > 0);

    assert.ok(check < firstWrite, 'a secret is written before the check runs');
    assert.ok(check < deploy, 'the access mode is decided after the deploy');

    // And the check itself must not be a writer, or it is the same bug in
    // one step instead of two.
    assert.doesNotMatch(
      await stepScript(CHECK),
      /secret put/,
      'the check writes a secret of its own',
    );
  });
});
