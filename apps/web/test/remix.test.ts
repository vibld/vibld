import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEDIA_ACCOUNT_MAX_FILES,
  mediaObjectKey,
  referencedMedia,
} from '@vibld/core';
import type { ProjectSnapshot, TranscriptTurn } from '@vibld/core';

import { handleProjects } from '../worker/project-handlers.ts';
import type { ProjectsDeps } from '../worker/project-handlers.ts';
import { D1GenerationStore } from '../worker/generation-store.ts';
import { MediaStore } from '../worker/media-store.ts';
import type { CopyableMedia } from '../worker/media-store.ts';
import { planMediaCopy } from '../worker/media-copy.ts';
import { handleShare } from '../worker/share-handlers.ts';
import type { ShareDeps } from '../worker/share-handlers.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import type { Tier } from '../worker/entitlement.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Remixing a shared project into your own account (docs/decisions.md,
 * "Resolved 2026-09-28", sharing and the media library).
 *
 * In the order somebody would notice them broken: a remix is a new project
 * of yours with the code and settings and none of the conversation; it is
 * held to the free tier's limit; the media its code uses comes with it, so
 * nothing about it depends on the original owner's library afterwards; a
 * name clash in your library renames the copy and the code with it; a
 * library with no room refuses the remix whole; and within one account
 * nothing is copied at all.
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const BOB = 'user_bob0000000000000000000002';

interface World {
  db: SqliteD1Database;
  bucket: InMemoryR2Bucket;
  tiers: Map<string, Tier>;
  owner(
    user: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, any> }>;
  remix(
    user: string | null,
    token: string,
  ): Promise<{ status: number; body: Record<string, any> }>;
}

