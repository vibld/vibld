import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { SECURITY_HEADERS } from '@vibld/security-headers';

import { VOTABLE_IDS } from '../app/roadmap.ts';
import worker, { type Env } from '../worker/index.ts';
import { handleRoadmapVote } from '../worker/roadmap-api.ts';
import {
  countHit,
  readBoard,
  sweep,
  todaysSalt,
  toggleVote,
} from '../worker/roadmap-store.ts';
import {
  MAX_VOTE_BODY_BYTES,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  ROADMAP_TURNSTILE_ACTION,
  VOTER_COOKIE,
  VOTER_COOKIE_MAX_AGE,
  checkRefusal,
  countsFor,
  ipHash,
  itemRefusal,
  newVoterId,
  originRefusal,
  parseVoteRequest,
  rateRefusal,
  rateWindowStart,
  readCookie,
  saltDay,
  sha256Hex,
  voterCookie,
  voterHash,
  voterIdFrom,
  votedFor,
} from '../worker/roadmap.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The roadmap's Worker side: the pure decisions in worker/roadmap.ts, the
 * store against real SQLite running the real migration, and the two
 * endpoints through the Worker's own `fetch`, so the routing, the security
 * headers and the no-store headers are what a browser would get.
 *
 * Nothing here reaches Cloudflare: Turnstile's siteverify is `fetch`, and
 * every test that gets that far replaces it.
 */

const ORIGIN = 'https://vibld.com';
const IP = '203.0.113.7';
const SECRET = 'turnstile-test-secret';

afterEach(() => {
  mock.restoreAll();
});

function voteRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/api/roadmap/vote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: ORIGIN,
      'cf-connecting-ip': IP,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function votesRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/roadmap/votes`, { headers });
}

/** Siteverify, answering as Cloudflare would for a token from this site. */
function passTurnstile(overrides: Record<string, unknown> = {}) {
  return mock.method(globalThis, 'fetch', async () =>
    Response.json({
      success: true,
      action: ROADMAP_TURNSTILE_ACTION,
      hostname: 'vibld.com',
      ...overrides,
    }),
  );
}

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const value = readCookie(header.split(';')[0] ?? '', VOTER_COOKIE);
  assert.ok(value, `no voter cookie in ${JSON.stringify(header)}`);
  return `${VOTER_COOKIE}=${value}`;
}

function env(db = new SqliteD1Database(), extra: Partial<Env> = {}): Env {
  return { ROADMAP_DB: db, TURNSTILE_SECRET_KEY: SECRET, ...extra };
}

describe('which ids a vote may name', () => {
  it('accepts an item that has not shipped', () => {
    assert.equal(itemRefusal('figma-import'), null);
  });

  it('refuses one that was never on the roadmap', () => {
    assert.deepEqual(itemRefusal('world-peace'), {
      status: 404,
      error: 'unknown-item',
    });
    // Near misses too: nothing is trimmed or case-folded into a match.
    assert.equal(itemRefusal(' figma-import')?.status, 404);
    assert.equal(itemRefusal('Figma-Import')?.status, 404);
  });

  it('refuses a shipped one', () => {
    assert.deepEqual(itemRefusal('style-presets'), {
      status: 409,
      error: 'shipped-item',
    });
  });
});

describe('reading a vote request', () => {
  it('takes an id and an optional token', async () => {
    assert.deepEqual(await parseVoteRequest(voteRequest({ id: 'cli-sync' })), {
      ok: true,
      body: { id: 'cli-sync', turnstile: '' },
    });
    assert.deepEqual(
      await parseVoteRequest(voteRequest({ id: 'cli-sync', turnstile: 't' })),
      { ok: true, body: { id: 'cli-sync', turnstile: 't' } },
    );
  });

  it('takes JSON only, which a cross-site form cannot send', async () => {
    const result = await parseVoteRequest(
      voteRequest('id=cli-sync', {
        'content-type': 'application/x-www-form-urlencoded',
      }),
    );
    assert.deepEqual(result, {
      ok: false,
      status: 415,
      error: 'unsupported-media-type',
    });
  });

  it('refuses a body larger than a vote can be', async () => {
    const big = { id: 'cli-sync', turnstile: 'x'.repeat(MAX_VOTE_BODY_BYTES) };
    const result = await parseVoteRequest(voteRequest(big));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 413);
  });

  it('refuses anything that is not an object with a string id', async () => {
    for (const body of [
      'not json',
      '[]',
      'null',
      '"cli-sync"',
      '{}',
      '{"id": 7}',
      '{"id": ""}',
      '{"id": "cli-sync", "turnstile": 5}',
    ]) {
      const result = await parseVoteRequest(voteRequest(body));
      assert.deepEqual(
        result,
        { ok: false, status: 400, error: 'invalid-body' },
        body,
      );
    }
  });

  it('refuses a request sent from another origin', () => {
    assert.equal(originRefusal(voteRequest({})), null);
    assert.deepEqual(
      originRefusal(voteRequest({}, { origin: 'https://evil.example' })),
      { status: 403, error: 'bad-origin' },
    );
  });
});

describe('the voter cookie and its hash', () => {
  it('is a 43-character base64url id from 32 random bytes', () => {
    const id = newVoterId();
    assert.match(id, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(newVoterId(), id);
    assert.equal(
      newVoterId(() => new Uint8Array(32).fill(255)),
      '_'.repeat(42) + '8',
    );
  });

  it('is HttpOnly, Secure, SameSite=Lax, host-only and long-lived', () => {
    const cookie = voterCookie('a'.repeat(43));
    const parts = cookie.split('; ');
    assert.equal(parts[0], `${VOTER_COOKIE}=${'a'.repeat(43)}`);
    assert.ok(VOTER_COOKIE.startsWith('__Host-'));
    assert.ok(parts.includes('HttpOnly'));
    assert.ok(parts.includes('Secure'));
    assert.ok(parts.includes('SameSite=Lax'));
    assert.ok(parts.includes('Path=/'));
    assert.ok(parts.includes(`Max-Age=${VOTER_COOKIE_MAX_AGE}`));
    assert.ok(VOTER_COOKIE_MAX_AGE >= 365 * 24 * 60 * 60);
    assert.ok(!/domain=/i.test(cookie), 'a __Host- cookie names no Domain');
  });

  it('is read from a Cookie header among others', () => {
    const id = 'b'.repeat(43);
    assert.equal(
      readCookie(`a=1; ${VOTER_COOKIE}=${id}; c=x=y`, VOTER_COOKIE),
      id,
    );
    assert.equal(readCookie('c=x=y', 'c'), 'x=y');
    assert.equal(readCookie('', VOTER_COOKIE), null);
    assert.equal(readCookie(null, VOTER_COOKIE), null);
  });

  it('is ignored when it is not the shape the Worker makes', () => {
    const request = (value: string) =>
      votesRequest({ cookie: `${VOTER_COOKIE}=${value}` });
    assert.equal(voterIdFrom(request('short')), null);
    assert.equal(voterIdFrom(request(`${'a'.repeat(42)}!`)), null);
    assert.equal(voterIdFrom(request('a'.repeat(43))), 'a'.repeat(43));
  });

  it('is stored as a SHA-256, never as itself', async () => {
    assert.equal(
      await sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const id = newVoterId();
    const hash = await voterHash(id);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, await sha256Hex(id), 'the hash is domain-separated');
  });
});

describe('rate limiting, by a hashed address', () => {
  it('counts in fixed ten-minute windows', () => {
    const now = Date.UTC(2026, 8, 27, 12, 34, 56);
    assert.equal(rateWindowStart(now), Date.UTC(2026, 8, 27, 12, 30));
    assert.equal(RATE_WINDOW_MS, 600_000);
  });

  it('allows the limit and refuses the vote after it, saying when to retry', () => {
    const now = Date.UTC(2026, 8, 27, 12, 34, 0);
    assert.equal(rateRefusal(RATE_LIMIT, now), null);
    assert.deepEqual(rateRefusal(RATE_LIMIT + 1, now), {
      status: 429,
      error: 'rate-limited',
      retryAfter: 360,
    });
  });

  it('hashes an address differently under each day’s salt', async () => {
    const one = await ipHash(IP, 'salt-one');
    assert.match(one, /^[0-9a-f]{64}$/);
    assert.notEqual(one, await ipHash(IP, 'salt-two'));
    assert.notEqual(one, await ipHash('203.0.113.8', 'salt-one'));
    assert.ok(!one.includes(IP));
  });

  it('keeps one salt a day and deletes the day before’s', async () => {
    const db = new SqliteD1Database();
    const monday = Date.UTC(2026, 8, 28, 1);
    const salt = await todaysSalt(db, monday);
    assert.equal(await todaysSalt(db, monday + 3_600_000), salt);
    const tuesday = await todaysSalt(db, monday + 24 * 3_600_000);
    assert.notEqual(tuesday, salt);
    assert.deepEqual(
      db.rows<{ day: string }>('SELECT day FROM roadmap_salts'),
      [{ day: saltDay(monday + 24 * 3_600_000) }],
    );
  });

  it('counts hits per window and forgets a window once it closes', async () => {
    const db = new SqliteD1Database();
    const now = Date.UTC(2026, 8, 27, 12, 1);
    assert.equal(await countHit(db, 'h1', now), 1);
    assert.equal(await countHit(db, 'h1', now + 1000), 2);
    assert.equal(await countHit(db, 'h2', now), 1);
    // The next window starts at one, and the last one's rows are gone.
    assert.equal(await countHit(db, 'h1', now + RATE_WINDOW_MS), 1);
    assert.deepEqual(
      db.rows<{ ip_hash: string }>('SELECT ip_hash FROM roadmap_rate'),
      [{ ip_hash: 'h1' }],
    );
  });

  it('is swept on a schedule when nobody votes', async () => {
    const db = new SqliteD1Database();
    // Long before the real clock the handler reads, so both have expired.
    const then = Date.UTC(2020, 0, 1);
    await todaysSalt(db, then);
    await countHit(db, 'h1', then);
    await worker.scheduled({}, { ROADMAP_DB: db });
    assert.deepEqual(db.rows('SELECT * FROM roadmap_rate'), []);
    assert.deepEqual(db.rows('SELECT * FROM roadmap_salts'), []);
  });

  it('keeps the window in progress and today’s salt when swept', async () => {
    const db = new SqliteD1Database();
    const now = Date.UTC(2026, 8, 27, 12, 1);
    await todaysSalt(db, now);
    await countHit(db, 'h1', now);
    await sweep(db, now + 1000);
    assert.equal(db.rows('SELECT * FROM roadmap_rate').length, 1);
    assert.equal(db.rows('SELECT * FROM roadmap_salts').length, 1);
  });

  it('refuses the vote over the limit with 429 and Retry-After', async () => {
    const db = new SqliteD1Database();
    const now = Date.UTC(2026, 8, 27, 12, 1);
    passTurnstile();
    let cookie = '';
    for (let vote = 1; vote <= RATE_LIMIT; vote += 1) {
      const response = await handleRoadmapVote(
        voteRequest(
          { id: 'cli-sync', turnstile: cookie ? '' : 'token' },
          cookie ? { cookie } : {},
        ),
        env(db),
        now,
      );
      assert.equal(response.status, 200, `vote ${vote}`);
      cookie = cookieFrom(response);
    }
    const refused = await handleRoadmapVote(
      voteRequest({ id: 'cli-sync' }, { cookie }),
      env(db),
      now,
    );
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: 'rate-limited' });
    assert.equal(refused.headers.get('retry-after'), '540');
    // Another address is unaffected.
    const other = await handleRoadmapVote(
      voteRequest({ id: 'cli-sync' }, { cookie, 'cf-connecting-ip': '::1' }),
      env(db),
      now,
    );
    assert.equal(other.status, 200);
  });

  it('never writes an address down', async () => {
    const db = new SqliteD1Database();
    passTurnstile();
    await worker.fetch(
      voteRequest({ id: 'cli-sync', turnstile: 't' }),
      env(db),
    );
    const everything = JSON.stringify([
      db.rows('SELECT * FROM roadmap_rate'),
      db.rows('SELECT * FROM roadmap_salts'),
      db.rows('SELECT * FROM roadmap_voters'),
      db.rows('SELECT * FROM roadmap_votes'),
      db.rows('SELECT * FROM roadmap_counts'),
    ]);
    assert.ok(!everything.includes(IP), everything);
    assert.equal(db.rows('SELECT * FROM roadmap_rate').length, 1);
  });
});

describe('the toggle, in the database', () => {
  const now = Date.UTC(2026, 8, 27, 12);

  it('adds a vote, and takes it back on the second press', async () => {
    const db = new SqliteD1Database();
    const voter = await voterHash(newVoterId());
    assert.deepEqual(
      await toggleVote(db, { voter, itemId: 'cli-sync', nowMs: now }),
      { voted: true, count: 1 },
    );
    assert.deepEqual(
      await toggleVote(db, { voter, itemId: 'cli-sync', nowMs: now }),
      { voted: false, count: 0 },
    );
  });

  it('counts one vote per browser per item', async () => {
    const db = new SqliteD1Database();
    const a = await voterHash(newVoterId());
    const b = await voterHash(newVoterId());
    await toggleVote(db, { voter: a, itemId: 'cli-sync', nowMs: now });
    await toggleVote(db, { voter: b, itemId: 'cli-sync', nowMs: now });
    await toggleVote(db, { voter: a, itemId: 'figma-import', nowMs: now });
    const board = await readBoard(db, a);
    assert.equal(countsFor(board.countRows)['cli-sync'], 2);
    assert.equal(countsFor(board.countRows)['figma-import'], 1);
    assert.deepEqual(votedFor(board.votedRows).sort(), [
      'cli-sync',
      'figma-import',
    ]);
  });

  it('cannot count a vote twice when two presses race', async () => {
    // Both read "not voted" before either writes. The second batch's writes
    // are conditional on the vote's row, so it changes nothing, and the count
    // agrees with the votes table.
    const db = new SqliteD1Database();
    const voter = await voterHash(newVoterId());
    const input = { voter, itemId: 'cli-sync', nowMs: now };
    const results = await Promise.all([
      toggleVote(db, input),
      toggleVote(db, input),
    ]);
    assert.deepEqual(results, [
      { voted: true, count: 1 },
      { voted: true, count: 1 },
    ]);
    assert.equal(db.rows('SELECT * FROM roadmap_votes').length, 1);
  });

  it('cannot take away a vote twice when two presses race', async () => {
    const db = new SqliteD1Database();
    const voter = await voterHash(newVoterId());
    const other = await voterHash(newVoterId());
    const input = { voter, itemId: 'cli-sync', nowMs: now };
    await toggleVote(db, input);
    await toggleVote(db, { ...input, voter: other });
    await Promise.all([toggleVote(db, input), toggleVote(db, input)]);
    const board = await readBoard(db, other);
    assert.equal(countsFor(board.countRows)['cli-sync'], 1);
  });

  it('shows a zero for every votable item, and nothing for a shipped one', () => {
    const counts = countsFor([
      { item_id: 'cli-sync', votes: 3 },
      { item_id: 'style-presets', votes: 9 },
      { item_id: 'retired', votes: 4 },
    ]);
    assert.deepEqual(Object.keys(counts), [...VOTABLE_IDS]);
    assert.equal(counts['cli-sync'], 3);
    assert.equal(counts['figma-import'], 0);
    assert.deepEqual(
      votedFor([{ item_id: 'style-presets' }, { item_id: 'cli-sync' }]),
      ['cli-sync'],
    );
  });
});

describe('who needs a Turnstile check', () => {
  it('requires a token, and a secret to check it with', () => {
    assert.equal(checkRefusal({ token: 't', secretConfigured: true }), null);
    assert.deepEqual(checkRefusal({ token: '', secretConfigured: true }), {
      status: 403,
      error: 'check-required',
    });
    // Unlike the waitlist, a missing secret is not a pass.
    assert.deepEqual(checkRefusal({ token: 't', secretConfigured: false }), {
      status: 503,
      error: 'check-unavailable',
    });
  });
});

describe('GET /api/roadmap/votes', () => {
  it('sends every count and nothing about a browser it does not know', async () => {
    const response = await worker.fetch(votesRequest(), env());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    const body = (await response.json()) as {
      counts: Record<string, number>;
      voted: string[];
      verified: boolean;
    };
    assert.deepEqual(Object.keys(body.counts), [...VOTABLE_IDS]);
    assert.deepEqual(body.voted, []);
    assert.equal(body.verified, false);
  });

  it('answers 503, not an empty board, without a database', async () => {
    const response = await worker.fetch(votesRequest(), {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'unavailable' });
  });

  it('refuses other methods with 405', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/roadmap/votes`, { method: 'POST' }),
      env(),
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
  });
});

