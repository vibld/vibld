import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PublishStore } from '../worker/publish-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The real migrations, all of them, not a copy and not a chosen subset.
 *
 * This package binds the same D1 database apps/web migrates (ADR-0010). An
 * inline copy of the table drifts, which is what 0016_unpublish.sql's column
 * would have slipped past; naming the files drifts too, one migration later,
 * which is what 0018_operator_hold.sql's did. Reading the directory is the
 * same answer apps/web's own `schemaSql()` settled on, and for the same
 * reason: the fake gets exactly the schema the deployment gets, and adding a
 * migration needs no edit here.
 *
 * Ordering is the filename's numeric prefix, which is what
 * `wrangler d1 migrations apply` orders by.
 */
const MIGRATIONS = join(import.meta.dirname, '..', '..', 'web', 'migrations');
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

function newStore(): PublishStore {
  return new PublishStore(new SqliteD1Database(SCHEMA), new InMemoryR2Bucket());
}

describe('PublishStore', () => {
  it('has no slug for a project that has never published', async () => {
    const store = newStore();
    assert.equal(await store.slugForProject('proj-1'), undefined);
  });

  it('claims a free slug for a project', async () => {
    const store = newStore();
    const result = await store.claimSlug('acme', 'proj-1', 'user-1');
    assert.deepEqual(result, { claimed: true });
    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: true,
      state: 'live',
    });
    assert.deepEqual(await store.resolveSlug('acme'), {
      projectId: 'proj-1',
      userId: 'user-1',
    });
  });

  it('refuses to claim a slug another project already holds', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    const result = await store.claimSlug('acme', 'proj-2', 'user-2');
    assert.deepEqual(result, { claimed: false, reason: 'slug-taken' });
    // The original claim is untouched.
    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: true,
      state: 'live',
    });
  });

  it('lets the same project "reclaim" its own slug idempotently', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    const result = await store.claimSlug('acme', 'proj-1', 'user-1');
    assert.deepEqual(result, { claimed: true });
  });

  it('resolves an unclaimed slug to nothing', async () => {
    const store = newStore();
    assert.equal(await store.resolveSlug('nobody-here'), undefined);
  });

  it('stores and serves file content by slug and path', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>Hi</h1>' },
      { path: 'about.html', content: '<h1>About</h1>' },
    ]);

    assert.deepEqual(await store.getFile('acme', 'index.html'), {
      content: '<h1>Hi</h1>',
    });
    assert.deepEqual(await store.getFile('acme', 'about.html'), {
      content: '<h1>About</h1>',
    });
    assert.equal(await store.getFile('acme', 'missing.html'), undefined);
  });

  it("overwrites a slug's content on a later publish rather than appending", async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [{ path: 'index.html', content: 'v1' }]);
    await store.putFiles('acme', [{ path: 'index.html', content: 'v2' }]);
    assert.deepEqual(await store.getFile('acme', 'index.html'), {
      content: 'v2',
    });
  });

  it("does not leak one slug's files under a different slug", async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.claimSlug('beta', 'proj-2', 'user-2');
    await store.putFiles('acme', [
      { path: 'index.html', content: 'acme home' },
    ]);
    assert.equal(await store.getFile('beta', 'index.html'), undefined);
  });

  it('touch updates updated_at without changing the slug mapping', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.touch('acme');
    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: true,
      state: 'live',
    });
  });
});

/**
 * Taking a site down (ADR-0013).
 *
 * Until this existed there was no way off the web at all: `putFiles`
 * overwrites and `claimSlug` claims, and nothing removed either. A site
 * published by mistake, or one an operator has to pull, stayed up.
 */
