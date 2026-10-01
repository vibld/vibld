import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// @ts-expect-error -- a plain .mjs script with no declarations.
import { hasSecret } from '../scripts/has-secret.mjs';

/**
 * The deploy's one-time creation of the key-encryption key (D132): created
 * only when the Worker plainly has none, never over one that exists.
 */

const KEY = 'VIBLD_KEY_ENCRYPTION_KEY';
const WORKFLOW = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'deploy-web-preview.yml',
);

describe('reading the secret list (D132)', () => {
  it('says present, absent, or unreadable, and never guesses absent', () => {
    assert.equal(hasSecret(`[{"name":"${KEY}","type":"secret_text"}]`, KEY), 0);
    assert.equal(hasSecret('[{"name":"OTHER"}]', KEY), 1);
    assert.equal(hasSecret('[]', KEY), 1);
    assert.equal(
      hasSecret(`wrangler 4\n[WARNING] x\n[\n {"name":"${KEY}"}\n]`, KEY),
      0,
    );
    assert.equal(hasSecret('', KEY), 2);
    assert.equal(hasSecret('Authentication error', KEY), 2);
    assert.equal(hasSecret('{"name":"x"}', KEY), 2);
    assert.equal(hasSecret('[{"nope":1}]', KEY), 2);
    assert.equal(hasSecret('[]', ''), 2);
  });

  it('creates the key only on "absent", before the Worker is deployed', async () => {
    const workflow = await readFile(WORKFLOW, 'utf8');
    const start = workflow.indexOf(
      '- name: Create the provider-key encryption key, once',
    );
    const deploy = workflow.indexOf('- name: Deploy to Cloudflare Workers');
    assert.ok(start > 0 && start < deploy);
    const step = workflow.slice(start, workflow.indexOf('- name:', start + 10));
    assert.match(
      step,
      /node scripts\/has-secret\.mjs VIBLD_KEY_ENCRYPTION_KEY/,
    );
    // The only write, and it is under "1)".
    const writes = step.split('secret put VIBLD_KEY_ENCRYPTION_KEY').length - 1;
    assert.equal(writes, 1);
    const absent = step.indexOf('            1)');
    const put = step.indexOf('secret put VIBLD_KEY_ENCRYPTION_KEY');
    const other = step.indexOf('            *)');
    assert.ok(absent > 0 && absent < put && put < other);
    assert.match(step.slice(other), /exit 1/);
    // Never echoed: generated and piped straight in.
    assert.match(
      step,
      /openssl rand -base64 32 \| tr -d '\\n' \| pnpm dlx wrangler/,
    );
  });
});
