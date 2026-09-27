import type { ProjectFile } from '@vibld/core';
import { referencedMedia } from '@vibld/core';

import type { MediaEntry } from './media-store.ts';

/**
 * The media a pushed project needs, as the files a repository holds.
 *
 * A generated page references uploads by absolute path (`/media/hero.mp4`),
 * and Vibld serves those from the media library. A repository has no media
 * library, so the files go into it as `public/media/<name>`, which is where
 * Vite serves `/media/<name>` from: the exported project then runs with
 * ordinary npm commands and shows the same images and video (ADR-0002).
 *
 * Only what the code references. A library can hold thirty files; a push
 * carries the ones this checkpoint uses.
 *
 * Bounded per file and in total. A Worker holds the file it is sending in
 * memory, with its base64 (a third larger) and the request body built from
 * that, inside an isolate of 128 MB; the push reads one file at a time and
 * lets it go before the next, so the per-file bound is what keeps it inside
 * that. The total keeps one push's time bounded. A file past either bound
 * is left out and named, rather than the push failing or the Worker running
 * out of memory: the code is still worth pushing, and the person is told
 * which file to add by hand.
 */

export const MAX_EXPORT_MEDIA_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_EXPORT_MEDIA_BYTES = 32 * 1024 * 1024;

export interface ExportPlan {
  /** Library entries to read and push, with the path each goes to. */
  include: { entry: MediaEntry; path: string }[];
  /** Referenced files left out, by the path the page uses. */
  skipped: string[];
}

export function planMediaExport(
  files: readonly ProjectFile[],
  library: readonly MediaEntry[],
  limit = MAX_EXPORT_MEDIA_BYTES,
  fileLimit = MAX_EXPORT_MEDIA_FILE_BYTES,
): ExportPlan {
  // The same reading of "referenced" preview and publish serve by.
  const referenced = new Set(referencedMedia(files));
  const present = new Set(files.map((file) => file.path));
  const include: ExportPlan['include'] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const entry of library) {
    if (!referenced.has(entry.path)) continue;
    const path = `public/${entry.path}`;
    // The project shipped its own file there; it wins, as it does when
    // the site is served.
    if (present.has(path)) continue;
    if (entry.bytes > fileLimit || total + entry.bytes > limit) {
      skipped.push(`/${entry.path}`);
      continue;
    }
    total += entry.bytes;
    include.push({ entry, path });
  }
  return { include, skipped };
}

/**
 * Where each piece of media the code references lives in a repository
 * (`public/media/<name>`), unless the project ships a file there itself.
 *
 * A push that does not carry one of these (too large, unreadable, or a
 * library that could not be read) keeps whatever the repository already
 * holds at that path rather than deleting it: the person may have added a
 * large video by hand after an earlier push named it in `skippedMedia`.
 */
export function mediaPathsToKeep(files: readonly ProjectFile[]): string[] {
  const present = new Set(files.map((file) => file.path));
  return referencedMedia(files)
    .map((path) => `public/${path}`)
    .filter((path) => !present.has(path));
}

/**
 * Bytes as base64, a chunk at a time: small enough chunks not to overflow
 * the call stack, and a multiple of three bytes each so every chunk's
 * base64 ends on a whole group and the pieces join into the whole. No
 * binary string of the entire file is ever built.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 3 * 0x2000;
  const parts: string[] = [];
  for (let at = 0; at < bytes.length; at += CHUNK) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(at, at + CHUNK))));
  }
  return parts.join('');
}