describe('taking a published site down', () => {
  function stored(): { store: PublishStore; bucket: InMemoryR2Bucket } {
    const bucket = new InMemoryR2Bucket();
    return {
      store: new PublishStore(new SqliteD1Database(SCHEMA), bucket),
      bucket,
    };
  }

  it('stops the slug resolving for the public', async () => {
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);

    await store.unpublish('acme');

    assert.equal(await store.resolveSlug('acme'), undefined);
  });

  it('leaves the owner holding the name, marked as down', async () => {
    // The two readers diverge on purpose: the public one refuses it, the
    // owner's own lookup still finds it. That is what makes putting the
    // site back a republish rather than a race to re-claim the name.
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);

    await store.unpublish('acme');

    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: false,
      state: 'down',
    });
  });

  it('puts the site back when it is published again', async () => {
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
    await store.unpublish('acme');

    // What `handlePublish` does for a project that already holds a slug.
    await store.touch('acme');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>back</h1>' },
    ]);

    assert.deepEqual(await store.resolveSlug('acme'), {
      projectId: 'proj-1',
      userId: 'user-1',
    });
    assert.deepEqual(await store.getFile('acme', 'index.html'), {
      content: '<h1>back</h1>',
    });
  });

  it('removes the content, so nothing is left to serve', async () => {
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
      { path: 'about/index.html', content: '<h1>about</h1>' },
      { path: 'assets/app.css', content: 'body{}' },
    ]);

    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), [], 'bytes were left behind');
    assert.equal(await store.getFile('acme', 'index.html'), undefined);
  });

  it('deletes every page of objects, not just the first', async () => {
    // R2 lists with a cursor. A site with more files than one page holds
    // would otherwise be half removed, and the half left behind is content
    // nothing points at and nobody thinks to look for.
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles(
      'acme',
      Array.from({ length: 7 }, (_, index) => ({
        path: `page-${index}.html`,
        content: `<h1>${index}</h1>`,
      })),
    );

    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), []);
  });

  it("leaves another project's site alone", async () => {
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
    await store.claimSlug('acme-two', 'proj-2', 'user-2');
    await store.putFiles('acme-two', [
      { path: 'index.html', content: '<h1>two</h1>' },
    ]);

    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), ['published/acme-two/index.html']);
    assert.deepEqual(await store.resolveSlug('acme-two'), {
      projectId: 'proj-2',
      userId: 'user-2',
    });
  });

  it('does not hand the slug to the next project that asks', async () => {
    // ADR-0010 makes a slug a durable, semi-public identifier: somebody has
    // linked to it. Releasing it on takedown would serve the next claimant's
    // content at an address the previous owner advertised, which is worse
    // than a dead link and is the shape of a takeover. This is the reason
    // the row is marked rather than deleted.
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
    await store.unpublish('acme');

    const claim = await store.claimSlug('acme', 'proj-2', 'user-2');
    assert.deepEqual(claim, { claimed: false, reason: 'slug-taken' });
    assert.equal(await store.slugForProject('proj-2'), undefined);
  });

  it('stops deleting when the site comes back live under it', async () => {
    // A republish from another tab clears the tombstone and writes fresh
    // files. An unguarded delete loop would go on and remove them, leaving
    // D1 saying live and R2 holding nothing. Re-reading the stamp before
    // each batch is what stops the loop the moment that happens.
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles(
      'acme',
      Array.from({ length: 7 }, (_, index) => ({
        path: `page-${index}.html`,
        content: `<h1>${index}</h1>`,
      })),
    );

    // The republish lands after the first page of deletions: `list` is what
    // the loop calls each time round, so this is the seam to catch it on.
    let pages = 0;
    const realList = bucket.list.bind(bucket);
    bucket.list = async (options) => {
      const page = await realList(options);
      pages += 1;
      if (pages === 1) await store.touch('acme');
      return page;
    };

    await store.unpublish('acme');

    assert.ok(
      bucket.keys().length > 0,
      'it deleted the republished files anyway',
    );
    assert.deepEqual(await store.resolveSlug('acme'), {
      projectId: 'proj-1',
      userId: 'user-1',
    });
  });

  it('is safe to repeat after a crash between the two writes', async () => {
    // Content first, mapping second. A failure in between leaves a slug
    // resolving to nothing, which the public handler answers as a 404 and
    // which a second call finishes.
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);

    await store.unpublish('acme');
    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), []);
    assert.equal(await store.resolveSlug('acme'), undefined);
  });
});

/**
 * An operator taking somebody else's site off the web (#172).
 *
 * Not the owner takedown wearing a different hat. There the owner asked for
 * their own work to go and can put it back; here somebody else is being
 * stopped, and the thing that must not happen is the owner undoing it.
 */
