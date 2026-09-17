import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previewSnapshot } from '../src/github/github-client.ts';

const FILES = [{ path: 'index.html', content: '<h1>hi</h1>' }];

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noToken = async () => null;

const FULL = {
  owner: 'acme',
  repo: 'site',
  baseBranch: 'main',
  added: ['src/new.ts'],
  changed: ['index.html'],
  removed: ['LICENSE'],
  unchanged: 3,
  truncated: false,
};

describe('asking what a push would change', () => {
  it('reads the whole preview, destination included', async () => {
    const result = await previewSnapshot(
      FILES,
      async () => reply(FULL),
      noToken,
    );

    assert.ok(result.ok);
    assert.deepEqual(result.preview.removed, ['LICENSE']);
    assert.equal(result.preview.owner, 'acme');
    assert.equal(result.preview.baseBranch, 'main');
  });

  it('refuses a preview with no deletion list rather than drawing an empty one', async () => {
    // The deletion list is the reason this exists. Missing and drawn as
    // empty, it says a push removes nothing when it may remove everything
    // the repository has.
    const { removed: _removed, ...withoutRemoved } = FULL;
    const result = await previewSnapshot(
      FILES,
      async () => reply(withoutRemoved),
      noToken,
    );

    assert.equal(result.ok, false);
  });

  it('refuses a list with something in it that is not a path', async () => {
    const result = await previewSnapshot(
      FILES,
      async () => reply({ ...FULL, removed: ['LICENSE', 7] }),
      noToken,
    );

    assert.equal(result.ok, false);
  });

  it("passes the route's own sentence through on a refusal", async () => {
    const result = await previewSnapshot(
      FILES,
      async () => reply({ error: 'vibld no longer has access.' }, 409),
      noToken,
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.ok === false && result.error,
      'vibld no longer has access.',
    );
  });

  it('answers a sentence when the request never got out', async () => {
    const result = await previewSnapshot(
      FILES,
      async () => {
        throw new Error('offline');
      },
      noToken,
    );

    assert.equal(result.ok, false);
  });

  it('sends the files and nothing else', async () => {
    let sent: unknown;
    await previewSnapshot(
      FILES,
      async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return reply(FULL);
      },
      noToken,
    );

    // No revision: a preview is not a push and must not key one.
    assert.deepEqual(sent, { files: FILES });
  });
});