function world(): World {
  const db = new SqliteD1Database(schemaSql());
  const bucket = new InMemoryR2Bucket();
  const tiers = new Map<string, Tier>();
  const now = new Date('2026-09-28T12:00:00.000Z');
  let ids = 0;
  const newId = () => `id-${String((ids += 1)).padStart(3, '0')}`;
  const principal = (user: string) => async () =>
    ({ denied: null, principal: { userId: user } }) as PrincipalGranted;
  const links = { origin: ORIGIN, publishHostname: 'vibld-preview.dev' };
  return {
    db,
    bucket,
    tiers,
    async owner(user, method, path, body) {
      const deps: ProjectsDeps = {
        resolvePrincipal: principal(user),
        now: () => now,
        newId,
        tierOf: async (who) => tiers.get(who) ?? 'free',
        links,
      };
      const response = await handleProjects(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers:
            body !== undefined
              ? { 'content-type': 'application/json', origin: ORIGIN }
              : {},
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps,
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
    async remix(user, token) {
      const deps: ShareDeps = {
        resolvePrincipal: user
          ? principal(user)
          : async () => ({
              denied: new Response('{"error":"Sign in."}', { status: 401 }),
            }),
        preview: null,
        links,
        now: () => now,
        newId,
        tierOf: async (who) => tiers.get(who) ?? 'free',
      };
      const response = await handleShare(
        new Request(`${ORIGIN}/api/share/${token}/remix`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: '{}',
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps,
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
  };
}

const PAGE = `export default function App() {
  return (
    <main>
      <img src="/media/hero.jpg" alt="" />
      <video src="/media/loop.mp4" />
    </main>
  );
}`;

async function build(w: World, projectId: string, content = PAGE) {
  const store = new D1GenerationStore(w.db, w.bucket);
  const runId = `run-${projectId}`;
  await store.saveStage({
    runId,
    projectId,
    baseRevision: null,
    state: 'validating',
  });
  const promoted = await store.promote(projectId, runId, null, {
    revision: 'r1',
    files: [{ path: 'src/App.tsx', content }],
  });
  assert.ok(promoted.promoted);
}

/** A file in somebody's library, bytes and row. */
async function upload(
  w: World,
  user: string,
  path: string,
  bytes: string,
  options: { id?: string; kind?: 'image' | 'video'; bytesCount?: number } = {},
) {
  const data = new TextEncoder().encode(bytes);
  const added = await new MediaStore(w.db, w.bucket).add(
    user,
    { maxFiles: 1000, maxBytes: 1e12 },
    {
      id: options.id ?? `${user}-${path}`,
      path,
      kind: options.kind ?? 'image',
      contentType: options.kind === 'video' ? 'video/mp4' : 'image/jpeg',
      bytes: data.buffer.slice(0) as ArrayBuffer,
      sha256: `sha-${bytes}`,
      gitSha: `git-${bytes}`,
      alt: `alt for ${path}`,
      createdAt: '2026-09-27T00:00:00.000Z',
    },
  );
  assert.ok(added, `could not upload ${path}`);
  return added!;
}

async function sharedProject(w: World, user = ALICE) {
  const made = await w.owner(user, 'POST', '/api/projects', {
    name: 'Bakery',
    settings: { style: null, referenceUrl: 'https://example.com/' },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.project.id as string;
  await build(w, id);
  const on = await w.owner(user, 'POST', `/api/projects/${id}/share`, {});
  const url = on.body.project.share.url as string;
  return { id, token: url.slice(`${ORIGIN}/s/`.length) };
}

async function openAs(w: World, user: string, id: string) {
  const opened = await w.owner(user, 'GET', `/api/projects/${id}`);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  return opened.body as {
    project: Record<string, any>;
    transcript: TranscriptTurn[];
    snapshot: ProjectSnapshot | null;
  };
}

async function libraryOf(w: World, user: string) {
  return new MediaStore(w.db, w.bucket).copyable(user);
}

describe('a remix', () => {
  it("is a new project of the remixer's, with the code and settings and no conversation", async () => {
    const w = world();
    const { id, token } = await sharedProject(w);
    await w.owner(ALICE, 'PATCH', `/api/projects/${id}`, {
      transcript: [
        {
          id: 1,
          runId: 'run-1',
          prompt: 'something private',
          at: 1_790_000_000_000,
          status: 'accepted',
          agentMessage: null,
          summary: 'Built it.',
          fileCount: 1,
          revision: 'r1',
          problem: null,
          providerId: 'remote',
        },
      ],
    });

    const remixed = await w.remix(BOB, token);
    assert.equal(remixed.status, 201, JSON.stringify(remixed.body));
    assert.equal(remixed.body.project.name, 'Remix of Bakery');
    // Not shared, and not published: a remix starts private.
    assert.deepEqual(remixed.body.project.share, {
      on: false,
      url: null,
      held: false,
    });
    assert.equal(remixed.body.project.site, null);

    const copy = await openAs(w, BOB, remixed.body.project.id);
    assert.equal(copy.snapshot?.revision, 'r1');
    assert.equal(copy.snapshot?.files[0]?.path, 'src/App.tsx');
    assert.equal(copy.project.settings.referenceUrl, 'https://example.com/');
    assert.deepEqual(copy.transcript, []);

    // Bob's, and only Bob's.
    assert.equal(
      (await w.owner(ALICE, 'GET', `/api/projects/${remixed.body.project.id}`))
        .status,
      404,
    );
    // The original is untouched.
    const original = await openAs(w, ALICE, id);
    assert.equal(original.transcript.length, 1);
  });

  it('needs somebody signed in', async () => {
    const w = world();
    const { token } = await sharedProject(w);
    const remixed = await w.remix(null, token);
    assert.equal(remixed.status, 401);
  });

  it('is refused for a dead link', async () => {
    const w = world();
    const { id, token } = await sharedProject(w);
    await w.owner(ALICE, 'DELETE', `/api/projects/${id}/share`);
    const remixed = await w.remix(BOB, token);
    assert.equal(remixed.status, 404);
  });

  it("is held to the free tier's limit on active projects", async () => {
    const w = world();
    const { token } = await sharedProject(w);
    for (const name of ['One', 'Two', 'Three']) {
      const made = await w.owner(BOB, 'POST', '/api/projects', { name });
      assert.equal(made.status, 201);
    }
    await upload(w, ALICE, 'media/hero.jpg', 'HERO');

    const refused = await w.remix(BOB, token);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'project-limit');
    assert.equal(refused.body.limit, 3);
    const listed = await w.owner(BOB, 'GET', '/api/projects');
    assert.equal(listed.body.projects.length, 3);
    // Nothing was copied into a library for a remix that did not happen.
    assert.deepEqual(await libraryOf(w, BOB), []);

    // A paid plan has no limit.
    w.tiers.set(BOB, 'build');
    assert.equal((await w.remix(BOB, token)).status, 201);
  });
});

describe('the media a remix uses', () => {
  it("is copied into the remixer's library, and only what the code uses", async () => {
    const w = world();
    const { token } = await sharedProject(w);
    const hero = await upload(w, ALICE, 'media/hero.jpg', 'HERO');
    await upload(w, ALICE, 'media/loop.mp4', 'LOOP', { kind: 'video' });
    await upload(w, ALICE, 'media/unused.png', 'UNUSED');

    const remixed = await w.remix(BOB, token);
    assert.equal(remixed.status, 201, JSON.stringify(remixed.body));

    const bobs = await libraryOf(w, BOB);
    assert.deepEqual(bobs.map((entry) => entry.path).sort(), [
      'media/hero.jpg',
      'media/loop.mp4',
    ]);
    const copied = bobs.find((entry) => entry.path === 'media/hero.jpg')!;
    assert.notEqual(copied.id, hero.id);
    assert.equal(copied.sha256, 'sha-HERO');
    assert.equal(copied.alt, 'alt for media/hero.jpg');
    const bytes = await w.bucket.get(mediaObjectKey(BOB, copied.id));
    assert.equal(await bytes?.text(), 'HERO');

    // Alice's library is exactly as it was.
    assert.equal((await libraryOf(w, ALICE)).length, 3);
  });

  it('keeps working after the original owner deletes their files', async () => {
    const w = world();
    const { token } = await sharedProject(w);
    const hero = await upload(w, ALICE, 'media/hero.jpg', 'HERO');
    await w.remix(BOB, token);

    assert.ok(await new MediaStore(w.db, w.bucket).remove(ALICE, hero.id));
    const copied = (await libraryOf(w, BOB)).find(
      (entry) => entry.path === 'media/hero.jpg',
    )!;
    const bytes = await w.bucket.get(mediaObjectKey(BOB, copied.id));
    assert.equal(await bytes?.text(), 'HERO');
  });

  it('reuses a file the remixer already has, byte for byte', async () => {
    const w = world();
    const { token } = await sharedProject(w);
    await upload(w, ALICE, 'media/hero.jpg', 'HERO');
    const mine = await upload(w, BOB, 'media/hero.jpg', 'HERO');

    const remixed = await w.remix(BOB, token);
    assert.equal(remixed.status, 201);
    const bobs = await libraryOf(w, BOB);
    assert.deepEqual(
      bobs.map((entry) => [entry.path, entry.id]),
      [['media/hero.jpg', mine.id]],
    );
    const copy = await openAs(w, BOB, remixed.body.project.id);
    assert.equal(copy.snapshot?.files[0]?.content, PAGE);
  });

  it("stores a clashing file under a free name, and the remix's code uses it", async () => {
    const w = world();
    const { token } = await sharedProject(w);
    await upload(w, ALICE, 'media/hero.jpg', 'ALICE-HERO');
    await upload(w, BOB, 'media/hero.jpg', 'BOB-HERO');

    const remixed = await w.remix(BOB, token);
    assert.equal(remixed.status, 201, JSON.stringify(remixed.body));
    const bobs = await libraryOf(w, BOB);
    const renamed = bobs.find((entry) => entry.path === 'media/hero-2.jpg');
    assert.ok(renamed, JSON.stringify(bobs));
    assert.equal(renamed.sha256, 'sha-ALICE-HERO');
    // Bob's own file is still his, under its own name.
    assert.equal(
      bobs.find((entry) => entry.path === 'media/hero.jpg')?.sha256,
      'sha-BOB-HERO',
    );

    const copy = await openAs(w, BOB, remixed.body.project.id);
    const code = copy.snapshot!.files[0]!.content;
    assert.match(code, /src="\/media\/hero-2\.jpg"/);
    assert.deepEqual(referencedMedia(copy.snapshot!.files), [
      'media/hero-2.jpg',
      'media/loop.mp4',
    ]);
    // Only the remix's code: the original still names its own file.
    const original = await w.owner(
      ALICE,
      'GET',
      `/api/projects/${(await w.owner(ALICE, 'GET', '/api/projects')).body.projects[0].id}`,
    );
    assert.match(original.body.snapshot.files[0].content, /\/media\/hero\.jpg/);
  });

  it('refuses a remix whose media would not fit, whole', async () => {
    const w = world();
    const { token } = await sharedProject(w);
    await upload(w, ALICE, 'media/hero.jpg', 'HERO');
    // Bob's library is full.
    for (let n = 0; n < MEDIA_ACCOUNT_MAX_FILES; n += 1) {
      await upload(w, BOB, `media/mine-${n}.jpg`, `MINE-${n}`);
    }

    const refused = await w.remix(BOB, token);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'media-room');
    assert.match(refused.body.error, /media library/);
    // No project was made, and nothing was copied.
    const listed = await w.owner(BOB, 'GET', '/api/projects');
    assert.equal(listed.body.projects.length, 0);
    assert.equal((await libraryOf(w, BOB)).length, MEDIA_ACCOUNT_MAX_FILES);
  });

  it('copies nothing when the remix is into the same account', async () => {
    const w = world();
    const { token } = await sharedProject(w);
    await upload(w, ALICE, 'media/hero.jpg', 'HERO');
    const remixed = await w.remix(ALICE, token);
    assert.equal(remixed.status, 201);
    assert.equal((await libraryOf(w, ALICE)).length, 1);
  });
});

describe('planning a media copy', () => {
  const entry = (over: Partial<CopyableMedia>): CopyableMedia => ({
    id: 'm1',
    path: 'media/hero.jpg',
    kind: 'image',
    contentType: 'image/jpeg',
    bytes: 10,
    sha256: 'a',
    gitSha: 'g',
    alt: '',
    posterId: null,
    ...over,
  });
  const snapshot = (
    content: string,
    extra: string[] = [],
  ): ProjectSnapshot => ({
    revision: 'r1',
    files: [
      { path: 'src/App.tsx', content },
      ...extra.map((path) => ({ path, content: 'x' })),
    ],
  });

  it("brings a video's poster with it", () => {
    const plan = planMediaCopy(
      snapshot('<video src="/media/loop.mp4">'),
      [
        entry({
          id: 'v',
          path: 'media/loop.mp4',
          kind: 'video',
          posterId: 'p',
        }),
        entry({ id: 'p', path: 'media/poster.jpg' }),
      ],
      [],
    );
    assert.deepEqual(plan.copy.map((item) => item.path).sort(), [
      'media/loop.mp4',
      'media/poster.jpg',
    ]);
    assert.equal(plan.bytes, 20);
  });

  it('leaves out a file the project ships itself', () => {
    const plan = planMediaCopy(
      snapshot('<img src="/media/hero.jpg">', ['public/media/hero.jpg']),
      [entry({})],
      [],
    );
    assert.deepEqual(plan.copy, []);
  });

  it('never renames onto a name another copy in the same remix took', () => {
    const plan = planMediaCopy(
      snapshot('<img src="/media/hero.jpg"><img src="/media/hero-2.jpg">'),
      [
        entry({ id: 'a', path: 'media/hero.jpg', sha256: 'a' }),
        entry({ id: 'b', path: 'media/hero-2.jpg', sha256: 'b' }),
      ],
      [entry({ id: 'mine', path: 'media/hero.jpg', sha256: 'z' })],
    );
    const paths = plan.copy.map((item) => item.path);
    assert.equal(new Set(paths).size, paths.length, paths.join(', '));
    assert.equal(plan.renames.get('media/hero.jpg'), 'media/hero-3.jpg');
  });
});
