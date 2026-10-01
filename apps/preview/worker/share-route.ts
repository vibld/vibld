import { subdomainOrigin } from '@vibld/core';

import { verifyShare } from './share-token.ts';

/**
 * Where a share link lives, and how a request to it is answered
 * (docs/decisions.md L10, internal issue 222).
 *
 * Each share has an origin of its own, `sh-<shareId>.<preview domain>`.
 * The shared app is ordinary web code: it loads `/@vite/client`,
 * `/src/main.tsx` and `/media/hero.jpg` by absolute path, and those can
 * carry no credentials in the URL. So the link is redeemed once, at
 * `/__vibld/share?s=&exp=&sig=`, into a cookie holding the same signed
 * grant, and every request after that is authorised by the cookie.
 *
 * One origin per share is what makes the cookie safe. On a single share
 * host every shared app would run on the same origin as every other, and
 * one app's code could reach another share the same viewer has open
 * through whichever cookie was set last. Here a cookie belongs to one
 * share's host and nothing else can send or read it.
 *
 * Pure: the Worker (`index.ts`) turns these answers into responses and
 * the proxying `PreviewSandbox.proxyShared` already does, which still
 * checks revocation and expiry against the grant it stores.
 */

/** Host-only, Secure and path `/` by construction: the `__Host-` prefix. */
export const SHARE_COOKIE = '__Host-vibld_share';

/** Where a share link lands, and the one path the shared app never sees. */
export const SHARE_REDEEM_PATH = '/__vibld/share';

/** The share id a request's hostname names, if it is a share host. */
export function shareIdFromHost(
  hostname: string,
  previewHostname: string | undefined,
): string | undefined {
  if (!previewHostname) return undefined;
  const suffix = `.${previewHostname}`;
  if (!hostname.endsWith(suffix)) return undefined;
  const label = hostname.slice(0, -suffix.length);
  // `crypto.randomUUID()`, as `createShare` mints: lowercase hex and
  // hyphens, a valid hostname label as it stands.
  return /^sh-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
    label,
  )?.[1];
}

/** The link a share is handed out as. */
export function shareLink(
  previewHostname: string,
  sandboxId: string,
  shareId: string,
  expiresAt: number,
  signature: string,
): string {
  const url = new URL(
    `${subdomainOrigin(`sh-${shareId}`, previewHostname)}${SHARE_REDEEM_PATH}`,
  );
  url.searchParams.set('s', sandboxId);
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

interface Grant {
  sandboxId: string;
  expiresAt: number;
  signature: string;
}

function cookieValue(grant: Grant): string {
  return `${encodeURIComponent(grant.sandboxId)}~${grant.expiresAt}~${grant.signature}`;
}

/** The grant a request's cookies carry for this share host, if any. */
export function readGrant(cookieHeader: string | null): Grant | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== SHARE_COOKIE) continue;
    const value = part.slice(at + 1).trim();
    // The signature and the expiry are the last two fields and contain no
    // `~`; the sandbox id is everything before them.
    const fields = value.split('~');
    if (fields.length < 3) return undefined;
    const signature = fields.pop()!;
    const expiresAt = Number(fields.pop());
    let sandboxId: string;
    try {
      sandboxId = decodeURIComponent(fields.join('~'));
    } catch {
      return undefined;
    }
    if (!sandboxId || !Number.isFinite(expiresAt) || !signature) {
      return undefined;
    }
    return { sandboxId, expiresAt, signature };
  }
  return undefined;
}

/** A Cookie header with this share's cookie taken out, or null if none is left. */
export function withoutGrantCookie(cookieHeader: string | null): string | null {
  const kept = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        part.slice(0, part.indexOf('=')).trim() !== SHARE_COOKIE,
    );
  return kept.length > 0 ? kept.join('; ') : null;
}

export type ShareAnswer =
  /** The link was valid: set the cookie and send the viewer to `/`. */
  | { kind: 'redeem'; setCookie: string; location: string }
  /** Serve this request from `sandboxId`'s preview, under `shareId`. */
  | { kind: 'proxy'; sandboxId: string; shareId: string }
  /** Refuse, and say why. */
  | { kind: 'deny'; status: number; message: string };

/**
 * What a request to a share host gets. The signature is checked on every
 * request, not only at redemption, so a cookie cannot be edited into
 * another sandbox or a later expiry.
 */
export async function answerShare(
  url: URL,
  cookieHeader: string | null,
  shareId: string,
  secret: string,
  now: number,
): Promise<ShareAnswer> {
  if (url.pathname === SHARE_REDEEM_PATH) {
    const sandboxId = url.searchParams.get('s') ?? '';
    const expiresAt = Number(url.searchParams.get('exp'));
    const signature = url.searchParams.get('sig') ?? '';
    if (!sandboxId || !Number.isFinite(expiresAt) || !signature) {
      return { kind: 'deny', status: 400, message: 'Invalid share link.' };
    }
    if (expiresAt < now) {
      return {
        kind: 'deny',
        status: 403,
        message: 'This share link has expired.',
      };
    }
    if (!(await verifyShare(secret, shareId, expiresAt, signature))) {
      return {
        kind: 'deny',
        status: 403,
        message: 'This share link is invalid.',
      };
    }
    const maxAge = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    return {
      kind: 'redeem',
      setCookie: `${SHARE_COOKIE}=${cookieValue({ sandboxId, expiresAt, signature })}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      location: '/',
    };
  }

  const grant = readGrant(cookieHeader);
  if (!grant) {
    return {
      kind: 'deny',
      status: 403,
      message: 'Open the share link again to view this preview.',
    };
  }
  if (grant.expiresAt < now) {
    return {
      kind: 'deny',
      status: 403,
      message: 'This share link has expired.',
    };
  }
  if (!(await verifyShare(secret, shareId, grant.expiresAt, grant.signature))) {
    return {
      kind: 'deny',
      status: 403,
      message: 'This share link is invalid.',
    };
  }
  return { kind: 'proxy', sandboxId: grant.sandboxId, shareId };
}
