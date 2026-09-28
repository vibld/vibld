import {
  MEDIA_ACCOUNT_MAX_BYTES,
  MEDIA_ACCOUNT_MAX_FILES,
  mediaObjectKey,
  mediaPathFor,
  referencedMedia,
  renameMediaReferences,
} from '@vibld/core';
import type { ProjectSnapshot } from '@vibld/core';

import { MediaStore } from './media-store.ts';
import type { CopyableMedia } from './media-store.ts';

/**
 * Copying the media a shared project uses into the account remixing it
 * (docs/decisions.md, "Resolved 2026-09-28": the media library stays one
 * per account, and a remix into another account copies what it needs).
 *
 * A page names an upload by path (`/media/hero.jpg`), and every server of
 * a page resolves that path in its owner's library: the preview sandbox,
 * the published site (`apps/publish`'s `serveMedia`) and a GitHub push
 * (`media-export.ts`) all read `project_media` for the account whose
 * project it is. So a remix whose code named the original owner's files
 * would show broken images the moment it was previewed, published or
 * pushed from its new account, and would stop working altogether when the
 * original owner deleted a file or their account. The files are copied so
 * that nothing about the remix depends on anybody else's library.
 *
 * Only what the code references, read the way preview and publish read it
 * (`referencedMedia`): an owner's library can hold thirty files, and a
 * remix of one page needs the two it shows. Files the project ships under
 * its own `public/` are not the library's and are copied with the code.
 *
 * **When the remixer already has a file under the same name.** Byte for
 * byte the same (the hash stored at upload) is the same file, and nothing
 * is copied. Different bytes are stored under the next free name
 * (`mediaPathFor`, the rule an upload follows), and the copied code is
 * rewritten to use it (`renameMediaReferences`). The alternatives were
 * worse: refusing the remix blocks somebody over a file name they cannot
 * see, and keeping the remixer's own file would show them somebody else's
 * page with their photograph in it.
 *
 * **Room.** The copies count against the remixer's library like uploads
 * do, and a remix that would not fit is refused before anything is
 * written, with the numbers, rather than copied in part. The quota is
 * checked again by each insert (`MediaStore.add`), so a remix racing an
 * upload cannot pass it either; a copy refused there removes what this
 * remix had copied and is reported the same way.
 */

/** Refused because the remixer's library has no room for what the code uses. */
export class MediaRoomError extends Error {
  readonly files: number;
  readonly bytes: number;

  constructor(files: number, bytes: number) {
    const size =
      bytes >= 1024 * 1024
        ? `${Math.ceil(bytes / (1024 * 1024))} MB`
        : `${Math.ceil(bytes / 1024)} KB`;
    super(
      `This project uses ${files} media ${files === 1 ? 'file' : 'files'} (${size}) that your media library does not have room for. Remove some files from your library, then remix it again.`,
    );
    this.name = 'MediaRoomError';
    this.files = files;
    this.bytes = bytes;
  }
}

/** What copying decided, before any byte moves. Pure, so it is tested alone. */
export interface MediaCopyPlan {
  /** Files to copy, and the path each is stored under in the new library. */
  copy: { source: CopyableMedia; path: string }[];
  /** Source files the remixer already holds, byte for byte, by target id. */
  reuse: Map<string, string>;
  /** Old path to new, for the code. Empty when nothing was renamed. */
  renames: Map<string, string>;
  bytes: number;
}

export function planMediaCopy(
  snapshot: ProjectSnapshot,
  source: readonly CopyableMedia[],
  target: readonly CopyableMedia[],
): MediaCopyPlan {
  const referenced = new Set(referencedMedia(snapshot.files));
  const shipped = new Set(snapshot.files.map((file) => file.path));
  const targetByPath = new Map(target.map((entry) => [entry.path, entry]));
  // A new name has to be free in the remixer's library and also not be a
  // name the code already uses for something else, or renaming would merge
  // two different files into one reference.
  const taken = new Set([...target.map((entry) => entry.path), ...referenced]);
  const plan: MediaCopyPlan = {
    copy: [],
    reuse: new Map(),
    renames: new Map(),
    bytes: 0,
  };

  // A video's poster is copied with it when the code names the video, since
  // the poster is part of how the video is shown, even where the code does
  // not name the poster itself.
  const wanted = new Map<string, CopyableMedia>();
  const byId = new Map(source.map((entry) => [entry.id, entry]));
  for (const entry of source) {
    if (!referenced.has(entry.path)) continue;
    // The project ships its own file there, and it wins, as it does when
    // the site is served.
    if (shipped.has(`public/${entry.path}`) || shipped.has(entry.path)) {
      continue;
    }
    wanted.set(entry.id, entry);
    const poster = entry.posterId ? byId.get(entry.posterId) : undefined;
    if (poster) wanted.set(poster.id, poster);
  }

  for (const entry of wanted.values()) {
    const existing = targetByPath.get(entry.path);
    if (existing && existing.sha256 === entry.sha256) {
      plan.reuse.set(entry.id, existing.id);
      continue;
    }
    let path = entry.path;
    if (existing) {
      const name = entry.path.slice('media/'.length);
      const dot = name.lastIndexOf('.');
      path = mediaPathFor(name.slice(0, dot), name.slice(dot + 1), taken);
      plan.renames.set(entry.path, path);
    }
    taken.add(path);
    plan.copy.push({ source: entry, path });
    plan.bytes += entry.bytes;
  }
  return plan;
}