describe('POST /api/roadmap/vote', () => {
  it('checks a first vote with Turnstile, then remembers the browser', async () => {
    const db = new SqliteD1Database();
    const siteverify = passTurnstile();

    const first = await worker.fetch(
      voteRequest({ id: 'figma-import', turnstile: 'token' }),
      env(db),
    );
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      id: 'figma-import',
      voted: true,
      count: 1,
    });
    assert.equal(siteverify.mock.calls.length, 1);
    const [url, init] = siteverify.mock.calls[0]!.arguments as [
      string,
      RequestInit,
    ];
    assert.equal(
      url,
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    const sent = init.body as URLSearchParams;
    assert.equal(sent.get('secret'), SECRET);
    assert.equal(sent.get('response'), 'token');
    assert.equal(sent.get('remoteip'), IP);
    const cookie = cookieFrom(first);
    assert.match(first.headers.get('set-cookie') ?? '', /HttpOnly/);

    // What the page loads next: the vote, and no check needed.
    const board = await worker.fetch(votesRequest({ cookie }), env(db));
    const body = (await board.json()) as {
      counts: Record<string, number>;
      voted: string[];
      verified: boolean;
    };
    assert.equal(body.counts['figma-import'], 1);
    assert.deepEqual(body.voted, ['figma-import']);
    assert.equal(body.verified, true);

    // The second press takes it back, with no token and no second check.
    const second = await worker.fetch(
      voteRequest({ id: 'figma-import' }, { cookie }),
      env(db),
    );
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), {
      id: 'figma-import',
      voted: false,
      count: 0,
    });
    assert.equal(siteverify.mock.calls.length, 1);
  });

  it('stores the cookie’s hash, never the cookie', async () => {
    const db = new SqliteD1Database();
    passTurnstile();
    const response = await worker.fetch(
      voteRequest({ id: 'cli-sync', turnstile: 't' }),
      env(db),
    );
    const id = cookieFrom(response).split('=')[1]!;
    const voters = db.rows<{ voter_hash: string }>(
      'SELECT voter_hash FROM roadmap_voters',
    );
    assert.deepEqual(voters, [{ voter_hash: await voterHash(id) }]);
    const everything = JSON.stringify([
      voters,
      db.rows('SELECT * FROM roadmap_votes'),
    ]);
    assert.ok(!everything.includes(id));
  });

  it('asks a browser it does not know for a check', async () => {
    const siteverify = passTurnstile();
    const response = await worker.fetch(voteRequest({ id: 'cli-sync' }), env());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'check-required' });
    assert.equal(siteverify.mock.calls.length, 0);
  });

  it('does not take a cookie it did not issue as a voter', async () => {
    // A well-formed value the Worker never registered is a browser it does
    // not know, and after its check it is given a new id, not the one it
    // chose.
    passTurnstile();
    const chosen = 'c'.repeat(43);
    const cookie = `${VOTER_COOKIE}=${chosen}`;
    const unchecked = await worker.fetch(
      voteRequest({ id: 'cli-sync' }, { cookie }),
      env(),
    );
    assert.equal(unchecked.status, 403);
    const checked = await worker.fetch(
      voteRequest({ id: 'cli-sync', turnstile: 't' }, { cookie }),
      env(),
    );
    assert.equal(checked.status, 200);
    assert.notEqual(cookieFrom(checked), cookie);
  });

  it('refuses a token Turnstile did not pass, or issued for something else', async () => {
    for (const verdict of [
      { success: false },
      { action: 'waitlist' },
      { hostname: 'evil.example' },
    ]) {
      mock.restoreAll();
      passTurnstile(verdict);
      const db = new SqliteD1Database();
      const response = await worker.fetch(
        voteRequest({ id: 'cli-sync', turnstile: 't' }),
        env(db),
      );
      assert.equal(response.status, 403, JSON.stringify(verdict));
      assert.deepEqual(await response.json(), { error: 'check-failed' });
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(db.rows('SELECT * FROM roadmap_votes'), []);
      assert.deepEqual(db.rows('SELECT * FROM roadmap_voters'), []);
    }
  });

  it('says the check could not run when Cloudflare could not be asked', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });
    mock.method(console, 'error', () => {});
    const response = await worker.fetch(
      voteRequest({ id: 'cli-sync', turnstile: 't' }),
      env(),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'check-unavailable' });
  });

  it('takes no first vote without the Turnstile secret', async () => {
    const siteverify = passTurnstile();
    const response = await worker.fetch(
      voteRequest({ id: 'cli-sync', turnstile: 't' }),
      env(new SqliteD1Database(), { TURNSTILE_SECRET_KEY: undefined }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'check-unavailable' });
    assert.equal(siteverify.mock.calls.length, 0);
  });

  it('lets no unknown or shipped id through, before any other work', async () => {
    const siteverify = passTurnstile();
    const db = new SqliteD1Database();
    const unknown = await worker.fetch(
      voteRequest({ id: 'world-peace', turnstile: 't' }),
      env(db),
    );
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'unknown-item' });
    const shipped = await worker.fetch(
      voteRequest({ id: 'reference-url', turnstile: 't' }),
      env(db),
    );
    assert.equal(shipped.status, 409);
    assert.deepEqual(await shipped.json(), { error: 'shipped-item' });
    assert.equal(siteverify.mock.calls.length, 0);
    assert.deepEqual(db.rows('SELECT * FROM roadmap_rate'), []);
    assert.deepEqual(db.rows('SELECT * FROM roadmap_votes'), []);
  });

  it('refuses a vote from another origin', async () => {
    const response = await worker.fetch(
      voteRequest(
        { id: 'cli-sync', turnstile: 't' },
        { origin: 'https://evil.example' },
      ),
      env(),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'bad-origin' });
  });

  it('answers 503 without a database, as the preview does', async () => {
    const response = await worker.fetch(
      voteRequest({ id: 'cli-sync', turnstile: 't' }),
      {},
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'unavailable' });
  });

  it('refuses other methods with 405', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/roadmap/vote`),
      env(),
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  });

  it('sends no-store and the site’s security headers on every answer', async () => {
    passTurnstile();
    const responses = [
      await worker.fetch(votesRequest(), env()),
      await worker.fetch(votesRequest(), {}),
      await worker.fetch(
        voteRequest({ id: 'cli-sync', turnstile: 't' }),
        env(),
      ),
      await worker.fetch(voteRequest({ id: 'nope' }), env()),
      await worker.fetch(new Request(`${ORIGIN}/api/roadmap/vote`), env()),
    ];
    for (const response of responses) {
      assert.equal(
        response.headers.get('cache-control'),
        'no-store',
        String(response.status),
      );
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        assert.equal(response.headers.get(name), value, name);
      }
    }
  });
});
