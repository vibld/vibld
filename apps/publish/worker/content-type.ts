/**
 * Content-Type inference for served static files, by extension.
 *
 * R2 stores whatever bytes `putFiles` wrote it, with no metadata of its
 * own attached in this Worker's usage (see publish-store.ts) -- so the
 * public fetch handler must recover a Content-Type from the request path
 * alone, the same thing any conventional static file server does.
 */

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

const DEFAULT_TYPE = 'application/octet-stream';

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return DEFAULT_TYPE;
  const ext = path.slice(dot + 1).toLowerCase();
  return TYPES[ext] ?? DEFAULT_TYPE;
}
