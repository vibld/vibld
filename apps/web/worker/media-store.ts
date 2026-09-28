import { mediaObjectKey } from '@vibld/core';
import type { MediaKind } from '@vibld/core';

/**
 * The media library: one row per uploaded file (`project_media`, migration
 * 0027) and its bytes in R2.
 *
 * The row is written after the bytes and removed before them. A row that
 * names bytes which are not there serves a 404 for a page that expected an
 * image; bytes with no row are invisible and cost storage only, and the
 * orphan either way is the cheaper one.
 */

export interface MediaEntry {
  id: string;
  /** `media/<slug>.<ext>`, served at `/media/<slug>.<ext>`. */
  path: string;
  kind: MediaKind;
  contentType: string;
  bytes: number;
  alt: string;
  /** For a video, the path of its poster image, when it has one. */
  posterPath?: string;
  /** The name git gives these bytes, for a push preview. */
  gitSha: string;
  createdAt: string;
}

/** A library file as copying it into another account reads it. */
export interface CopyableMedia {
  id: string;
  path: string;
  kind: MediaKind;
  contentType: string;
  bytes: number;
  sha256: string;
  gitSha: string;
  alt: string;
  posterId: string | null;
}

interface MediaRow {
  id: string;
  path: string;
  kind: MediaKind;
  content_type: string;
  bytes: number;
  alt: string;
  poster_id: string | null;
  poster_path: string | null;
  git_sha: string;
  created_at: string;
}

function entryOf(row: MediaRow): MediaEntry {
  return {
    id: row.id,
    path: row.path,
    kind: row.kind,
    contentType: row.content_type,
    bytes: row.bytes,
    alt: row.alt,
    ...(row.poster_path ? { posterPath: row.poster_path } : {}),
    gitSha: row.git_sha,
    createdAt: row.created_at,
  };
}

export class MediaStore {
  readonly #db: D1Database;
  readonly #bucket: R2Bucket;

  constructor(db: D1Database, bucket: R2Bucket) {
    this.#db = db;
    this.#bucket = bucket;
  }

