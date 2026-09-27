import {
  MEDIA_ACCOUNT_MAX_BYTES,
  MEDIA_ACCOUNT_MAX_FILES,
  MEDIA_VIDEO_MAX_BYTES,
  maxBytesFor,
  cleanAlt,
  mediaPathFor,
  sniffMedia,
} from '@vibld/core';

import { blobShaOfBytes } from './github-push.ts';
import { MediaStore } from './media-store.ts';
import type { MediaEntry } from './media-store.ts';
import type { PrincipalDenied, PrincipalGranted } from './principal.ts';

/**
 * `/api/media`: the caller's own media library.
 *
 * POST uploads one file as the raw request body, never as JSON or a form.
 * The body is an image or a video, so a JSON envelope would be a third of
 * it again in base64, and a form would be a request a cross-site page can
 * make without the browser asking first. An `image/*` or `video/*` body
 * with an Authorization header is neither: the browser preflights it.
 *
 * GET lists the library and what it may still hold. DELETE removes one
 * file by id. POST is behind the invite gate, because storing is spending;
 * GET and DELETE are not, because an account whose access was revoked must
 * still be able to see and remove what it put here.
 */

export interface MediaEnv {
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
  MEDIA_BURST?: RateLimit;
}

type Resolve = (
  request: Request,
) => Promise<PrincipalDenied | PrincipalGranted>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** A header the browser percent-encoded, decoded, or `''` if it cannot be. */
function header(request: Request, name: string): string {
  const raw = request.headers.get(name) ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

/**
 * The body, read up to `limit` bytes and no further.
 *
 * `content-length` is checked first and is the common refusal, but it is
 * the client's claim; a chunked body has none. So the stream is counted as
 * it is read and abandoned the moment it passes the limit, rather than
 * buffered whole and measured afterwards.
 */
async function readBounded(
  request: Request,
  limit: number,
): Promise<ArrayBuffer | 'too-large' | 'empty'> {
  if (!request.body) return 'empty';
  const reader = request.body.getReader();
  // With a declared length the bytes go straight into one buffer, so a
  // 40 MB video costs 40 MB here rather than its chunks and a copy.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isInteger(declared) && declared > 0 && declared <= limit) {
    const out = new Uint8Array(declared);
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.byteLength > declared) {
        await reader.cancel().catch(() => undefined);
        return 'too-large';
      }
      out.set(value, at);
      at += value.byteLength;
    }
    return at === 0 ? 'empty' : out.buffer.slice(0, at);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return 'too-large';
    }
    chunks.push(value);
  }
  if (total === 0) return 'empty';
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const MB = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export async function handleMedia(
  request: Request,
  env: MediaEnv,
  resolve: Resolve,
  options: { now?: () => Date; newId?: () => string } = {},
): Promise<Response> {
  if (!env.DB || !env.PROJECT_CONTENT) {
    return json({ error: 'Media is not configured for this deployment.' }, 503);
  }
  const store = new MediaStore(env.DB, env.PROJECT_CONTENT);

  if (request.method === 'POST') {
    // Shape and size before identity, so a hostile request is refused
    // before it costs a token verification.
    // What the file is comes from its bytes alone (`sniffMedia` below).
    // This only refuses the types a cross-site form can send without a
    // preflight: `application/octet-stream`, which a browser reports for a
    // file it cannot type, is as good as `image/*` or `video/*` here.
    const contentType = (
      request.headers.get('content-type') ?? ''
    ).toLowerCase();
    if (!/^(?:image\/|video\/|application\/octet-stream\b)/.test(contentType)) {
      return json({ error: 'Upload an image or a video file.' }, 415);
    }
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) {
      return json({ error: 'Cross-site requests are not allowed.' }, 403);
    }
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MEDIA_VIDEO_MAX_BYTES) {
      return json(
        { error: `Files can be at most ${MB(MEDIA_VIDEO_MAX_BYTES)}.` },
        413,
      );
    }
  } else if (request.method !== 'GET' && request.method !== 'DELETE') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const resolved = await resolve(request);
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;

  if (request.method === 'GET') {
    const [media, usage] = await Promise.all([
      store.list(userId),
      store.usage(userId),
    ]);
    return json({
      media,
      usage: {
        ...usage,
        maxBytes: MEDIA_ACCOUNT_MAX_BYTES,
        maxFiles: MEDIA_ACCOUNT_MAX_FILES,
      },
    });
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!id) return json({ error: '"id" is required.' }, 400);
    let removed: boolean;
    try {
      removed = await store.remove(userId, id);
    } catch (error) {
      // The file is still listed, so trying again removes it.
      console.error('media removal failed', error);
      return json({ error: 'The file could not be removed. Try again.' }, 503);
    }
    return removed
      ? json({ removed: id })
      : json({ error: 'No such file.' }, 404);
  }

  if (env.MEDIA_BURST) {
    try {
      const limited = await env.MEDIA_BURST.limit({ key: `media:${userId}` });
      if (!limited.success) {
        return json({ error: 'Too many uploads. Try again shortly.' }, 429);
      }
    } catch (error) {
      console.error('media rate limiter unavailable', error);
    }
  }

  const usage = await store.usage(userId);
  if (usage.files >= MEDIA_ACCOUNT_MAX_FILES) {
    return json(
      {
        error: `Your library holds at most ${MEDIA_ACCOUNT_MAX_FILES} files. Remove one to add another.`,
      },
      409,
    );
  }
  const room = MEDIA_ACCOUNT_MAX_BYTES - usage.bytes;
  const body = await readBounded(
    request,
    Math.min(MEDIA_VIDEO_MAX_BYTES, Math.max(0, room)),
  );
  if (body === 'empty') return json({ error: 'The file is empty.' }, 400);
  if (body === 'too-large') {
    return json(
      {
        error:
          room < MEDIA_VIDEO_MAX_BYTES
            ? `That would take your library past ${MB(MEDIA_ACCOUNT_MAX_BYTES)}. Remove something first.`
            : `Files can be at most ${MB(MEDIA_VIDEO_MAX_BYTES)}.`,
      },
      413,
    );
  }

  // What the file is, from its bytes. The name and the Content-Type are
  // the uploader's to choose, and neither decides anything here.
  const type = sniffMedia(
    new Uint8Array(body, 0, Math.min(32, body.byteLength)),
  );
  if (!type) {
    return json(
      {
        error:
          'Only JPEG, PNG, GIF, WebP and AVIF images and MP4 or WebM video can be used.',
      },
      415,
    );
  }
  if (body.byteLength > maxBytesFor(type.kind)) {
    return json(
      {
        error: `${type.kind === 'video' ? 'Videos' : 'Images'} can be at most ${MB(maxBytesFor(type.kind))}.`,
      },
      413,
    );
  }

  const posterFor = header(request, 'x-media-poster-for');
  if (posterFor) {
    if (type.kind !== 'image') {
      return json({ error: 'A poster must be an image.' }, 400);
    }
    if ((await store.kindOf(userId, posterFor)) !== 'video') {
      return json({ error: 'That video is not in your library.' }, 404);
    }
  }

  const alt = cleanAlt(header(request, 'x-media-alt'));
  const id = options.newId?.() ?? crypto.randomUUID();
  const sha256 = hex(await crypto.subtle.digest('SHA-256', body));
  const gitSha = await blobShaOfBytes(new Uint8Array(body));
  const createdAt = (options.now?.() ?? new Date()).toISOString();

  // The path is chosen against the library as it stands, so two uploads of
  // the same name at once can choose the same one. The second then loses on
  // the unique path and chooses again, as it would have uploading after.
  let entry: MediaEntry | undefined;
  for (let attempt = 0; ; attempt++) {
    const existing = await store.list(userId);
    const path = mediaPathFor(
      header(request, 'x-media-name') || 'media',
      type.ext,
      new Set(existing.map((item) => item.path)),
    );
    try {
      entry = await store.add(
        userId,
        {
          maxFiles: MEDIA_ACCOUNT_MAX_FILES,
          maxBytes: MEDIA_ACCOUNT_MAX_BYTES,
        },
        {
          id,
          path,
          kind: type.kind,
          contentType: type.contentType,
          bytes: body,
          sha256,
          gitSha,
          alt,
          createdAt,
        },
      );
      break;
    } catch (error) {
      if (attempt < 3 && /UNIQUE constraint failed/i.test(String(error))) {
        continue;
      }
      console.error('media upload failed', error);
      return json({ error: 'The file could not be stored. Try again.' }, 503);
    }
  }
  if (!entry) {
    // Another upload landed while this one was being read.
    return json(
      {
        error: `That would take your library past ${MEDIA_ACCOUNT_MAX_FILES} files or ${MB(MEDIA_ACCOUNT_MAX_BYTES)}. Remove something first.`,
      },
      409,
    );
  }
  if (posterFor) await store.setPoster(userId, posterFor, entry.id);
  return json({ media: entry }, 201);
}
