/**
 * The waitlist submission, with no Workers runtime behind it.
 *
 * Validation and the Resend request are pure functions so they are testable
 * without deploying anything -- the same reason apps/web keeps its spend
 * arithmetic out of the Durable Object that applies it.
 */

/**
 * Deliberately permissive. This gates what reaches Resend, not what counts as
 * a valid email address in general -- rejecting a real address here loses a
 * signup, while a slightly-too-permissive check only means Resend's own
 * validation (or a bounced confirmation, once double opt-in exists) catches
 * the rest.
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export interface WaitlistSubmission {
  email: string;
  /**
   * Honeypot field. A real visitor never sees or fills it -- it is hidden
   * from sighted and screen-reader users alike (see the form component) --
   * so any value here means a bot filled every field it could find.
   */
  company: string;
  /**
   * Cloudflare Turnstile's response token (docs/decisions.md L29). Empty
   * when the widget never ran -- no JavaScript, or a caller that skipped
   * the browser entirely -- which `verifyTurnstile` below treats the same
   * as a token that failed verification, not as a separate case: either
   * way, nothing proved a person is here.
   */
  turnstileToken: string;
}

export type WaitlistResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid-email' | 'spam-honeypot' | 'invalid-body' };

/** Reads and validates a submission from either an HTML form post or JSON. */
export async function parseWaitlistSubmission(
  request: Request,
): Promise<WaitlistSubmission | null> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      return {
        email: typeof body.email === 'string' ? body.email : '',
        company: typeof body.company === 'string' ? body.company : '',
        turnstileToken:
          typeof body['cf-turnstile-response'] === 'string'
            ? body['cf-turnstile-response']
            : '',
      };
    }
    const form = await request.formData();
    return {
      email: String(form.get('email') ?? ''),
      company: String(form.get('company') ?? ''),
      // The widget injects this field into the form itself (see
      // WaitlistForm.tsx) -- nothing here has to read it out separately.
      turnstileToken: String(form.get('cf-turnstile-response') ?? ''),
    };
  } catch {
    return null;
  }
}

export function validateSubmission(
  submission: WaitlistSubmission | null,
): WaitlistResult {
  if (!submission) return { ok: false, reason: 'invalid-body' };
  // A filled honeypot fails closed but still looks like success to the
  // caller (see the Worker) -- telling a bot which field gave it away only
  // teaches it to stop filling that one.
  if (submission.company.trim().length > 0) {
    return { ok: false, reason: 'spam-honeypot' };
  }
  if (!isPlausibleEmail(submission.email)) {
    return { ok: false, reason: 'invalid-email' };
  }
  return { ok: true, email: submission.email.trim().toLowerCase() };
}

/** The `data-action` WaitlistForm's widget declares -- verified server-side too. */
export const WAITLIST_TURNSTILE_ACTION = 'waitlist';

/** The only hostnames this site is ever served from -- see wrangler.jsonc's routes. */
export const WAITLIST_HOSTNAMES = new Set(['vibld.com', 'www.vibld.com']);

/**
 * Builds the Turnstile siteverify request. Returned rather than sent, same
 * reason as `resendContactRequest` below --
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
 * Decides whether a siteverify response actually clears this submission.
 * `success` alone is not enough: it is also what Turnstile returns for a
 * token issued to a *different* site or action, so a leaked or replayed
 * token from elsewhere would otherwise pass.
 */
export function isTurnstileVerified(
  result: TurnstileSiteverifyResponse,
): boolean {
  return (
    result.success &&
    result.action === WAITLIST_TURNSTILE_ACTION &&
    typeof result.hostname === 'string' &&
    WAITLIST_HOSTNAMES.has(result.hostname)
  );
}

/**
 * Builds the Resend request. Returned rather than sent so the shape of the
 * call is testable without a network -- see the Resend contacts API:
 * https://resend.com/docs/api-reference/contacts/create-contact
 */
export function resendContactRequest(
  email: string,
  segmentId: string,
  apiKey: string,
): { url: string; init: RequestInit } {
  return {
    url: 'https://api.resend.com/contacts',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, segments: [{ id: segmentId }] }),
    },
  };
}
