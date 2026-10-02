import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { PREVIEW_FRAMES, originOf, summaryRow } from './self-host-journey.mjs';

describe('the self-host journey (D122)', () => {
  it('checks the origin it is given', () => {
    assert.equal(
      originOf(' https://acme-web.example.workers.dev/projects '),
      'https://acme-web.example.workers.dev',
    );
    assert.equal(originOf('http://localhost:8787'), 'http://localhost:8787');
    assert.throws(() => originOf(''), /not a URL/);
    assert.throws(() => originOf('ftp://example.com'), /http or https/);
  });

  it('writes a step as one table row', () => {
    assert.equal(
      summaryRow({
        name: 'Build',
        status: 'failed',
        seconds: 4,
        detail: 'a|b\nc',
      }),
      '| Build | failed (4s) | a/b c |',
    );
    assert.equal(
      summaryRow({ name: 'Build', status: 'skipped' }),
      '| Build | skipped |  |',
    );
  });

  it('looks for the iframes the preview pane shows', () => {
    const panel = readFileSync(
      new URL('../apps/web/src/components/PreviewPanel.tsx', import.meta.url),
      'utf8',
    );
    for (const title of Object.values(PREVIEW_FRAMES)) {
      assert.ok(panel.includes(`title="${title}"`), title);
    }
  });

  it('is run by the Self-host check, on Cloudflare and under Docker', () => {
    const workflow = readFileSync(
      new URL('../.github/workflows/self-host-check.yml', import.meta.url),
      'utf8',
    );
    const runs = workflow.match(/node scripts\/self-host-journey\.mjs/g) ?? [];
    assert.equal(runs.length, 2);
  });
});
