/**
 * The roadmap's reads and writes against D1 (migrations/0001_roadmap_votes.sql).
 *
 * Nothing here decides anything: whether a vote is allowed is worker/roadmap.ts's
 * question. This file only makes the database agree with itself, which comes
 * down to one rule: a count changes in the same batch as the vote it counts,
 * and only if that vote's row actually changes. D1 runs a batch as one
 * transaction, so two requests racing on the same vote leave the count and
 * the votes in step whichever lands first.
 *
 * Tested against real SQLite (test/fakes/sqlite-d1.ts) running the real
 * migration, the way apps/web and apps/publish test their stores.
 */

import { newSalt, rateWindowStart, saltDay } from './roadmap.ts';

/**
 * The narrow shape of D1 this file uses, declared here rather than taken
 * from the Workers type package, which this app otherwise has no need for.
 * The same choice apps/publish makes in worker/types.ts.
 */
export interface RoadmapD1Result<T> {
  results: T[];
  meta?: { changes?: number };
}

export interface RoadmapD1Statement {
  bind(...values: unknown[]): RoadmapD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<RoadmapD1Result<T>>;
  run(): Promise<RoadmapD1Result<unknown>>;
}

export interface RoadmapD1Database {
  prepare(query: string): RoadmapD1Statement;
  /** Several statements as one transaction: all of them or none. */
  batch<T = Record<string, unknown>>(
    statements: RoadmapD1Statement[],
  ): Promise<RoadmapD1Result<T>[]>;
}

export interface BoardState {
  countRows: { item_id: string; votes: number }[];
  votedRows: { item_id: string }[];
  /** Whether this browser has passed a check before. */
  known: boolean;
}

/**
 * Everything the page asks for in one round trip: the totals, and, when the
 * request carried a voter id, what that browser voted for and whether it is
 * one the Worker registered.
 */
export async function readBoard(
  db: RoadmapD1Database,
  voter: string | null,
): Promise<BoardState> {
  const counts = db.prepare('SELECT item_id, votes FROM roadmap_counts');
  if (voter === null) {
    const [rows] = await db.batch<{ item_id: string; votes: number }>([counts]);
    return { countRows: rows?.results ?? [], votedRows: [], known: false };
  }
  const [countRows, votedRows, knownRows] = await db.batch<
    Record<string, unknown>
  >([
    counts,
    db
      .prepare('SELECT item_id FROM roadmap_votes WHERE voter_hash = ?1')
      .bind(voter),
    db
      .prepare('SELECT 1 AS known FROM roadmap_voters WHERE voter_hash = ?1')
      .bind(voter),
  ]);
  return {
    countRows: (countRows?.results ?? []) as BoardState['countRows'],
    votedRows: (votedRows?.results ?? []) as BoardState['votedRows'],
    known: (knownRows?.results.length ?? 0) > 0,
  };
}

export async function isKnownVoter(
  db: RoadmapD1Database,
  voter: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS known FROM roadmap_voters WHERE voter_hash = ?1')
    .bind(voter)
    .first();
  return row !== null;
}

export interface ToggleResult {
  voted: boolean;
  count: number;
}

/**
 * Adds this browser's vote for an item if it has none, and removes it if it
 * has one.
 *
 * Which of the two is decided by a read before the batch, and each write in
 * the batch is conditional on the vote's row as it stands inside the
 * transaction. So a race between two toggles can only make one of them a
 * no-op, never count a vote twice or take one away that was never there, and
 * the state it reports is read back from the same transaction rather than
 * worked out from what it meant to do.
 *
 * `register`, for a browser that has just passed its first check, adds the
 * voter in the same transaction, so there is never a registered voter whose
 * first vote was lost, nor a vote from a voter nobody registered.
 */
