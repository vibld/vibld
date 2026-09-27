import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * The builder's half of the media library (`/api/media`): listing,
 * uploading and removing the images and video a generated page can use.
 *
 * JSX-free, like every client module here, so the tests can import it.
 * `components/MediaLibrary.tsx` is the React half.
 */

export interface MediaItem {
  id: string;
  path: string;
  kind: 'image' | 'video';
  contentType: string;
  bytes: number;
  alt: string;
  posterPath?: string;
}

export interface MediaUsage {
  files: number;
  bytes: number;
  maxFiles: number;
  maxBytes: number;
}

export interface MediaLibraryState {
  media: MediaItem[];
  usage: MediaUsage;
}

/** What the file picker offers. The server decides from the bytes anyway. */
export const MEDIA_ACCEPT =
  'image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm';

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

async function authHeaders(
  getToken: GetToken,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isItem(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.path === 'string' &&
    (item.kind === 'image' || item.kind === 'video') &&
    typeof item.bytes === 'number' &&
    typeof item.alt === 'string'
  );
}

/** The library, or `null` when it cannot be read. */
export async function fetchMedia(
  fetchImpl: Fetch = globalThis.fetch.bind(globalThis),
  getToken: GetToken = getClerkToken,
): Promise<MediaLibraryState | null> {
  try {
    const response = await fetchImpl('/api/media', {
      headers: await authHeaders(getToken),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      media?: unknown;
      usage?: Partial<MediaUsage>;
    };
    if (!Array.isArray(body.media) || typeof body.usage !== 'object') {
      return null;
    }
    return {
      media: body.media.filter(isItem),
      usage: {
        files: Number(body.usage.files ?? 0),
        bytes: Number(body.usage.bytes ?? 0),
        maxFiles: Number(body.usage.maxFiles ?? 0),
        maxBytes: Number(body.usage.maxBytes ?? 0),
      },
    };
  } catch {
    return null;
  }
}

export type UploadResult =
  { ok: true; item: MediaItem } | { ok: false; error: string };

/**
 * Upload one file as the raw request body. Name and alt text travel in
 * headers, percent-encoded because a header value is bytes and a file name
 * is anything a person typed.
 */
export async function uploadMedia(
  file: Blob,
  options: { name: string; alt: string; posterFor?: string },
  fetchImpl: Fetch = globalThis.fetch.bind(globalThis),
  getToken: GetToken = getClerkToken,
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/media', {
      method: 'POST',
      headers: {
        ...(await authHeaders(getToken)),
        'content-type': file.type || 'application/octet-stream',
        'x-media-name': encodeURIComponent(options.name),
        'x-media-alt': encodeURIComponent(options.alt),
        ...(options.posterFor
          ? { 'x-media-poster-for': encodeURIComponent(options.posterFor) }
          : {}),
      },
      body: file,
    });
  } catch {
    return { ok: false, error: 'The upload did not reach Vibld. Try again.' };
  }
  let body: { media?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Reported below from the status alone.
  }
  if (!response.ok || !isItem(body.media)) {
    return {
      ok: false,
      error:
        typeof body.error === 'string'
          ? body.error
          : `The upload failed (${response.status}).`,
    };
  }
  return { ok: true, item: body.media };
}

/** Remove one file. `true` when it is gone. */
export async function removeMedia(
  id: string,
  fetchImpl: Fetch = globalThis.fetch.bind(globalThis),
  getToken: GetToken = getClerkToken,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `/api/media?id=${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: await authHeaders(getToken) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** "1.2 MB", "340 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A still from a video, as a JPEG, taken in the browser: about a tenth of
 * the way in (past a fade from black) and never later than two seconds.
 *
 * In the browser because the server cannot decode video; a Worker has no
 * codec. `null` when the browser cannot play this file or draw it, in
 * which case the video is uploaded without a poster and the page falls
 * back to its own background colour until the first frame arrives.
 */
export async function extractPoster(file: Blob): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('unplayable'));
    });
    const at = Math.min(2, (video.duration || 0) / 10);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('unseekable'));
      video.currentTime = at;
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context || canvas.width === 0) return null;
    context.drawImage(video, 0, 0);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85),
    );
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
