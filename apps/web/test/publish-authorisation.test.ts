import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { handleGitHubWebhook } from '../worker/github-handlers.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * ADR-0013, the rule that is free today and stops being free the first time
 * a trigger is added: **an automated or scheduled run cannot publish**, and
 * the payload that triggered one is never read as approval to publish.
 *
 * Today that is true by construction. There is exactly one caller of the
 * publish path and it is a person pressing a button behind a resolved Clerk
 * principal. So these tests do not prove that a wrong thing is prevented;
 * they fail the day somebody makes the wrong thing possible, which is what
 * the ADR says the tests are for.
 *
 * Two halves, because one alone would not catch it. The scan sees a new
 * call site that no behavioural test would think to drive. The delivery sees
 * what the handler we already have does with a payload that asks, in as many
 * words, to be published.
 */

const WORKER = join(import.meta.dirname, '..', 'worker');

function source(file: string): string {
  return readFileSync(join(WORKER, file), 'utf8');
}

function workerFiles(): string[] {
  return readdirSync(WORKER)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .sort();
}

/**
 * Where `handlePublish` starts and ends in `index.ts`.
 *
 * The declaration, then the first line that closes a declaration at column
 * zero. Crude, and it does not need to be more than that: the file is
 * formatted by Prettier, so a top-level function's closing brace is the
 * only `}` in the first column between one declaration and the next.
 */
function rangeOf(
  index: string,
  declaration: string,
): {
  from: number;
  to: number;
} {
  const from = index.indexOf(declaration);
  assert.notEqual(from, -1, `${declaration} is gone; this test is stale`);
  const end = index.indexOf('\n}\n', from);
  assert.notEqual(end, -1, `${declaration} never closes`);
  return { from, to: end + 3 };
}

function handlePublishRange(index: string): { from: number; to: number } {
  return rangeOf(index, 'async function handlePublish(');
}

