import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PUBLISHES,
  listPublishes,
  recordPublish,
  resolvePublishSource,
} from '../worker/publish-history.ts';
import type { CheckpointReader } from '../worker/publish-history.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Putting an earlier checkpoint back on the web (D219): what a publish is
 * built from, and the record a rollback picks from.
 */

const PROJECT = 'project-001';

function history(held: Record<string, string>): CheckpointReader & {
  loads: string[];
} {
  const loads: string[] = [];
  return {
    loads,
    async listCheckpoints() {
      return {
        checkpoints: Object.keys(held).map((revision) => ({ revision })),
      };
    },
    async loadRevision(_projectId, revision) {
      loads.push(revision);
      const content = held[revision];
      return content === undefined
        ? undefined
        : { files: [{ path: 'index.html', content }] };
    },
  };
}

const parseFiles = (body: unknown) => {
  const { files } = body as { files?: unknown };
  return Array.isArray(files)
    ? { ok: true as const, value: files as { path: string; content: string }[] }
    : { ok: false as const, status: 400, error: '"files" is required.' };
};

describe('what a publish puts on the web', () => {
  it('rolls back from the stored checkpoint, never from the request', async () => {
    const store = history({ r1: '<h1>first</h1>', r2: '<h1>second</h1>' });
    const source = await resolvePublishSource(
      { revision: 'r1' },
      PROJECT,
      store,
      parseFiles,
    );
    assert.deepEqual(source, {
      ok: true,
      files: [{ path: 'index.html', content: '<h1>first</h1>' }],
      revision: 'r1',
    });
    assert.deepEqual(store.loads, ['r1']);
  });

  it('refuses a checkpoint the project does not hold', async () => {
    const source = await resolvePublishSource(
      { revision: 'r9' },
      PROJECT,
      history({ r1: 'x' }),
      parseFiles,
    );
    assert.equal(source.ok, false);
    assert.equal(!source.ok && source.status, 404);
  });

  it('refuses a rollback with no history to read', async () => {
    const source = await resolvePublishSource(
      { revision: 'r1' },
      PROJECT,
      null,
      parseFiles,
    );
    assert.equal(!source.ok && source.status, 404);
  });

  it('refuses a revision no checkpoint could be named', async () => {
    for (const revision of ['../r1', '', 7, 'r'.repeat(65)]) {
      const source = await resolvePublishSource(
        { revision },
        PROJECT,
        history({ r1: 'x' }),
        parseFiles,
      );
      assert.equal(!source.ok && source.status, 400, String(revision));
    }
  });

  it("publishes the builder's files, recording the revision only when it is held", async () => {
    const files = [{ path: 'index.html', content: '<h1>draft</h1>' }];
    const held = await resolvePublishSource(
      { files, revision: 'r1' },
      PROJECT,
      history({ r1: '<h1>draft</h1>' }),
      parseFiles,
    );
    assert.deepEqual(held, { ok: true, files, revision: 'r1' });

    // A held revision whose files are not the ones sent: the files go out,
    // and nothing is recorded that a put-back could not reproduce.
    const other = await resolvePublishSource(
      { files, revision: 'r1' },
      PROJECT,
      history({ r1: 'stored' }),
      parseFiles,
    );
    assert.deepEqual(other, { ok: true, files, revision: null });

    // The same count, with one path twice and a stored one missing.
    const twoFiles: CheckpointReader = {
      async listCheckpoints() {
        return { checkpoints: [{ revision: 'r1' }] };
      },
      async loadRevision() {
        return {
          files: [
            { path: 'index.html', content: 'a' },
            { path: 'about.html', content: 'b' },
          ],
        };
      },
    };
    const doubled = [
      { path: 'index.html', content: 'a' },
      { path: 'index.html', content: 'a' },
    ];
    assert.deepEqual(
      await resolvePublishSource(
        { files: doubled, revision: 'r1' },
        PROJECT,
        twoFiles,
        parseFiles,
      ),
      { ok: true, files: doubled, revision: null },
    );

    const unheld = await resolvePublishSource(
      { files, revision: 'r7' },
      PROJECT,
      history({ r1: 'stored' }),
      parseFiles,
    );
    assert.deepEqual(unheld, { ok: true, files, revision: null });

    const bare = await resolvePublishSource(
      { files },
      PROJECT,
      history({}),
      parseFiles,
    );
    assert.deepEqual(bare, { ok: true, files, revision: null });
  });

  it('passes on what the file parser refuses', async () => {
    const source = await resolvePublishSource(
      {},
      PROJECT,
      history({}),
      parseFiles,
    );
    assert.deepEqual(source, {
      ok: false,
      status: 400,
      error: '"files" is required.',
    });
  });
});

describe('the publish record', () => {
  it(`keeps the newest ${MAX_PUBLISHES} of each project, newest first`, async () => {
    const db = new SqliteD1Database(schemaSql());
    const now = new Date('2026-10-11T12:00:00.000Z');
    for (let n = 1; n <= MAX_PUBLISHES + 3; n += 1) {
      await recordPublish(db, {
        projectId: PROJECT,
        slug: 'bakery',
        revision: `r${n}`,
        generation: null,
        now,
      });
    }
    await recordPublish(db, {
      projectId: 'project-002',
      slug: 'florist',
      revision: 'r1',
      generation: null,
      now,
    });

    const listed = await listPublishes(db, PROJECT);
    assert.equal(listed.length, MAX_PUBLISHES);
    assert.equal(listed[0]!.revision, `r${MAX_PUBLISHES + 3}`);
    assert.equal(listed.at(-1)!.revision, 'r4');
    assert.deepEqual(await listPublishes(db, 'project-002'), [
      {
        revision: 'r1',
        slug: 'florist',
        publishedAt: now.toISOString(),
        generation: null,
      },
    ]);
  });
});
