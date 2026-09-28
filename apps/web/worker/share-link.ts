/**
 * The Worker's half of a project's share link (docs/decisions.md, "Resolved
 * 2026-09-28", sharing): making a token, and naming the sandbox a shared
 * project's live preview runs in. The shape of a token and of the link are
 * the builder's rules (`src/projects/share-route.ts`), read from there so
 * the two cannot drift.
 */

export {
  isShareToken,
  shareTokenFromLink,
  shareUrl,
} from '../src/projects/share-route.ts';

/** Random bytes in a token: 256 bits, so guessing one is not a strategy. */
export const SHARE_TOKEN_BYTES = 32;

/**
 * A fresh token. Never derived from the project, its id or its owner: the
 * link is meant to reveal nothing about either beyond what is shared, and
 * a token that could be computed from an id would be one somebody could
 * compute.
 */
export function newShareToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The sandbox a shared project's live preview runs in.
 *
 * One per link rather than one per viewer: a stranger opening the link
 * starts, at most, the one sandbox every other viewer of the same link is
 * then shown, so what a link costs is bounded by the link and not by how
 * far it travels.
 *
 * Derived from the token by a hash rather than from the project id, because
 * the sandbox's name is part of its preview address
 * (`{port}-{sandboxId}-{token}.vibld-preview.dev`) and every viewer sees
 * that address. A backfilled project's id is its owner's Clerk user id, and
 * putting that in a stranger's address bar is exactly what the link must
 * not do. The token is already the viewer's, so a name computed from it
 * tells them nothing new, and turning the link off and on again moves the
 * preview to a new sandbox along with the new link.
 *
 * Lower-case hex after a fixed prefix: a name the preview service's host
 * parsing accepts (`apps/preview/worker/media-route.ts`), and one no Clerk
 * user id can be, so it can never be somebody's own sandbox.
 */
export async function sharePreviewKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`vibld-share-preview:${token}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `shared-${hex.slice(0, 32)}`;
}