export async function toggleVote(
  db: RoadmapD1Database,
  input: { voter: string; itemId: string; nowMs: number; register?: boolean },
): Promise<ToggleResult> {
  const { voter, itemId, nowMs } = input;
  const existing = input.register
    ? null
    : await db
        .prepare(
          'SELECT 1 AS present FROM roadmap_votes WHERE voter_hash = ?1 AND item_id = ?2',
        )
        .bind(voter, itemId)
        .first();

  const statements: RoadmapD1Statement[] = [];
  if (input.register) {
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO roadmap_voters (voter_hash, created_at) VALUES (?1, ?2)',
        )
        .bind(voter, nowMs),
    );
  }
  if (existing === null) {
    statements.push(
      // Counted before the vote is written, while "not yet voted" is still
      // true, and only if it is. `WHERE NOT EXISTS` is also what SQLite needs
      // to parse an upsert from a SELECT.
      db
        .prepare(
          `INSERT INTO roadmap_counts (item_id, votes)
             SELECT ?1, 1
             WHERE NOT EXISTS (
               SELECT 1 FROM roadmap_votes WHERE voter_hash = ?2 AND item_id = ?1
             )
           ON CONFLICT (item_id) DO UPDATE SET votes = votes + 1`,
        )
        .bind(itemId, voter),
      db
        .prepare(
          'INSERT OR IGNORE INTO roadmap_votes (voter_hash, item_id, created_at) VALUES (?1, ?2, ?3)',
        )
        .bind(voter, itemId, nowMs),
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE roadmap_counts SET votes = votes - 1
           WHERE item_id = ?1 AND votes > 0 AND EXISTS (
             SELECT 1 FROM roadmap_votes WHERE voter_hash = ?2 AND item_id = ?1
           )`,
        )
        .bind(itemId, voter),
      db
        .prepare(
          'DELETE FROM roadmap_votes WHERE voter_hash = ?1 AND item_id = ?2',
        )
        .bind(voter, itemId),
    );
  }
  statements.push(
    db
      .prepare(
        `SELECT
           EXISTS (
             SELECT 1 FROM roadmap_votes WHERE voter_hash = ?1 AND item_id = ?2
           ) AS voted,
           COALESCE(
             (SELECT votes FROM roadmap_counts WHERE item_id = ?2), 0
           ) AS count`,
      )
      .bind(voter, itemId),
  );

  const results = await db.batch<{ voted: number; count: number }>(statements);
  const state = results.at(-1)?.results[0];
  return {
    voted: Number(state?.voted ?? 0) === 1,
    count: Number(state?.count ?? 0),
  };
}

/**
 * Today's salt, created by whichever request needs it first. Yesterday's is
 * deleted in the same transaction, which is the moment a hash made with it
 * stops being matchable to anything.
 */
export async function todaysSalt(
  db: RoadmapD1Database,
  nowMs: number,
): Promise<string> {
  const day = saltDay(nowMs);
  const results = await db.batch<{ salt: string }>([
    db
      .prepare(
        'INSERT OR IGNORE INTO roadmap_salts (day, salt) VALUES (?1, ?2)',
      )
      .bind(day, newSalt()),
    db.prepare('DELETE FROM roadmap_salts WHERE day < ?1').bind(day),
    db.prepare('SELECT salt FROM roadmap_salts WHERE day = ?1').bind(day),
  ]);
  const salt = results.at(-1)?.results[0]?.salt;
  if (!salt) throw new Error('roadmap_salts has no row for today');
  return salt;
}

/**
 * Counts one vote against a hashed address and returns its total for the
 * current window, the vote included. Rows from closed windows are deleted
 * first, so the table only ever holds the window in progress.
 */
export async function countHit(
  db: RoadmapD1Database,
  hashedIp: string,
  nowMs: number,
): Promise<number> {
  const window = rateWindowStart(nowMs);
  const results = await db.batch<{ hits: number }>([
    db.prepare('DELETE FROM roadmap_rate WHERE window_start < ?1').bind(window),
    db
      .prepare(
        `INSERT INTO roadmap_rate (window_start, ip_hash, hits) VALUES (?1, ?2, 1)
         ON CONFLICT (window_start, ip_hash) DO UPDATE SET hits = hits + 1`,
      )
      .bind(window, hashedIp),
    db
      .prepare(
        'SELECT hits FROM roadmap_rate WHERE window_start = ?1 AND ip_hash = ?2',
      )
      .bind(window, hashedIp),
  ]);
  return Number(results.at(-1)?.results[0]?.hits ?? 0);
}

/**
 * The scheduled sweep (wrangler.jsonc's cron). `countHit` already clears
 * closed windows, but only when somebody votes; without this a quiet evening
 * would leave the last hashes in place until the next vote, and a salt until
 * the next day's first one.
 */
export async function sweep(
  db: RoadmapD1Database,
  nowMs: number,
): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM roadmap_rate WHERE window_start < ?1')
      .bind(rateWindowStart(nowMs)),
    db.prepare('DELETE FROM roadmap_salts WHERE day < ?1').bind(saltDay(nowMs)),
  ]);
}
