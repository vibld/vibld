import {
  parseWaitlistSubmission,
  resendContactRequest,
  validateSubmission,
} from './waitlist.ts';

export interface Env {
  /** Worker secret. Never reaches the browser. */
  RESEND_API_KEY?: string;
  /** Public identifier, not a secret -- the vibld-waitlist segment in Resend. */
  VIBLD_WAITLIST_SEGMENT_ID?: string;
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

  const message = "You're on the list. We'll email you when Vibld is ready.";
  return html
    ? htmlResponse(CONFIRMATION_PAGE(message, true), 200)
    : jsonResponse({ ok: true }, 200);
}