export interface MediaCopyResult {
  snapshot: ProjectSnapshot;
  /** The new rows' ids, for taking the copies back if the remix fails later. */
  copied: string[];
}

/**
 * Copy what `snapshot` uses from `fromUser`'s library into `toUser`'s, and
 * return the snapshot to store, with any renamed reference renamed.
 *
 * One file's bytes in memory at a time: the largest a library holds is a
 * 40 MB video, well inside an isolate, and the whole library at once would
 * not be.
 */
export async function copyMediaForRemix(
  db: D1Database,
  bucket: R2Bucket,
  fromUser: string,
  toUser: string,
  snapshot: ProjectSnapshot,
  options: { newId: () => string; now: string },
): Promise<MediaCopyResult> {
  const media = new MediaStore(db, bucket);
  const [source, target] = await Promise.all([
    media.copyable(fromUser),
    media.copyable(toUser),
  ]);
  const plan = planMediaCopy(snapshot, source, target);
  if (plan.copy.length === 0 && plan.reuse.size === 0) {
    return { snapshot, copied: [] };
  }

  const usage = await media.usage(toUser);
  if (
    usage.files + plan.copy.length > MEDIA_ACCOUNT_MAX_FILES ||
    usage.bytes + plan.bytes > MEDIA_ACCOUNT_MAX_BYTES
  ) {
    throw new MediaRoomError(plan.copy.length, plan.bytes);
  }

  const copied: string[] = [];
  const newIdOf = new Map(plan.reuse);
  try {
    for (const { source: entry, path } of plan.copy) {
      const object = await bucket.get(mediaObjectKey(fromUser, entry.id));
      // Bytes the owner's library lost are a file the owner's own page
      // already shows as missing. The remix shows it the same way rather
      // than failing over it.
      if (!object) continue;
      const id = options.newId();
      const added = await media.add(
        toUser,
        {
          maxFiles: MEDIA_ACCOUNT_MAX_FILES,
          maxBytes: MEDIA_ACCOUNT_MAX_BYTES,
        },
        {
          id,
          path,
          kind: entry.kind,
          contentType: entry.contentType,
          bytes: await object.arrayBuffer(),
          sha256: entry.sha256,
          gitSha: entry.gitSha,
          alt: entry.alt,
          createdAt: options.now,
        },
      );
      if (!added) throw new MediaRoomError(plan.copy.length, plan.bytes);
      copied.push(id);
      newIdOf.set(entry.id, id);
    }
    // Posters after every file is in, since a poster may be copied after
    // the video that points at it.
    for (const { source: entry } of plan.copy) {
      const video = newIdOf.get(entry.id);
      const poster = entry.posterId ? newIdOf.get(entry.posterId) : undefined;
      if (video && poster && entry.kind === 'video') {
        await media.setPoster(toUser, video, poster);
      }
    }
  } catch (error) {
    await removeCopies(db, bucket, toUser, copied);
    throw error;
  }

  return {
    snapshot: {
      ...snapshot,
      files: renameMediaReferences(snapshot.files, plan.renames),
    },
    copied,
  };
}

/** Take back what a remix copied, when the remix itself did not land. */
export async function removeCopies(
  db: D1Database,
  bucket: R2Bucket,
  userId: string,
  ids: readonly string[],
): Promise<void> {
  const media = new MediaStore(db, bucket);
  for (const id of ids) {
    await media.remove(userId, id).catch(() => undefined);
  }
}