  /** Every file this account has, oldest first, with each video's poster. */
  async list(userId: string): Promise<MediaEntry[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT m.id, m.path, m.kind, m.content_type, m.bytes, m.alt,
                m.poster_id, p.path AS poster_path, m.git_sha, m.created_at
           FROM project_media m
           LEFT JOIN project_media p
             ON p.id = m.poster_id AND p.user_id = m.user_id
          WHERE m.user_id = ?1
          ORDER BY m.created_at, m.id`,
      )
      .bind(userId)
      .all<MediaRow>();
    return results.map(entryOf);
  }

  /**
   * Every file this account has, with what copying one into another
   * account needs and `list` leaves out: the hash that says whether two
   * files are the same bytes, and the poster by id rather than by path.
   * For a remix (`media-copy.ts`).
   */
  async copyable(userId: string): Promise<CopyableMedia[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT id, path, kind, content_type, bytes, sha256, git_sha, alt,
                poster_id
           FROM project_media WHERE user_id = ?1
          ORDER BY created_at, id`,
      )
      .bind(userId)
      .all<{
        id: string;
        path: string;
        kind: MediaKind;
        content_type: string;
        bytes: number;
        sha256: string;
        git_sha: string;
        alt: string;
        poster_id: string | null;
      }>();
    return results.map((row) => ({
      id: row.id,
      path: row.path,
      kind: row.kind,
      contentType: row.content_type,
      bytes: row.bytes,
      sha256: row.sha256,
      gitSha: row.git_sha,
      alt: row.alt,
      posterId: row.poster_id,
    }));
  }

  /** How much this account stores: files and bytes. */
  async usage(userId: string): Promise<{ files: number; bytes: number }> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS bytes
           FROM project_media WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<{ files: number; bytes: number }>();
    return { files: row?.files ?? 0, bytes: row?.bytes ?? 0 };
  }

  /**
   * Store a file: bytes first, then the row. A row that cannot be written
   * takes its bytes with it, so a failed upload leaves nothing behind.
   *
   * The quota is checked by the INSERT itself, not before it: D1 runs one
   * statement at a time, so two uploads racing each other cannot both see
   * the same free space. `undefined` when the file would take the account
   * past `limits`.
   */
  async add(
    userId: string,
    limits: { maxFiles: number; maxBytes: number },
    file: {
      id: string;
      path: string;
      kind: MediaKind;
      contentType: string;
      bytes: ArrayBuffer;
      sha256: string;
      gitSha: string;
      alt: string;
      createdAt: string;
    },
  ): Promise<MediaEntry | undefined> {
    const key = mediaObjectKey(userId, file.id);
    await this.#bucket.put(key, file.bytes, {
      httpMetadata: { contentType: file.contentType },
    });
    let inserted: number;
    try {
      const result = await this.#db
        .prepare(
          `INSERT INTO project_media
             (id, user_id, path, kind, content_type, bytes, sha256, alt,
              created_at, git_sha)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?12
            WHERE (SELECT COUNT(*) FROM project_media WHERE user_id = ?2) < ?10
              AND (SELECT COALESCE(SUM(bytes), 0) FROM project_media
                    WHERE user_id = ?2) + ?6 <= ?11`,
        )
        .bind(
          file.id,
          userId,
          file.path,
          file.kind,
          file.contentType,
          file.bytes.byteLength,
          file.sha256,
          file.alt,
          file.createdAt,
          limits.maxFiles,
          limits.maxBytes,
          file.gitSha,
        )
        .run();
      inserted = result.meta?.changes ?? 0;
    } catch (error) {
      await this.#bucket.delete(key).catch(() => undefined);
      throw error;
    }
    if (inserted === 0) {
      await this.#bucket.delete(key).catch(() => undefined);
      return undefined;
    }
    return {
      id: file.id,
      path: file.path,
      kind: file.kind,
      contentType: file.contentType,
      bytes: file.bytes.byteLength,
      alt: file.alt,
      gitSha: file.gitSha,
      createdAt: file.createdAt,
    };
  }

  /** Point a video at its poster. Both must be this account's. */
  async setPoster(
    userId: string,
    videoId: string,
    posterId: string,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE project_media SET poster_id = ?3
          WHERE id = ?2 AND user_id = ?1 AND kind = 'video'
            AND EXISTS (SELECT 1 FROM project_media
                         WHERE id = ?3 AND user_id = ?1 AND kind = 'image')`,
      )
      .bind(userId, videoId, posterId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  /** The kind of one of this account's files, or `undefined`. */
  async kindOf(userId: string, id: string): Promise<MediaKind | undefined> {
    const row = await this.#db
      .prepare(`SELECT kind FROM project_media WHERE id = ?2 AND user_id = ?1`)
      .bind(userId, id)
      .first<{ kind: MediaKind }>();
    return row?.kind;
  }

  /**
   * Remove a file: the bytes first, then the row, then any video's
   * reference to it as a poster. `false` when it is not this account's.
   *
   * Bytes before the row, so a failure leaves something to retry: a row
   * whose bytes went is still listed and removable again (deleting an
   * absent object succeeds), where bytes whose row went would be stored for
   * good with nothing left that names them.
   *
   * Not one transaction, and it does not need to be: a pointer left behind
   * by a failure between the last two statements names a row that no
   * longer exists, and `list` joins it away rather than reporting it.
   */
  async remove(userId: string, id: string): Promise<boolean> {
    const owned = await this.#db
      .prepare(`SELECT id FROM project_media WHERE id = ?2 AND user_id = ?1`)
      .bind(userId, id)
      .first();
    if (!owned) return false;
    await this.#bucket.delete(mediaObjectKey(userId, id));
    const deleted = await this.#db
      .prepare(`DELETE FROM project_media WHERE id = ?2 AND user_id = ?1`)
      .bind(userId, id)
      .run();
    if ((deleted.meta?.changes ?? 0) === 0) return false;
    await this.#db
      .prepare(
        `UPDATE project_media SET poster_id = NULL
          WHERE user_id = ?1 AND poster_id = ?2`,
      )
      .bind(userId, id)
      .run();
    return true;
  }
}
