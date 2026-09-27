/**
 * Media a person uploads for their site: the facts every Worker that
 * touches it has to agree on.
 *
 * apps/web accepts uploads, apps/publish serves them on a published site
 * and apps/preview serves them in a preview. Three deployments, one set of
 * rules about what a media file is, what it is called and how much of it
 * is sent, so the rules live here rather than drifting apart in three
 * copies.
 *
 * What is accepted is decided from the file's own bytes, never from the
 * name or the Content-Type a browser sent, both of which the uploader
 * controls. SVG is refused outright: it is a document that can carry
 * script, and serving somebody's SVG from a site's own origin is a
 * stored-XSS vector with no upside a raster image does not also give.
 */

export type MediaKind = 'image' | 'video';

export interface MediaType {
  contentType: string;
  kind: MediaKind;
  /** The extension the stored file is named with. */
  ext: string;
}

/** Largest single image, in bytes. */
export const MEDIA_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Largest single video, in bytes. A hero loop is seconds long, not minutes. */
export const MEDIA_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
/** Everything one account may store, in bytes. */
export const MEDIA_ACCOUNT_MAX_BYTES = 200 * 1024 * 1024;
/** How many files one account may store. */
export const MEDIA_ACCOUNT_MAX_FILES = 30;
/** Longest alt text kept. */
export const MEDIA_ALT_MAX_CHARS = 300;

/**
 * Alt text as it is stored and as a prompt carries it: one line, no control
 * characters and no lone surrogates, capped at `MEDIA_ALT_MAX_CHARS`.
 *
 * A control character is invisible here and six characters (`\u0001`)
 * once `JSON.stringify` quotes it into a prompt, so leaving them in would
 * let 300 characters of alt text outgrow what a build reserves for them.
 */
export function cleanAlt(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEDIA_ALT_MAX_CHARS)
    .replace(/[\ud800-\udbff]$/, '')
    .trim();
}

export function maxBytesFor(kind: MediaKind): number {
  return kind === 'video' ? MEDIA_VIDEO_MAX_BYTES : MEDIA_IMAGE_MAX_BYTES;
}

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** ISO base media brands a browser plays as MP4. QuickTime (`qt  `) is not one. */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'MSNV',
]);

/**
 * What a file is, from its first bytes, or `null` for anything not on the
 * list: SVG, HTML, QuickTime, a renamed executable.
 */
export function sniffMedia(bytes: Uint8Array): MediaType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', kind: 'image', ext: 'jpg' };
  }
  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return { contentType: 'image/png', kind: 'image', ext: 'png' };
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { contentType: 'image/gif', kind: 'image', ext: 'gif' };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { contentType: 'image/webp', kind: 'image', ext: 'webp' };
  }
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') {
      return { contentType: 'image/avif', kind: 'image', ext: 'avif' };
    }
    if (MP4_BRANDS.has(brand)) {
      return { contentType: 'video/mp4', kind: 'video', ext: 'mp4' };
    }
    return null;
  }
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { contentType: 'video/webm', kind: 'video', ext: 'webm' };
  }
  return null;
}

/** The extensions a stored media path may end in, and what each serves as. */
export const MEDIA_CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

const MEDIA_PATH =
  /^media\/[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|png|gif|webp|avif|mp4|webm)$/;

/**
 * Whether a project-relative path is one this feature could have written:
 * `media/<slug>.<ext>`, nothing nested, nothing that climbs out.
 */
export function isMediaPath(path: string): boolean {
  return MEDIA_PATH.test(path);
}

/**
 * Every media path the project's files name, as `media/<slug>.<ext>`.
 *
 * What a preview or a published site may serve from its owner's library:
 * the files its own pages reference, and nothing else. The library is the
 * whole account's, and a name is easy to guess (`hero.jpg`), so serving any
 * of it from any site would publish an upload meant for another project, or
 * never meant for a page at all, the moment its owner published anything.
 *
 * Read from the text as shipped: source for a preview, built output for a
 * published site, where Vite leaves an absolute public path as the string
 * it was written as.
 */
export function referencedMedia(
  files: readonly { content: string }[],
): string[] {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(
      /(?<![\w./-])\/?(media\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png|gif|webp|avif|mp4|webm))(?![\w-]|\.\w)/g,
    )) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

/**
 * A stored path for an uploaded file: `media/<slug>.<ext>`, unique among
 * `taken`.
 *
 * The name is the uploader's, so it is reduced to lower-case letters,
 * digits and single hyphens before it is used for anything. What is left
 * is what a generated page references (`/media/hero.mp4`), so it stays
 * readable rather than becoming an id.
 */
