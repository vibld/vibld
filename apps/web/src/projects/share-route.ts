/**
 * Where a shared project lives in the address bar, and what its token looks
 * like (docs/decisions.md, "Resolved 2026-09-28", sharing).
 *
 * `/s/<token>`, a path like `/p/<id>` (`project-route.ts`) and for the same
 * reasons: the SPA fallback serves the shell on any path with no Worker
 * change, and the fragment belongs to the GitHub callback. The Worker reads
 * the same rules from here (`worker/share-link.ts`), so the link it hands
 * the owner and the path the shell recognises cannot disagree.
 *
 * Pure, so the rules are testable without a DOM.
 */

/** 32 random bytes in unpadded base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export const SHARE_PATH_PREFIX = '/s/';

export function sharePath(token: string): string {
  return `${SHARE_PATH_PREFIX}${token}`;
}

export function shareUrl(origin: string, token: string): string {
  return `${origin}${sharePath(token)}`;
}

/**
 * The token a path names, or null. A trailing slash is the same address;
 * anything deeper, or a token of the wrong shape, is not a share link, and
 * the shell treats it as it treats any other unknown path.
 */
export function shareTokenFromPath(pathname: string): string | null {
  const match = /^\/s\/([^/]+)\/?$/.exec(pathname);
  return match && isShareToken(match[1]) ? match[1] : null;
}

/**
 * The token in a share link as somebody pasted it, or null.
 *
 * An operator acting on a report has whatever the report carried: the
 * whole address, the address without its scheme, or only the token. All
 * three name the same link, so all three are read, and nothing else is.
 */
export function shareTokenFromLink(value: string): string | null {
  const trimmed = value.trim();
  if (isShareToken(trimmed)) return trimmed;
  const match = /\/s\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(trimmed);
  return match && isShareToken(match[1]) ? match[1] : null;
}

/**
 * The query a signed-out viewer's press leaves on the link, so the page
 * they come back to after signing in carries on with what they asked for:
 * a remix, or starting the live preview, which also needs somebody signed
 * in (docs/decisions.md, 2026-09-28).
 */
export const REMIX_INTENT_PARAM = 'remix';
export const PREVIEW_INTENT_PARAM = 'preview';

/** What a signed-out viewer asked for, to be done once they are signed in. */
export type ShareIntent = 'remix' | 'preview';

export function intentParam(intent: ShareIntent): string {
  return intent === 'remix' ? REMIX_INTENT_PARAM : PREVIEW_INTENT_PARAM;
}

/** The link, carrying `intent` on for after the sign-in. */
export function shareIntentPath(token: string, intent: ShareIntent): string {
  return `${sharePath(token)}?${intentParam(intent)}=1`;
}

/** The intent a link's query carries, if any. */
export function intentFromSearch(search: string): ShareIntent | null {
  const params = new URLSearchParams(search);
  if (params.has(REMIX_INTENT_PARAM)) return 'remix';
  if (params.has(PREVIEW_INTENT_PARAM)) return 'preview';
  return null;
}
