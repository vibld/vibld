/**
 * Cloudflare Turnstile's server-side check (docs/decisions.md L29), with no
 * Workers runtime behind it.
 *
 * The request is built here and sent by the caller, so its shape is testable
 * without a network -- the same reason apps/web keeps its spend arithmetic
 * out of the Durable Object that applies it. The roadmap's vote
 * (worker/roadmap-api.ts) is the one caller.
 */

/** The only hostnames this site is ever served from -- see wrangler.jsonc's routes. */
export const TURNSTILE_HOSTNAMES = new Set(['vibld.com', 'www.vibld.com']);

/**
 * Builds the Turnstile siteverify request. Returned rather than sent --
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export function turnstileVerifyRequest(
  token: string,
  secretKey: string,
  remoteIp?: string,
): { url: string; init: RequestInit } {
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  return {
    url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  };
}

interface TurnstileSiteverifyResponse {
  success: boolean;
  action?: string;
  hostname?: string;
}

/**
 * Decides whether a siteverify response actually clears this request.
 * `success` alone is not enough: it is also what Turnstile returns for a
 * token issued to a *different* site or action, so a leaked or replayed
 * token from elsewhere would otherwise pass.
 *
 * `action` is the widget's `data-action`, and required: a token issued to
 * one widget cannot be spent on another's endpoint.
 */
export function isTurnstileVerified(
  result: TurnstileSiteverifyResponse,
  action: string,
): boolean {
  return (
    result.success &&
    result.action === action &&
    typeof result.hostname === 'string' &&
    TURNSTILE_HOSTNAMES.has(result.hostname)
  );
}
