/**
 * Votes on the public roadmap, with no Workers runtime behind them.
 *
 * Request parsing, the cookie, the hashing and every decision the two
 * endpoints make are pure functions here, testable without deploying
 * anything: the same split worker/waitlist.ts makes. The reads and writes
 * are in roadmap-store.ts, and worker/index.ts only puts the two together.
 */

import { VOTABLE_IDS, roadmapItem } from '../app/roadmap.ts';
import type { RoadmapError } from '../app/roadmap-votes.ts';

export { ROADMAP_TURNSTILE_ACTION } from '../app/roadmap-votes.ts';
export type { RoadmapError };

/**
 * `__Host-` makes the browser refuse the cookie unless it is Secure, has
 * Path=/ and names no Domain, so no other host (app.vibld.com included) can
 * set or overwrite it for this one.
 */
export const VOTER_COOKIE = '__Host-vibld_voter';

/**
 * About 400 days, which is as long as Chrome will keep any cookie whatever it
 * is asked for. The cookie is set again on every vote, so a browser that keeps
 * voting keeps its votes.
 */
export const VOTER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** 32 random bytes, base64url without padding: always 43 characters. */
const VOTER_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * A vote body is `{"id": "...", "turnstile": "..."}`. A token is around two
 * thousand characters, so four kilobytes is room for both with nothing else.
 */
export const MAX_VOTE_BODY_BYTES = 4096;

/**
 * Ten minutes, and sixty votes in one. Generous for a person, who might press
 * twenty-one buttons twice, and several people behind one address with them;
 * useless for a script.
 */
export const RATE_WINDOW_MS = 10 * 60_000;
export const RATE_LIMIT = 60;

export interface Refusal {
  status: number;
  error: RoadmapError;
}

export interface VoteBody {
  id: string;
  /** Empty when the browser already has a voter cookie the Worker knows. */
  turnstile: string;
}

/**
 * A cross-site page cannot send this, so nothing that reaches the toggle was
 * started by one. `content-type: application/json` already forces a CORS
 * preflight this Worker never answers, and the cookie is SameSite=Lax; the
 * Origin check is the third of those, and the one that does not depend on a
 * browser getting either of the others right.
 *
 * A request with no Origin at all is let through: browsers send one on every
 * POST from a page, and a client that is not a browser can write whatever
 * Origin it likes, so refusing the absent header stops nobody.
 */
export function originRefusal(request: Request): Refusal | null {
  const origin = request.headers.get('origin');
  if (origin === null) return null;
  return origin === new URL(request.url).origin
    ? null
    : { status: 403, error: 'bad-origin' };
}

/** Reads a vote from its request, or says why it cannot. */
export async function parseVoteRequest(
  request: Request,
): Promise<{ ok: true; body: VoteBody } | ({ ok: false } & Refusal)> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType)) {
    return { ok: false, status: 415, error: 'unsupported-media-type' };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_VOTE_BODY_BYTES) {
    return { ok: false, status: 413, error: 'body-too-large' };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'invalid-body' };
  }
  // Checked again on what arrived: a chunked request declares no length.
  if (new TextEncoder().encode(text).length > MAX_VOTE_BODY_BYTES) {
    return { ok: false, status: 413, error: 'body-too-large' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: 'invalid-body' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, status: 400, error: 'invalid-body' };
  }
  const { id, turnstile } = value as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, status: 400, error: 'invalid-body' };
  }
  if (turnstile !== undefined && typeof turnstile !== 'string') {
    return { ok: false, status: 400, error: 'invalid-body' };
  }
  return { ok: true, body: { id, turnstile: turnstile ?? '' } };
}

/**
 * Whether this id may be voted for. Two refusals rather than one, because
 * they mean different things to whoever sent them: an id that was never on
 * the roadmap is a mistake, and a shipped one is an item that is finished.
 */
export function itemRefusal(id: string): Refusal | null {
  const item = roadmapItem(id);
  if (!item) return { status: 404, error: 'unknown-item' };
  if (!VOTABLE_IDS.includes(item.id)) {
    return { status: 409, error: 'shipped-item' };
  }
  return null;
}

/** The value of one cookie, or null. Only the first of a repeated name counts. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

/** The voter id this request carries, when it carries a well-formed one. */
export function voterIdFrom(request: Request): string | null {
  const value = readCookie(request.headers.get('cookie'), VOTER_COOKIE);
  return value !== null && VOTER_ID.test(value) ? value : null;
}

