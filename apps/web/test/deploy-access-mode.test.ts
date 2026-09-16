import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { normaliseEmail } from '../worker/access.ts';
import { parsePlatformAdmins } from '../worker/platform-admins.ts';
import { accessPreflight, main } from '../scripts/access-preflight.ts';

/**
 * The decision a deploy makes about whether the deployment it is publishing
 * would let anybody in.
 *
 * Three kinds of rule here, because the failure has taken three shapes.
 *
 * The verdict is a function, tested directly. It used to be shell, and every
 * finding against it was the same: a second implementation of a rule the
 * application already owns, more generous than the original, which is the
 * direction that ships the outage.
 *
 * The workflow's use of it is structural, read from the YAML, because a
 * check that runs after the first `wrangler secret put` has already
 * published the value it then refuses. Failing afterwards is not refusing.
 *
 * And the wiring is run end to end once, because a module nothing invokes
 * refuses nothing.
 */

const CHECK = 'Check who can get in, before any secret is written';
const WORKFLOW = fileURLToPath(
  new URL('../../../.github/workflows/deploy-web-preview.yml', import.meta.url),
);
const SCRIPT = fileURLToPath(
  new URL('../scripts/access-preflight.ts', import.meta.url),
);

function workflow(): Promise<string> {
  return readFile(WORKFLOW, 'utf8');
}

const KEY = 'pk_test_x';

