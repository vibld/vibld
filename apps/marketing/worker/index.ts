import {
  type AnalyticsDataset,
  type Attribution,
  attributionFrom,
  pathOf,
  record,
} from './analytics.ts';
import {
  isTurnstileVerified,
  parseWaitlistSubmission,
  resendContactRequest,
  turnstileVerifyRequest,
  validateSubmission,
} from './waitlist.ts';

export interface Env {
  /** Worker secret. Never reaches the browser. */
  RESEND_API_KEY?: string;
  /** Public identifier, not a secret -- the vibld-waitlist segment in Resend. */
  VIBLD_WAITLIST_SEGMENT_ID?: string;
  /**
   * Worker secret, pairs with the public site key baked into WaitlistForm.tsx
   * (docs/decisions.md L29). Unset means the Turnstile check is skipped
   * rather than the endpoint refusing every submission -- the widget is
   * defense in depth on top of the honeypot, not something this endpoint
   * has ever required to keep working.
   */
  TURNSTILE_SECRET_KEY?: string;
  /** Workers Analytics Engine dataset. Absent in local dev; see worker/analytics.ts. */
  ANALYTICS?: AnalyticsDataset;
}

/**
 * `run_worker_first: ["/api/*"]` in wrangler.jsonc routes only that pattern
 * here; every other request is served straight from the prerendered build
 * before this Worker is ever invoked, so this fetch handler only ever needs
 * to know about `/api/*` paths.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      return handleWaitlist(request, env);
    }
    if (url.pathname === '/api/hit' && request.method === 'POST') {
      return handleHit(request, env);
    }
    return new Response('Not found', { status: 404 });
  },
};

/** True for a plain HTML form post; false for a fetch() call expecting JSON. */
function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const CONFIRMATION_PAGE = (message: string, ok: boolean) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ok ? "You're on the list — Vibld" : 'Something went wrong — Vibld'}</title>
<meta name="robots" content="noindex">
</head>
<body style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.25rem;color:#1a1a1a">
<p style="font-size:1.125rem">${message}</p>
<p><a href="/" style="color:#c2540a">← Back to vibld.com</a></p>
</body>
</html>`;

/**
 * Resolves the attribution the caller reported. The waitlist form and the
 * page beacon both send the page's own URL and referrer, because the Worker
 * sees only its own `/api/*` URL -- not the page the visitor was actually on.
 */
function attributionOf(
  request: Request,
  pageUrl: string,
  pageReferrer: string,
): { attribution: Attribution; path: string } {
  const url = pageUrl || request.url;
  const selfHost = new URL(request.url).hostname;
  return {
    attribution: attributionFrom(url, pageReferrer, selfHost),
    path: pathOf(url),
  };
}

/**
 * The pageview beacon. Answers 204 unconditionally and as early as possible:
 * the caller is a fire-and-forget `sendBeacon` that ignores the response, and
 * a failed measurement must never surface to a visitor.
 */
async function handleHit(request: Request, env: Env): Promise<Response> {
  try {
    const form = await request.formData();
    const { attribution, path } = attributionOf(
      request,
      String(form.get('page_url') ?? ''),
      String(form.get('page_referrer') ?? ''),
    );
    record(env.ANALYTICS, 'pageview', request, attribution, path);
  } catch (error) {
    console.error('hit failed', error);
  }
  return new Response(null, { status: 204 });
}

async function handleWaitlist(request: Request, env: Env): Promise<Response> {
  const html = wantsHtml(request);
  const submission = await parseWaitlistSubmission(request);
  const result = validateSubmission(submission);

  if (!result.ok) {
    // The honeypot case reports success to the caller -- see waitlist.ts --
    // so only a genuinely malformed or invalid submission is an error here.
    if (result.reason === 'spam-honeypot') {
      return html
        ? htmlResponse(CONFIRMATION_PAGE("You're on the list.", true), 200)
        : jsonResponse({ ok: true }, 200);
    }
    const message =
      result.reason === 'invalid-email'
        ? 'That does not look like a valid email address.'
        : 'The form could not be read. Please try again.';
    return html
      ? htmlResponse(CONFIRMATION_PAGE(message, false), 400)
      : jsonResponse({ ok: false, error: message }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const { url, init } = turnstileVerifyRequest(
      submission!.turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      request.headers.get('cf-connecting-ip') ?? undefined,
    );

    let verified = false;
    try {
      const response = await fetch(url, init);
      verified = response.ok && isTurnstileVerified(await response.json());
    } catch (error) {
      console.error('Turnstile verification request threw', error);
    }

    if (!verified) {
      // Same treatment as the honeypot case above, and for the same reason:
      // telling a bot specifically that Turnstile caught it only teaches it
      // to solve Turnstile, not to give up.
      return html
        ? htmlResponse(CONFIRMATION_PAGE("You're on the list.", true), 200)
        : jsonResponse({ ok: true }, 200);
    }
  }

  if (!env.RESEND_API_KEY || !env.VIBLD_WAITLIST_SEGMENT_ID) {
    // Misconfiguration, not a caller error -- reported as a server failure
    // rather than pretending the signup worked.
    console.error(
      'Waitlist is not configured: missing RESEND_API_KEY or VIBLD_WAITLIST_SEGMENT_ID',
    );
    const message =
      'Signups are temporarily unavailable. Please try again shortly.';
    return html
      ? htmlResponse(CONFIRMATION_PAGE(message, false), 503)
      : jsonResponse({ ok: false, error: message }, 503);
  }

  const { url, init } = resendContactRequest(
    result.email,
    env.VIBLD_WAITLIST_SEGMENT_ID,
    env.RESEND_API_KEY,
  );

  let resendOk = false;
  try {
    const response = await fetch(url, init);
    if (response.ok) {
      resendOk = true;
    } else {
      // Resend does not document the status for a duplicate email (see
      // worker/waitlist.ts's comment). Treating "already exists" as success
      // means someone who signs up twice sees confirmation, not an error,
      // which is the experience that matters -- not the exact status code.
      const body = await response.text().catch(() => '');
      resendOk = /already exists|duplicate/i.test(body);
      if (!resendOk) {
        console.error('Resend contact creation failed', response.status, body);
      }
    }
  } catch (error) {
    console.error('Resend request threw', error);
  }

  if (!resendOk) {
    const message = 'Something went wrong. Please try again in a moment.';
    return html
      ? htmlResponse(CONFIRMATION_PAGE(message, false), 502)
      : jsonResponse({ ok: false, error: message }, 502);
  }

  // Recorded only after Resend accepted the contact, so the signup count in
  // the dataset means signups that exist, not submissions that were attempted.
  const { attribution, path } = attributionOf(
    request,
    submission?.pageUrl ?? '',
    submission?.pageReferrer ?? '',
  );
  record(env.ANALYTICS, 'signup', request, attribution, path);

  const message = "You're on the list. We'll email you when Vibld is ready.";
  return html
    ? htmlResponse(CONFIRMATION_PAGE(message, true), 200)
    : jsonResponse({ ok: true }, 200);
}