describe('holding a site an operator did not publish', () => {
  function stored(): { store: PublishStore; bucket: InMemoryR2Bucket } {
    const bucket = new InMemoryR2Bucket();
    return {
      store: new PublishStore(new SqliteD1Database(SCHEMA), bucket),
      bucket,
    };
  }

  async function published(store: PublishStore): Promise<void> {
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
  }

  it('stops the slug resolving for the public', async () => {
    const { store } = stored();
    await published(store);

    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    assert.equal(await store.resolveSlug('acme'), undefined);
  });

  it('leaves the content in place, so a wrong hold can be undone', async () => {
    // Deleting is irreversible and destroys what was served before anybody
    // has looked at it. The harm is reachability, and the flag ends that.
    const { store, bucket } = stored();
    await published(store);

    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    assert.deepEqual(bucket.keys(), ['published/acme/index.html']);
  });

  it('cannot be lifted by the owner publishing again', async () => {
    // The rule the whole column exists for. `touch` is what clears an
    // owner's own takedown, and it must not clear this.
    const { store } = stored();
    await published(store);
    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    await store.touch('acme');

    assert.equal(
      await store.resolveSlug('acme'),
      undefined,
      'a republish lifted an operator hold',
    );
    assert.equal((await store.slugForProject('proj-1'))?.state, 'held');
  });

  it('tells the owner it is held, not merely down', async () => {
    // Otherwise they press Publish, get a refusal, and have no idea why.
    const { store } = stored();
    await published(store);
    await store.unpublish('acme');
    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    assert.equal((await store.slugForProject('proj-1'))?.state, 'held');
  });

  it('records who held it and why', async () => {
    const { store } = stored();
    await published(store);
    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    assert.deepEqual(await store.siteBySlug('acme'), {
      slug: 'acme',
      projectId: 'proj-1',
      userId: 'user-1',
      state: 'held',
      heldBy: 'admin@vibld.com',
      heldReason: 'phishing report 41',
    });
  });

  it('puts a released site back only if its owner had not taken it down', async () => {
    // Releasing returns the decision to whoever else has a say. For a site
    // the owner also took down, that is the owner.
    const { store } = stored();
    await published(store);
    await store.unpublish('acme');
    await store.hold('acme', 'admin@vibld.com', 'wrong report');

    await store.release('acme', 'admin@vibld.com');

    assert.equal(
      await store.resolveSlug('acme'),
      undefined,
      'releasing a hold republished a site its owner had taken down',
    );
    assert.equal((await store.slugForProject('proj-1'))?.state, 'down');
  });

  it('serves again once a hold on a live site is lifted', async () => {
    const { store } = stored();
    await published(store);
    await store.hold('acme', 'admin@vibld.com', 'wrong report');

    await store.release('acme', 'admin@vibld.com');

    assert.deepEqual(await store.resolveSlug('acme'), {
      projectId: 'proj-1',
      userId: 'user-1',
    });
  });

  it('keeps the record after the hold is lifted', async () => {
    // The columns are the current state, not a record. Releasing nulls all
    // three, so before the history table the ordinary hold-then-release
    // left no evidence the site had ever been taken down, by whom or why --
    // which contradicted the reason the columns were added.
    const { store } = stored();
    await published(store);
    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');
    await store.release('acme', 'someone.else@vibld.com');

    assert.deepEqual(
      (await store.holdHistory('acme')).map(({ action, actor, reason }) => ({
        action,
        actor,
        ...(reason === undefined ? {} : { reason }),
      })),
      [
        {
          action: 'held',
          actor: 'admin@vibld.com',
          reason: 'phishing report 41',
        },
        { action: 'released', actor: 'someone.else@vibld.com' },
      ],
    );
    // And the live columns really are clear, so this is a record rather than
    // the state not having been cleared.
    assert.equal((await store.siteBySlug('acme'))?.state, 'live');
  });

  it('changes nothing when the record cannot be written', async () => {
    // The flag and the record of who set it are two rows. Written
    // separately, a failure between them leaves the flag changed and the
    // record lost -- and on the release path that is a site back on the web
    // with nobody recorded as having put it there, and a retry refused
    // because it is no longer held.
    //
    // The db here fails every batch. If either write happened outside one,
    // it would have landed and this would see it.
    const bucket = new InMemoryR2Bucket();
    const real = new SqliteD1Database(SCHEMA);
    const brittle = {
      prepare: real.prepare.bind(real),
      batch: async () => {
        throw new Error('D1 fell over');
      },
    };
    const store = new PublishStore(real, bucket);
    await published(store);
    const guarded = new PublishStore(brittle, bucket);

    await assert.rejects(() =>
      guarded.hold('acme', 'admin@vibld.com', 'phishing report 41'),
    );
    assert.equal(
      (await store.siteBySlug('acme'))?.state,
      'live',
      'the hold landed without its record',
    );
    assert.deepEqual(await store.holdHistory('acme'), []);

    // And the same on the way back out.
    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');
    await assert.rejects(() => guarded.release('acme', 'admin@vibld.com'));
    assert.equal(
      (await store.siteBySlug('acme'))?.state,
      'held',
      'the release landed without its record',
    );
  });

  it('rolls a batch back when a later statement fails', async () => {
    // The test above makes `batch` itself throw, which never reaches the
    // fake's rollback. That leaves the primitive the store now depends on
    // untested, and a fake that committed a half-batch would let a future
    // test pass against exactly the bug the batch exists to prevent.
    //
    // So this drives the real thing: a good insert followed by one that
    // violates NOT NULL.
    const db = new SqliteD1Database(SCHEMA);
    await assert.rejects(() =>
      db.batch([
        db
          .prepare(
            `INSERT INTO published_site_holds (slug, action, actor, reason, at)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          )
          .bind('acme', 'held', 'admin@vibld.com', 'a reason', 'now'),
        db
          .prepare(
            `INSERT INTO published_site_holds (slug, action, actor, reason, at)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          )
          .bind('acme', null, 'admin@vibld.com', null, 'now'),
      ]),
    );

    const left = await db
      .prepare(`SELECT COUNT(*) AS n FROM published_site_holds`)
      .first<{ n: number }>();
    assert.equal(left?.n, 0, 'half the batch was committed');
  });

  it('refuses a takedown decided before the hold landed', async () => {
    // The handler reads the state and then asks for the deletion, which is
    // two round trips. A hold placed in between finds the read already
    // past, so a refusal that lived in the handler would be one an owner
    // could beat by timing -- and the prize for beating it is erasing what
    // the hold is keeping.
    //
    // This is that interleaving: the decision is taken against a live site
    // and the call arrives after the hold. It has to be refused anyway,
    // which only the UPDATE can do.
    const { store, bucket } = stored();
    await published(store);
    const live = await store.slugForProject('proj-1');
    assert.equal(live?.state, 'live', 'the read this test is about');

    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    assert.equal(await store.unpublish('acme'), false);
    assert.ok(bucket.keys().length > 0, 'the owner emptied a held site');
    assert.equal((await store.siteBySlug('acme'))?.state, 'held');
  });

  it('stops deleting when a hold lands partway through', async () => {
    // The same race one step later: the UPDATE won, and the hold arrives
    // while R2 is still being paged. Whatever is left is what the hold is
    // for, so the loop stops rather than finishing the job.
    //
    // `list` is the seam, because it is what the loop calls each time round.
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
      { path: 'about.html', content: '<h1>about</h1>' },
    ]);

    let pages = 0;
    const realList = bucket.list.bind(bucket);
    bucket.list = async (options) => {
      pages += 1;
      if (pages === 1) {
        await store.hold('acme', 'admin@vibld.com', 'phishing report 41');
      }
      return realList(options);
    };

    await store.unpublish('acme');

    assert.ok(
      bucket.keys().length > 0,
      'it emptied the site the hold had just claimed',
    );
  });

  it('keeps every hold, not just the last one', async () => {
    const { store } = stored();
    await published(store);
    await store.hold('acme', 'a@vibld.com', 'first report');
    await store.release('acme', 'a@vibld.com');
    await store.hold('acme', 'b@vibld.com', 'second report');

    const history = await store.holdHistory('acme');
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((entry) => entry.action),
      ['held', 'released', 'held'],
    );
    assert.equal(history[0]?.reason, 'first report');
    assert.equal(history[2]?.reason, 'second report');
  });

  it('leaves another site alone', async () => {
    const { store } = stored();
    await published(store);
    await store.claimSlug('acme-two', 'proj-2', 'user-2');
    await store.putFiles('acme-two', [
      { path: 'index.html', content: '<h1>two</h1>' },
    ]);

    await store.hold('acme', 'admin@vibld.com', 'phishing report 41');

    assert.deepEqual(await store.resolveSlug('acme-two'), {
      projectId: 'proj-2',
      userId: 'user-2',
    });
  });
});
