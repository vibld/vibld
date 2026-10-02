import { readJsonAsset } from './style-gallery.ts';
import type { StyleGalleryEnv } from './style-gallery.ts';
import type { PrincipalDenied, PrincipalGranted } from './principal.ts';

/**
 * `/api/templates/brief?id=<id>`: one design template's brief, for the
 * builder's Templates option (docs/decisions.md, D148), which adds it to the
 * message as a template from vibld.com does (D106).
 *
 * The briefs are files the build writes beside the builder's assets
 * (`scripts/template-assets.ts`), read through the assets binding because
 * the catalog is far too large for the Worker's bundle or the builder's.
 * The Worker answers `/_templates/*` itself and refuses it.
 */

type Resolve = (
  request: Request,
) => Promise<PrincipalDenied | PrincipalGranted>;

const TEMPLATE_ID = /^[a-z0-9-]{1,80}$/;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export async function handleTemplateBrief(
  request: Request,
  env: StyleGalleryEnv,
  resolve: Resolve,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const resolved = await resolve(request);
  if (resolved.denied) return resolved.denied;
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  if (!TEMPLATE_ID.test(id)) return json({ error: 'Unknown template.' }, 404);
  const file = await readJsonAsset(
    env,
    url.origin,
    `/_templates/briefs/${id}.json`,
  );
  if (!file) return json({ error: 'Unknown template.' }, 404);
  return new Response(file.body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=3600',
      vary: 'Authorization',
    },
  });
}
