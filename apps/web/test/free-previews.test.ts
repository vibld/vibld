import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { previewStatus, startPreview } from '../worker/preview-client.ts';
import type { ServiceBinding } from '../worker/preview-client.ts';
import { freePreviewFor } from '../worker/spendable.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * apps/web's half of D158's preview limits: it says which previews are a
 * Free account's, and `@vibld/preview` holds them to the day and keeps
 * them out of the containers reserved for paid plans.
 */
const BILLING = { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' };
const NOW = new Date().toISOString();

function db(): D1Database {
  return new SqliteD1Database(schemaSql()) as unknown as D1Database;
}

async function subscribe(database: D1Database, userId: string): Promise<void> {
  await database
    .prepare(
      `INSERT INTO billing_subscriptions
         (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
          price_id, current_period_end, cancel_at_period_end, created_at,
          updated_at)
       VALUES ('sub_1', ?1, 'cus_1', 'build', 'active', 'price_build', NULL, 0, ?2, ?2)`,
    )
    .bind(userId, NOW)
    .run();
}

describe('freePreviewFor (D158)', () => {
  it('is Free for an account with no plan, where plans are sold', async () => {
    assert.equal(
      await freePreviewFor({ ...BILLING, DB: db() }, 'user_a'),
      true,
    );
  });

  it('is not Free on a paid plan', async () => {
    const database = db();
    await subscribe(database, 'user_a');
    assert.equal(
      await freePreviewFor({ ...BILLING, DB: database }, 'user_a'),
      false,
    );
  });

  it('is not Free where the deployment sells no plans', async () => {
    assert.equal(await freePreviewFor({ DB: db() }, 'user_a'), false);
  });

  it('is Free when the plan cannot be read', async () => {
    const broken = {
      prepare() {
        throw new Error('D1 is down');
      },
    } as unknown as D1Database;
    const realError = console.error;
    console.error = () => {};
    try {
      assert.equal(
        await freePreviewFor({ ...BILLING, DB: broken }, 'user_a'),
        true,
      );
    } finally {
      console.error = realError;
    }
  });
});

describe('startPreview (D158)', () => {
  function binding(): { binding: ServiceBinding; bodies: unknown[] } {
    const bodies: unknown[] = [];
    return {
      binding: {
        fetch: async (request: Request) => {
          bodies.push(await request.json());
          return new Response(JSON.stringify({ status: 'installing' }));
        },
      },
      bodies,
    };
  }

  it('says Free only when asked to', async () => {
    const { binding: PREVIEW, bodies } = binding();
    const env = { PREVIEW, PREVIEW_INTERNAL_SECRET: 's' };
    await startPreview(env, 'user_a', []);
    await startPreview(env, 'user_a', [], undefined, undefined, true);
    assert.equal((bodies[0] as { free?: unknown }).free, undefined);
    assert.equal((bodies[1] as { free?: unknown }).free, true);
  });

  it("polls with the plan as it is now, and the owner's account (#376 review)", async () => {
    const urls: string[] = [];
    const env = {
      PREVIEW: {
        fetch: async (request: Request) => {
          urls.push(request.url);
          return new Response(
            JSON.stringify({ status: 'queued', position: 0 }),
          );
        },
      },
      PREVIEW_INTERNAL_SECRET: 's',
    };
    await previewStatus(env, 'share_key');
    await previewStatus(env, 'share_key', { free: true, account: 'user_a' });
    const [bare, planned] = urls.map((url) => new URL(url).searchParams);
    assert.equal(bare!.get('free'), null);
    assert.equal(planned!.get('userId'), 'share_key');
    assert.equal(planned!.get('free'), 'true');
    assert.equal(planned!.get('account'), 'user_a');

    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );
    assert.match(
      source,
      /previewStatus\(env, principal\.userId, \{\s*free: await freePreviewFor\(env, principal\.userId\),\s*account: principal\.userId,?\s*\}\)/,
    );
    assert.match(
      source,
      /previewStatus\(env, key, \{ free, account: mediaOwner \}\)/,
    );
  });

  it('is asked for both the builder and a shared project, by the owner', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );
    assert.match(source, /freePreviewFor\(env, principal\.userId\)/);
    assert.match(source, /freePreviewFor\(env, mediaOwner\)/);
  });
});