export function mediaPathFor(
  name: string,
  ext: string,
  taken: ReadonlySet<string>,
): string {
  // The base name first: a name with directory parts in it is somebody's
  // path, not the file's name, and stripping the extension from the whole
  // of `../../etc/passwd` would find the dot in `../`.
  const base = name.split(/[\\/]/).pop() ?? '';
  const stem =
    base
      .replace(/\.[^.]*$/, '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'media';
  let candidate = `media/${stem}.${ext}`;
  for (let n = 2; taken.has(candidate); n += 1) {
    candidate = `media/${stem}-${n}.${ext}`;
  }
  return candidate;
}

/**
 * One byte range from a `Range` header, for a file of `size` bytes.
 *
 * `null` means "send the whole file": no header, or one this does not
 * understand (several ranges, another unit), which the RFC allows a
 * server to ignore. `'unsatisfiable'` means a single range that starts
 * past the end, which is a 416.
 *
 * Video needs this. A browser asks for the part of the file it is about to
 * play and seeks by asking for another part; a server that only ever sends
 * the whole file makes a 40 MB hero loop download in full before Safari
 * plays a frame of it.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return 'unsatisfiable';
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return null;
  return { start, end };
}

/**
 * The response for a media file, whole or in part.
 *
 * `nosniff` because the type was decided from the bytes at upload and the
 * browser must not second-guess it into something executable. Cached for
 * an hour: a path is reused when a person deletes a file and uploads
 * another under the same name, so it cannot be immutable.
 */
/** Whatever `Response` accepts as a body, without naming a DOM-only type. */
type ResponseBody = ConstructorParameters<typeof Response>[0];

export function mediaResponse(options: {
  body: ReadableStream | ArrayBuffer | Uint8Array | null;
  size: number;
  contentType: string;
  range: { start: number; end: number } | null;
  method?: string;
}): Response {
  const headers = new Headers({
    'content-type': options.contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  const head = options.method === 'HEAD';
  if (options.range) {
    const { start, end } = options.range;
    headers.set('content-range', `bytes ${start}-${end}/${options.size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(head ? null : (options.body as ResponseBody), {
      status: 206,
      headers,
    });
  }
  headers.set('content-length', String(options.size));
  return new Response(head ? null : (options.body as ResponseBody), {
    status: 200,
    headers,
  });
}

/** The 416 for a range that starts past the end of the file. */
export function unsatisfiableRange(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'content-range': `bytes */${size}` },
  });
}

/** The R2 key a stored media file lives under. */
export function mediaObjectKey(userId: string, id: string): string {
  return `media/${userId}/${id}`;
}

/** The one D1 call serving a media file needs. */
export interface MediaLibraryDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

/**
 * `/media/<name>` for the account `userId`: the uploaded file, whole or in
 * part, or `undefined` when there is no such file (or the request is not
 * a GET or HEAD for a media path), so the caller can answer as it would
 * for any other missing path.
 *
 * Used by apps/publish, after `resolveSlug` has refused a held or
 * unpublished site, and by apps/preview, after the preview's own token or
 * share grant has been checked. Neither may reach it any other way: this
 * serves whatever `userId` names, so who is asking has to be settled first.
 *
 * `allowed` is the set of paths the site's own files reference
 * (`referencedMedia`). A path outside it is not served, whoever asks.
 */
/** The two R2 calls serving a media file needs, narrowed to what is used. */
export interface MediaBucket {
  head(key: string): Promise<{ size: number } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{ body: ReadableStream } | null>;
}

export async function serveLibraryMedia(
  db: MediaLibraryDb,
  bucket: MediaBucket,
  userId: string,
  pathname: string,
  request: Request,
  allowed: ReadonlySet<string>,
): Promise<Response | undefined> {
  const path = pathname.replace(/^\/+/, '');
  if (!isMediaPath(path) || !allowed.has(path)) return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;

  const row = await db
    .prepare(
      `SELECT id, content_type FROM project_media
        WHERE user_id = ?1 AND path = ?2`,
    )
    .bind(userId, path)
    .first<{ id: string; content_type: string }>();
  if (!row) return undefined;

  const key = mediaObjectKey(userId, row.id);
  const head = await bucket.head(key);
  if (!head) return undefined;

  const range = parseRange(request.headers.get('range'), head.size);
  if (range === 'unsatisfiable') return unsatisfiableRange(head.size);

  if (request.method === 'HEAD') {
    return mediaResponse({
      body: null,
      size: head.size,
      contentType: row.content_type,
      range,
      method: 'HEAD',
    });
  }

  const object = await bucket.get(
    key,
    range
      ? { range: { offset: range.start, length: range.end - range.start + 1 } }
      : undefined,
  );
  if (!object) return undefined;
  return mediaResponse({
    body: object.body,
    size: head.size,
    contentType: row.content_type,
    range,
  });
}
