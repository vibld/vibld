/**
 * The two roadmap endpoints, as worker/index.ts routes them:
 *
 *   GET  /api/roadmap/votes  the counts, and what this browser voted for
 *   POST /api/roadmap/vote   `{ id, turnstile? }`, toggles this browser's vote
 *
 * Every decision is a pure function in roadmap.ts and every read and write is
 * in roadmap-store.ts; this file is the order they happen in. That order is
 * the part worth reading:
 *
 *   1. the request is shaped right and names a votable item (no database);
 *   2. the address has votes left in this window, counted before anything
 *      else touches the database or Cloudflare, so a script is refused before
 *      it can make either do work;
 *   3. a browser the Worker does not know passes Turnstile, and is given a
 *      new voter id in the same transaction as its first vote;
 *   4. the vote is toggled, and the state read back is what is returned.
 */

import {
  NO_STORE,
  ROADMAP_TURNSTILE_ACTION,
  type Refusal,
  checkRefusal,
  clientIp,
  countsFor,
  ipHash,
  itemRefusal,
  newVoterId,
  originRefusal,
  parseVoteRequest,
  rateRefusal,
  voterCookie,
  voterHash,
  voterIdFrom,
  votedFor,
} from './roadmap.ts';
import {
  type RoadmapD1Database,
  countHit,
  isKnownVoter,
  readBoard,
  toggleVote,
  todaysSalt,
} from './roadmap-store.ts';
import { isTurnstileVerified, turnstileVerifyRequest } from './waitlist.ts';

export interface RoadmapEnv {
  /**
   * wrangler.jsonc's `vibld-marketing-roadmap`. Absent on the preview
   * deployment on purpose (wrangler.preview.jsonc), where both endpoints
   * answer 503 and the page shows its items without counts.
   */
  ROADMAP_DB?: RoadmapD1Database;
  /** The waitlist's Turnstile secret, shared: one site key, one secret. */
  TURNSTILE_SECRET_KEY?: string;
}

function json(
  body: Record<string, unknown>,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, ...extra },
  });
}

function refuse(refusal: Refusal, extra: Record<string, string> = {}) {
  return json({ error: refusal.error }, refusal.status, extra);
}

const UNAVAILABLE: Refusal = { status: 503, error: 'unavailable' };

export async function handleRoadmapVotes(
  request: Request,
  env: RoadmapEnv,
): Promise<Response> {
  if (!env.ROADMAP_DB) return refuse(UNAVAILABLE);
  try {
    const id = voterIdFrom(request);
    const board = await readBoard(
      env.ROADMAP_DB,
      id === null ? null : await voterHash(id),
    );
    return json(
      {
        counts: countsFor(board.countRows),
        voted: board.known ? votedFor(board.votedRows) : [],
        // Whether this browser's next vote needs a Turnstile token. The
        // cookie is HttpOnly, so the page cannot find out any other way.
        verified: board.known,
      },
      200,
    );
  } catch (error) {
    console.error('roadmap: reading votes failed', error);
    return refuse(UNAVAILABLE);
  }
}

export async function handleRoadmapVote(
  request: Request,
  env: RoadmapEnv,
  nowMs: number = Date.now(),
): Promise<Response> {
  const origin = originRefusal(request);
  if (origin) return refuse(origin);
  const parsed = await parseVoteRequest(request);
  if (!parsed.ok) return refuse(parsed);
  const item = itemRefusal(parsed.body.id);
  if (item) return refuse(item);

  const db = env.ROADMAP_DB;
  if (!db) return refuse(UNAVAILABLE);

  try {
    const hits = await countHit(
      db,
      await ipHash(clientIp(request), await todaysSalt(db, nowMs)),
      nowMs,
    );
    const limited = rateRefusal(hits, nowMs);
    if (limited) {
      return refuse(limited, { 'retry-after': String(limited.retryAfter) });
    }

    const presented = voterIdFrom(request);
    const known =
      presented !== null &&
      (await isKnownVoter(db, await voterHash(presented)));

    let voterId: string;
    if (known) {
      voterId = presented!;
    } else {
      const needs = checkRefusal({
        token: parsed.body.turnstile,
        secretConfigured: Boolean(env.TURNSTILE_SECRET_KEY),
      });
      if (needs) return refuse(needs);
      const verdict = await verifyTurnstile(
        parsed.body.turnstile,
        env.TURNSTILE_SECRET_KEY!,
        request,
      );
      if (verdict) return refuse(verdict);
      // Always a new id, never the one the request presented: a voter id is
      // one this Worker made, so a client cannot choose the value it will be
      // known by.
      voterId = newVoterId();
    }

    const result = await toggleVote(db, {
      voter: await voterHash(voterId),
      itemId: parsed.body.id,
      nowMs,
      register: !known,
    });
    return json({ id: parsed.body.id, ...result }, 200, {
      // Set again on every vote, so the cookie's lifetime runs from the last
      // time this browser voted rather than the first.
      'set-cookie': voterCookie(voterId),
    });
  } catch (error) {
    console.error('roadmap: vote failed', error);
    return refuse(UNAVAILABLE);
  }
}

/**
 * Null when the token passed. A refusal otherwise, and a different one for
 * "Cloudflare could not be asked" than for "Cloudflare said no": the first is
 * ours to fix, and telling a person their check failed when it never ran
 * would send them round the same loop for nothing.
 */
async function verifyTurnstile(
  token: string,
  secret: string,
  request: Request,
): Promise<Refusal | null> {
  const { url, init } = turnstileVerifyRequest(
    token,
    secret,
    request.headers.get('cf-connecting-ip') ?? undefined,
  );
  try {
    const response = await fetch(url, init);
    if (!response.ok) return { status: 503, error: 'check-unavailable' };
    return isTurnstileVerified(await response.json(), ROADMAP_TURNSTILE_ACTION)
      ? null
      : { status: 403, error: 'check-failed' };
  } catch (error) {
    console.error('roadmap: Turnstile verification request threw', error);
    return { status: 503, error: 'check-unavailable' };
  }
}

/** For the routes' other methods: said, rather than a 404 that implies no route. */
export function methodNotAllowed(allow: string): Response {
  return new Response(null, {
    status: 405,
    headers: { allow, 'cache-control': 'no-store' },
  });
}
