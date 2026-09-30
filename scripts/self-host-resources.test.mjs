import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resourcesFor, teardown } from './self-host-resources.mjs';

describe('what a self-host check creates and removes (D117)', () => {
  it('names only what the prefix owns', () => {
    assert.deepEqual(resourcesFor('acme'), {
      workers: ['acme-web', 'acme-preview', 'acme-publish'],
      containerPrefix: 'acme-preview-',
      workflow: 'acme-generation',
      database: 'acme-control-plane',
      bucket: 'acme-control-plane',
    });
  });

  it("refuses a prefix that could reach vibld's own deployment", () => {
    for (const prefix of ['vibld', 'vibld-web', '', 'Acme', undefined]) {
      assert.throws(() => resourcesFor(prefix), /not a usable prefix/);
    }
  });

  it('fails, rather than reporting done, when it cannot list what to remove', async () => {
    // Codex review of internal PR 334: a 5xx listing read as an empty one skipped the
    // database and the container, and the teardown still passed.
    const saved = {
      fetch: globalThis.fetch,
      token: process.env.CLOUDFLARE_API_TOKEN,
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
    };
    process.env.CLOUDFLARE_API_TOKEN = 'test';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test';
    const deleted = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      if (init.method === 'DELETE') {
        deleted.push(path);
        return Response.json({ success: true, result: null });
      }
      return Response.json(
        { success: false, errors: [{ code: 10000, message: 'unavailable' }] },
        { status: 503 },
      );
    };
    const log = console.log;
    console.log = () => {};
    try {
      await assert.rejects(
        teardown('acme'),
        /list container applications[\s\S]*list databases/,
      );
      assert.ok(!deleted.some((p) => p.includes('/d1/')));
    } finally {
      console.log = log;
      globalThis.fetch = saved.fetch;
      for (const [key, value] of [
        ['CLOUDFLARE_API_TOKEN', saved.token],
        ['CLOUDFLARE_ACCOUNT_ID', saved.account],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