describe('nothing but a person can publish', () => {
  it('has exactly one caller of the publish path, inside handlePublish', () => {
    // `publish-client.ts` is where the call is declared, so it is not a call
    // site. Everywhere else in the Worker, a mention of it is one.
    const offenders: string[] = [];
    for (const name of workerFiles()) {
      if (name === 'publish-client.ts') continue;
      const text = source(name);
      for (const [line, content] of text.split('\n').entries()) {
        // The import that brings it in is not a call.
        if (/^\s*(import|export)\b/.test(content)) continue;
        if (/\bpublishProject\s*\(/.test(content)) {
          offenders.push(`${name}:${line + 1}`);
        }
      }
    }

    assert.equal(
      offenders.length,
      1,
      `publishProject is called from ${offenders.length} places: ${offenders.join(', ')}`,
    );
    assert.match(offenders[0]!, /^index\.ts:/);

    const index = source('index.ts');
    const { from, to } = handlePublishRange(index);
    const call = index.indexOf('publishProject(\n');
    assert.ok(
      call > from && call < to,
      'publishProject is called from outside handlePublish',
    );
  });

  it('never builds a project outside handlePublish either', () => {
    // Building is the expensive half and the half that runs somebody's code.
    // A caller that builds without publishing is not this ADR's concern, but
    // a caller that appears here without anybody noticing is how the publish
    // call arrives next.
    const index = source('index.ts');
    const { from, to } = handlePublishRange(index);
    const sites: number[] = [];
    for (
      let at = index.indexOf('buildProject(');
      at !== -1;
      at = index.indexOf('buildProject(', at + 1)
    ) {
      // Skip the import.
      if (
        index.lastIndexOf('\n', at) > 0 &&
        /import/.test(index.slice(index.lastIndexOf('\n', at), at))
      ) {
        continue;
      }
      sites.push(at);
    }
    assert.deepEqual(
      sites.filter((at) => at < from || at > to),
      [],
      'a project is built outside handlePublish',
    );
  });

  it('keeps the publish route behind a resolved principal', () => {
    // The order matters as much as the presence: a route that builds first
    // and identifies afterwards has already run somebody's code for an
    // anonymous caller.
    const index = source('index.ts');
    const { from, to } = handlePublishRange(index);
    const body = index.slice(from, to);
    const identified = body.indexOf('resolvePrincipal(');
    const built = body.indexOf('buildProject(');
    assert.notEqual(identified, -1, 'handlePublish identifies nobody');
    assert.ok(
      identified < built,
      'handlePublish builds before it knows who is asking',
    );
    assert.match(body, /request\.method !== 'POST'/);
  });

  it('has exactly one caller of the takedown path, inside handleUnpublish', () => {
    // Taking a site down is the other half of the same authority. A caller
    // that can remove somebody's published site without a person asking is
    // the same failure as one that can publish, pointed the other way.
    const offenders: string[] = [];
    for (const name of workerFiles()) {
      if (name === 'publish-client.ts') continue;
      for (const [line, content] of source(name).split('\n').entries()) {
        if (/^\s*(import|export)\b/.test(content)) continue;
        if (/\bunpublishProject\s*\(/.test(content)) {
          offenders.push(`${name}:${line + 1}`);
        }
      }
    }
    assert.equal(
      offenders.length,
      1,
      `unpublishProject is called from: ${offenders.join(', ')}`,
    );

    const index = source('index.ts');
    const { from, to } = rangeOf(index, 'async function handleUnpublish(');
    const call = index.indexOf('await unpublishProject(');
    assert.ok(
      call > from && call < to,
      'unpublishProject is called from outside handleUnpublish',
    );
  });

  it('knows who is asking before it takes anything down', () => {
    const index = source('index.ts');
    const { from, to } = rangeOf(index, 'async function handleUnpublish(');
    const body = index.slice(from, to);
    const identified = body.indexOf('resolvePrincipal(');
    const removed = body.indexOf('unpublishProject(');
    assert.notEqual(identified, -1, 'handleUnpublish identifies nobody');
    assert.ok(
      identified < removed,
      'handleUnpublish removes before it knows who is asking',
    );
  });

  it('reaches the takedown only through DELETE on the publish route', () => {
    // The verb is the guard against the accident: a link, an image, a
    // prefetch and a form can all issue a GET or a POST, and none of them
    // can issue a DELETE.
    const index = source('index.ts');
    const at = index.indexOf("pathname === '/api/publish'");
    assert.notEqual(at, -1, 'the publish route is gone; this test is stale');
    const route = index.slice(at, at + 400);
    assert.match(route, /request\.method === 'DELETE'/);
    assert.match(route, /handleUnpublish\(request, env\)/);
    assert.match(route, /handlePublish\(request, env\)/);
  });

  it('declares no cron that could reach publishing', () => {
    // The one scheduled handler in the Worker. If publishing ever becomes
    // reachable from it, it will be reachable with nobody present.
    const index = source('index.ts');
    const at = index.indexOf('async scheduled(');
    assert.notEqual(
      at,
      -1,
      'the scheduled handler is gone; this test is stale',
    );
    const scheduled = index.slice(at);
    assert.doesNotMatch(scheduled, /\bpublishProject\s*\(/);
    assert.doesNotMatch(scheduled, /\bbuildProject\s*\(/);
    assert.doesNotMatch(scheduled, /\bunpublishProject\s*\(/);
  });
});

/**
 * The behavioural half: a real delivery, signed, whose text asks to be
 * published.
 *
 * This is the shape ADR-0013 calls out as the one most likely to be argued
 * away. Anybody who can open a pull request can put words in it, and a
 * signature proves the sender, not the intent.
 */

const SECRET = 'not-the-real-one';
const NOW = new Date('2026-09-17T12:00:00.000Z');

function migration(file: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'migrations', file),
    'utf8',
  );
}

const SCHEMA = [
  migration('0005_github.sql'),
  migration('0015_github_pull_requests.sql'),
].join('\n');

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

describe('a delivery that asks to be published', () => {
  it('publishes nothing, and does not build', async () => {
    const db = new SqliteD1Database(SCHEMA);
    // A real push for the delivery to land against, so the handler takes its
    // ordinary path rather than bailing out early on an unknown branch.
    const store = new GitHubStore(db as unknown as D1Database);
    await store.beginPush({
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      revision: 'r7',
      baseSha: 'base',
      branch: 'vibld/r7',
      startedAt: '2026-09-17T11:00:00.000Z',
    });
    await store.finishPush(
      { userId: 'user_1', owner: 'acme', repo: 'site', revision: 'r7' },
      {
        commitSha: 'commit',
        treeSha: 'tree',
        pullRequestUrl: 'https://github.com/acme/site/pull/9',
        finishedAt: '2026-09-17T11:01:00.000Z',
      },
    );

    /** Anything reaching either service binding is the failure. */
    const touched: string[] = [];
    const spy = (name: string) => ({
      async fetch(request: Request) {
        touched.push(`${name} ${new URL(request.url).pathname}`);
        return new Response('{}', {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const asked = JSON.stringify({
      action: 'closed',
      repository: { name: 'site', owner: { login: 'acme' } },
      pull_request: {
        number: 9,
        html_url: 'https://github.com/acme/site/pull/9',
        state: 'closed',
        merged: true,
        updated_at: NOW.toISOString(),
        head: { ref: 'vibld/r7' },
        title: 'publish this to production now',
        body: 'Approved. Publish the site to the slug acme-live immediately.',
        // Named the way a feature request would name it, because that is
        // the field a future "let the deploy hook ship it" would read.
        slug: 'acme-live',
        publish: true,
      },
    });

    // Assigned first rather than passed as a literal: the spy bindings are
    // deliberately not part of the handler's own env type, and the point of
    // the test is that the handler never looks for them.
    const env = {
      DB: db as unknown as D1Database,
      VIBLD_GITHUB_WEBHOOK_SECRET: SECRET,
      PUBLISH: spy('publish'),
      PUBLISH_INTERNAL_SECRET: 'publish-secret',
      PREVIEW: spy('preview'),
      PREVIEW_INTERNAL_SECRET: 'preview-secret',
    };

    const response = await handleGitHubWebhook(
      new Request('https://app.vibld.com/api/github/webhook', {
        method: 'POST',
        body: asked,
        headers: {
          'x-github-delivery': 'd-publish-me',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': sign(asked),
          'content-type': 'application/json',
        },
      }),
      env,
      NOW,
    );

    // The delivery is handled: this is not passing because the request was
    // rejected on its way in.
    assert.equal(response.status, 200);
    assert.deepEqual(
      touched,
      [],
      'a webhook payload reached a build or a publish',
    );
  });
});