/** A fresh voter id. `random` is injectable only so a test can pin it. */
export function newVoterId(random: () => Uint8Array = randomBytes): string {
  return base64url(random());
}

/**
 * HttpOnly, because nothing on the page needs to read it: the Worker says
 * whether this browser is a known voter, so script never has to hold the id.
 * Lax rather than Strict so that arriving at /roadmap from a link elsewhere
 * still shows the votes this browser cast; the endpoints that change anything
 * take only same-origin JSON (`originRefusal`, `parseVoteRequest`).
 */
export function voterCookie(id: string): string {
  return [
    `${VOTER_COOKIE}=${id}`,
    `Max-Age=${VOTER_COOKIE_MAX_AGE}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * What the database knows a browser by. A plain hash is enough here, unlike
 * for an IP address: the input is 256 random bits, so there is nothing to
 * guess it from. The prefix keeps it from ever equalling a hash made for
 * another purpose from the same string.
 */
export function voterHash(voterId: string): Promise<string> {
  return sha256Hex(`roadmap-voter:${voterId}`);
}

/**
 * An address, hashed with the day's salt. Salted because an IPv4 address is
 * one of about four billion, few enough that a plain hash of one can be
 * reversed by trying them all; with a random salt that is deleted the next
 * day, it cannot be, and it cannot be matched to the same address's hash on
 * any other day.
 */
export function ipHash(ip: string, salt: string): Promise<string> {
  return sha256Hex(`roadmap-ip:${salt}:${ip}`);
}

/**
 * The address to rate-limit. Cloudflare sets `cf-connecting-ip` on every
 * request it delivers; only local development lacks it, and there every
 * request shares one bucket, which is harmless.
 */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/** The UTC day a salt belongs to, as YYYY-MM-DD. */
export function saltDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** A fresh salt: 32 random bytes, which only ever live in the database. */
export function newSalt(random: () => Uint8Array = randomBytes): string {
  return base64url(random());
}

export function rateWindowStart(nowMs: number): number {
  return nowMs - (nowMs % RATE_WINDOW_MS);
}

/**
 * Refuses the vote that takes an address past the limit, with how long until
 * its window closes. `hits` includes the vote being decided, so the limit-th
 * vote is allowed and the one after it is not.
 */
export function rateRefusal(
  hits: number,
  nowMs: number,
): (Refusal & { retryAfter: number }) | null {
  if (hits <= RATE_LIMIT) return null;
  const closes = rateWindowStart(nowMs) + RATE_WINDOW_MS;
  return {
    status: 429,
    error: 'rate-limited',
    retryAfter: Math.max(1, Math.ceil((closes - nowMs) / 1000)),
  };
}

/**
 * What a vote from a browser the Worker does not know yet needs before it
 * counts: a Turnstile token, a secret to check it with, and a check that
 * passed. `verified` is only consulted once the first two exist.
 *
 * Required, not skipped when the secret is missing, unlike the waitlist's
 * check: a waitlist signup still has the honeypot behind it, and a vote has
 * nothing else, so a deploy without the secret takes no first votes rather
 * than taking them from anybody.
 */
export function checkRefusal(input: {
  token: string;
  secretConfigured: boolean;
}): Refusal | null {
  if (!input.secretConfigured) {
    return { status: 503, error: 'check-unavailable' };
  }
  if (input.token.length === 0) {
    return { status: 403, error: 'check-required' };
  }
  return null;
}

/**
 * The counts the page is sent: every votable item, zero included, and
 * nothing else. A shipped item's votes stay in the database, so moving it
 * back brings them back, but they are not shown while it has no button.
 */
export function countsFor(
  rows: readonly { item_id: string; votes: number }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of VOTABLE_IDS) counts[id] = 0;
  for (const row of rows) {
    if (row.item_id in counts) counts[row.item_id] = Number(row.votes);
  }
  return counts;
}

/** The items this browser has voted for, limited to the ones still votable. */
export function votedFor(rows: readonly { item_id: string }[]): string[] {
  const voted = new Set(rows.map((row) => row.item_id));
  return VOTABLE_IDS.filter((id) => voted.has(id));
}

/**
 * Every response from these endpoints is about one browser at one moment, so
 * none of it may be stored by anything between here and the page.
 */
export const NO_STORE = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

function randomBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