describe('who the deploy thinks can get in', () => {
  it('refuses a closed deployment that nobody could open', () => {
    // The failure this exists for. Invite-only with no platform admin admits
    // nobody and gives nobody the ability to issue an invite: the only door
    // is the admin panel and that secret is the only key. Green and locked
    // out is the worst outcome available here.
    const result = accessPreflight({
      VIBLD_ACCESS_MODE: '',
      VIBLD_PLATFORM_ADMINS: '',
      CLERK_PUBLISHABLE_KEY: KEY,
    });

    assert.equal(result.ok, false, 'would deploy a product nobody can enter');
    assert.match(result.errors.join(' '), /VIBLD_PLATFORM_ADMINS/);
  });

  it('refuses a closed deployment nobody can sign in to', () => {
    // The same outage from the other side. With no browser Clerk key the
    // build inlines nothing, no request carries a token, and `/api/config`
    // cannot say who is asking: the admin named in the list never sees the
    // panel that issues invites.
    const closed = accessPreflight({
      VIBLD_ACCESS_MODE: '',
      VIBLD_PLATFORM_ADMINS: 'chris@example.com',
      CLERK_PUBLISHABLE_KEY: '',
    });
    assert.equal(closed.ok, false, 'shipped a product nobody can sign in to');
    assert.match(closed.errors.join(' '), /CLERK_PUBLISHABLE_KEY/);

    // An open deployment is a different question. A deploy with no Clerk at
    // all is a supported shape, and it is being closed that makes an
    // identity provider load-bearing.
    const open = accessPreflight({
      VIBLD_ACCESS_MODE: 'open',
      VIBLD_PLATFORM_ADMINS: '',
      CLERK_PUBLISHABLE_KEY: '',
    });
    assert.equal(open.ok, true, 'refused an open deployment over Clerk');
  });

  it('agrees with the application about every admin list', () => {
    // Asked of the Worker's own parser and validator rather than a list of
    // remembered answers. Every finding against the old shell version was
    // the two disagreeing: `" , "` is a non-empty secret and an empty admin
    // set; two addresses joined by a newline are one member with a newline
    // inside it; `a@b` has an `@` and no domain a verified email could have.
    for (const admins of [
      ' , ',
      ',,',
      '   ',
      '',
      'chris',
      'chris@',
      '@example',
      'a@b',
      '.@.',
      'a@x.com\nb@y.com',
      `${'a'.repeat(250)}@x.com`,
      'chris@example.com',
      '  chris@example.com  ',
      'chris@example.com\n',
      'bad, chris@example.com',
      'chris@example.com,someone@else.io',
      'a@x.com,\nb@y.com',
    ]) {
      const admitted = [...parsePlatformAdmins(admins)].some(
        (entry) => normaliseEmail(entry) !== null,
      );
      const result = accessPreflight({
        VIBLD_ACCESS_MODE: '',
        VIBLD_PLATFORM_ADMINS: admins,
        CLERK_PUBLISHABLE_KEY: KEY,
      });

      assert.equal(
        result.ok,
        admitted,
        `the deploy and the application disagree about ${JSON.stringify(admins)}`,
      );
      assert.equal(result.admins > 0, admitted);
    }
  });

  it('opens only on the exact word, and says when it did not', () => {
    // `parseAccessMode` is the Worker's, so this cannot drift from what the
    // deployment will actually do. A value that was meant to open the door
    // and did not is worth seeing in the run rather than discovering from
    // the door.
    for (const mode of ['OPEN', ' open', 'open ', 'opne', 'true']) {
      const result = accessPreflight({
        VIBLD_ACCESS_MODE: mode,
        VIBLD_PLATFORM_ADMINS: 'chris@example.com',
        CLERK_PUBLISHABLE_KEY: KEY,
      });
      assert.equal(result.mode, 'invite', mode);
      assert.equal(result.warnings.length, 1, `${mode} passed silently`);
      assert.match(result.summary, /INVITE ONLY/, mode);
    }

    const opened = accessPreflight({ VIBLD_ACCESS_MODE: 'open' });
    assert.equal(opened.mode, 'open');
    assert.match(opened.summary, /OPEN/);
    assert.equal(opened.warnings.length, 0, 'warned about a deliberate open');

    // Unset is the launch state and must not warn: it is the default, not a
    // typo.
    const unset = accessPreflight({
      VIBLD_PLATFORM_ADMINS: 'chris@example.com',
      CLERK_PUBLISHABLE_KEY: KEY,
    });
    assert.equal(unset.mode, 'invite');
    assert.equal(unset.warnings.length, 0, 'warned about the default');
  });

  it('reports through the channels the run reads, and stops it', () => {
    // The verdict is only worth having if the workflow acts on it: an exit
    // code that is always zero refuses nothing, and a message nobody writes
    // is a refusal nobody sees.
    const lines: string[] = [];
    const written: string[] = [];
    const code = main(
      {
        VIBLD_ACCESS_MODE: 'OPEN',
        VIBLD_PLATFORM_ADMINS: ' , ',
        CLERK_PUBLISHABLE_KEY: '',
        GITHUB_STEP_SUMMARY: '/dev/null',
      },
      (_path, line) => written.push(line),
      (line) => lines.push(line),
    );

    assert.equal(code, 1, 'let the deploy continue');
    assert.equal(lines.filter((l) => l.startsWith('::error::')).length, 2);
    assert.equal(lines.filter((l) => l.startsWith('::warning::')).length, 1);
    assert.match(written.join(''), /INVITE ONLY/);
  });

  it('is what the workflow actually runs, before any secret is written', async () => {
    // `wrangler secret put` creates a new Worker version and deploys it
    // immediately, and the first secret this job syncs is the admin list
    // itself. A check placed after that publishes the broken list, locks out
    // the admins who could have fixed it, and then fails the run.
    //
    // The order lives in the YAML and nowhere else, and so does whether the
    // step runs this module at all.
    const source = await workflow();
    const check = source.indexOf(`- name: ${CHECK}`);
    const firstWrite = source.indexOf('wrangler@4.129.1 secret put');
    const deploy = source.indexOf('- name: Deploy to Cloudflare Workers');
    assert.ok(check > 0 && firstWrite > 0 && deploy > 0);

    assert.ok(check < firstWrite, 'a secret is written before the check runs');
    assert.ok(check < deploy, 'the access mode is decided after the deploy');

    const step = source.slice(check, firstWrite);
    assert.match(step, /scripts\/access-preflight\.ts/, 'runs something else');
    assert.doesNotMatch(step, /secret put/, 'the check writes a secret itself');
  });

  it('runs as a program, not just as a function', async () => {
    // The wiring, end to end: the same command the workflow runs, with the
    // secrets of a deployment that would admit nobody.
    const result = await new Promise<{ code: number; out: string }>(
      (resolve) => {
        execFile(
          process.execPath,
          ['--experimental-strip-types', SCRIPT],
          {
            env: {
              PATH: process.env.PATH ?? '',
              VIBLD_ACCESS_MODE: '',
              VIBLD_PLATFORM_ADMINS: ' , ',
              CLERK_PUBLISHABLE_KEY: 'pk_x',
            },
          },
          (error, stdout, stderr) => {
            resolve({
              code:
                error && typeof (error as { code?: unknown }).code === 'number'
                  ? (error as { code: number }).code
                  : error
                    ? 1
                    : 0,
              out: stdout + stderr,
            });
          },
        );
      },
    );

    assert.equal(result.code, 1, 'the step would have passed');
    assert.match(result.out, /::error::/);
    assert.match(result.out, /VIBLD_PLATFORM_ADMINS/);
  });
});
