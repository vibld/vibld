import { referencedMedia, serveLibraryMedia } from '@vibld/core';
import type { MediaBucket, ProjectFile } from '@vibld/core';

/**
 * `/media/<name>` on a published site: the owner's uploaded file, served
 * from the media library rather than from the site's own files.
 *
 * Media never passes through a build. Generated code references it by
 * absolute path, `/media/hero.mp4`, and a published site's files are text
 * (the build service keeps only text output), so the bytes are served from
 * where the upload put them: `media/<user>/<id>` in R2, found through the
 * `project_media` row for that path.
 *
 * Reached only after `resolveSlug`, which refuses a site that is
 * unpublished or held. An operator hold therefore withholds a site's media
 * exactly as it withholds its pages; there is no second door to the bytes.
 */
export const serveMedia = serveLibraryMedia;
export type { MediaBucket };

/**
 * Where a revision records which media its own files reference.
 *
 * Written with the revision, so it is pruned, discarded and taken down with
 * it, and read back when a `/media/` request arrives: the library is the
 * whole account's, and a site serves only the part of it the site uses.
 * The list is public already (it is what the pages name), so it is served
 * like any other file of the site.
 */
export const MEDIA_MANIFEST_PATH = '__vibld/media.json';

/**
 * `files` plus the revision's media manifest. A file the project shipped
 * at the manifest's path is replaced: the manifest is what decides what
 * the site may serve, so it cannot be something the site wrote itself.
 */
export function withMediaManifest(files: ProjectFile[]): ProjectFile[] {
  const own = files.filter((file) => file.path !== MEDIA_MANIFEST_PATH);
  return [
    ...own,
    {
      path: MEDIA_MANIFEST_PATH,
      content: JSON.stringify(referencedMedia(own)),
    },
  ];
}

/**
 * The media paths a revision may serve, from its manifest. A revision with
 * no manifest (published before there was a media library) or one that
 * does not parse may serve none.
 */
export function readMediaManifest(
  content: string | undefined,
): ReadonlySet<string> {
  if (content === undefined) return new Set();
  try {
    const parsed: unknown = JSON.parse(content);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((path): path is string => typeof path === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}
