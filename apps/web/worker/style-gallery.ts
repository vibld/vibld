import {
  checkColorEdits,
  isStyleGalleryId,
  styleColorSubjectOf,
  styleGalleryDirection,
  styleGalleryGuidance,
  styleTokensFile,
  withColorEdits,
} from '@vibld/ai/style-gallery';
import type {
  StyleColorEdits,
  StyleGalleryEntry,
} from '@vibld/ai/style-gallery';

import type { PrincipalDenied, PrincipalGranted } from './principal.ts';

/**
 * `/api/style-gallery`: the style gallery's picker cards (docs/decisions.md,
 * D142, D144), and with `?style=<id>` one style's colors and contrast pairs
 * for the color editor (D147).
 *
 * The cards are a file the build writes beside the builder's own assets
 * (`scripts/style-gallery-assets.ts`), read here through the assets binding
 * rather than imported, because the gallery is far too large for the
 * Worker's bundle. The Worker answers every `/_style-gallery/*` request
 * itself and refuses it (`isStyleGalleryAssetPath`), so the files reach
 * nobody except through this route, which only a signed-in, invited caller
 * passes.
 */

export interface StyleGalleryEnv {
  /** The builder's static assets (wrangler.jsonc, `assets.binding`). */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

type Resolve = (
  request: Request,
) => Promise<PrincipalDenied | PrincipalGranted>;

export const STYLE_GALLERY_ASSETS = '/_style-gallery/';

/** A path the build wrote for the Worker, never to be served as it is. */
export function isStyleGalleryAssetPath(pathname: string): boolean {
  return pathname.startsWith(STYLE_GALLERY_ASSETS);
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * A JSON file the build wrote beside the builder's assets, by its absolute
 * path, or null when the build wrote none. The assets binding answers a
 * missing file with the single-page app's `index.html` and a 200
 * (`not_found_handling`), so a response is only the file if it is JSON.
 */
export async function readJsonAsset(
  env: StyleGalleryEnv,
  origin: string,
  path: string,
): Promise<Response | null> {
  if (!env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(new URL(path, origin)));
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('json')) {
    await response.body?.cancel();
    return null;
  }
  return response;
}

/** One of the gallery's files, or null when the build wrote none. */
export function readStyleGalleryAsset(
  env: StyleGalleryEnv,
  origin: string,
  file: string,
): Promise<Response | null> {
  return readJsonAsset(env, origin, `${STYLE_GALLERY_ASSETS}${file}`);
}

export async function handleStyleGallery(
  request: Request,
  env: StyleGalleryEnv,
  resolve: Resolve,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const resolved = await resolve(request);
  if (resolved.denied) return resolved.denied;
  const origin = new URL(request.url).origin;
  // One style's colors and contrast pairs, for the color editor (D147).
  const id = new URL(request.url).searchParams.get('style');
  if (id !== null) {
    if (!isStyleGalleryId(id)) return json({ error: 'Unknown style.' }, 404);
    const file = await readStyleGalleryAsset(env, origin, `styles/${id}.json`);
    if (!file) return json({ error: 'Unknown style.' }, 404);
    const entry = (await file.json()) as StyleGalleryEntry;
    return new Response(
      JSON.stringify({ id: entry.id, ...styleColorSubjectOf(entry) }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'private, max-age=3600',
          vary: 'Authorization',
        },
      },
    );
  }
  const cards = await readStyleGalleryAsset(env, origin, 'cards.json');
  // No file is a copy built without the gallery's data: an empty gallery,
  // not an error.
  if (!cards) return json([]);
  return new Response(cards.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The same for everybody and fixed for a deploy, but behind sign-in,
      // so a cached copy is only reused for the same credentials.
      'cache-control': 'private, max-age=3600',
      vary: 'Authorization',
    },
  });
}

/**
 * What a build in a gallery style needs from the style's own entry: its
 * tokens file (D145) and what the model is told (D146, the gallery's
 * baseline rules, then the style's build prompt), and the shorter
 * direction a mockup run is given. Null when this copy's gallery has no
 * such style.
 */
export async function readGalleryStyle(
  env: StyleGalleryEnv,
  origin: string,
  id: string,
  edits: StyleColorEdits = {},
): Promise<
  | { ok: true; tokens: string; guidance: string; direction: string }
  | { ok: false; problems: string[] }
  | null
> {
  if (!isStyleGalleryId(id)) return null;
  const response = await readStyleGalleryAsset(
    env,
    origin,
    `styles/${id}.json`,
  );
  if (!response) return null;
  const entry = (await response.json()) as StyleGalleryEntry;
  if (entry.id !== id) return null;
  const baselineFile = await readStyleGalleryAsset(
    env,
    origin,
    'baseline.json',
  );
  const baseline = baselineFile
    ? ((await baselineFile.json()) as { baseline?: unknown }).baseline
    : '';
  // The theme guard again (D147): the builder ran it before saving, and a
  // request is the person's to send.
  const guard = checkColorEdits(entry, edits);
  if (!guard.ok) return { ok: false, problems: guard.problems };
  return {
    ok: true,
    tokens: styleTokensFile(withColorEdits(entry, edits)),
    guidance: styleGalleryGuidance(
      typeof baseline === 'string' ? baseline : '',
      entry,
      edits,
    ),
    direction: styleGalleryDirection(withColorEdits(entry, edits)),
  };
}
