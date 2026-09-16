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
  /**
   * The prerendered build, bound by wrangler.jsonc's `assets`.
   *
   * Production used to serve pages from these assets without invoking this
   * Worker at all (`run_worker_first: ["/api/*"]`). That is no longer true,
   * and the reason is `canonicalHost` below: a redirect can only be issued
   * by something the request reaches, and a page request never reached here.
   *
   * Typed by the one method this file calls rather than as `Fetcher`, which
   * would mean pulling the Workers type package into an app that otherwise
   * needs none of it.
   */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /**
   * Set to "1" on preview deployments only (wrangler.preview.jsonc).
   *
   * A preview of this site is a byte-for-byte copy of vibld.com on a public
   * hostname. Left indexable it competes with the real site for the name,
   * which is the exact problem the marketing work is trying to solve, so a
   * copy that can outrank the original is worse than having no preview.
   */
  VIBLD_NOINDEX?: string;
}

/**
 * Every request arrives here now (`run_worker_first: true`), not only
 * `/api/*`, and the site's own pages are served from the `ASSETS` binding at
 * the bottom of this handler.
 *
 * That changed to make one hostname canonical. `_redirects`, the mechanism
 * built for exactly this, cannot do it: Cloudflare documents domain-level
 * redirects as unsupported there, and says in as many words that its rules
 * are not applied to requests a Worker serves. A second Worker bound to
 * `www.vibld.com` alone would have kept the apex free of invocations, but a
 * custom domain belongs to one Worker at a time, so moving it is a step
 * nothing in CI can take unattended, and a marketing site that is down
 * because a deploy needed a human is worse than one that costs a Worker
 * invocation per request.
 *
 * So that is the trade, stated rather than buried: every asset request on
 * this site now runs this script. At this site's size that is a rounding
 * error against the Workers Paid request allowance, and the thing bought
 * with it is that `vibld.com` is the only hostname that ever answers 200.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // First, before any route or asset. A redirect that runs after the thing
    // it is redirecting away from has already answered is not a redirect.
    const canonical = canonicalHost(url);
    if (canonical) {
      return new Response(null, {
        // A 301 turns a POST into a GET in most clients, which for
        // `/api/waitlist` would silently discard somebody's signup. 308 is
        // the same permanent redirect with the method and body preserved, so
        // the two are split by method rather than one being chosen for both.
        // GET and HEAD keep 301 because it is the status every crawler and
        // link checker already understands.
        status:
          request.method === 'GET' || request.method === 'HEAD' ? 301 : 308,
        headers: { location: canonical },
      });
    }

    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      return handleWaitlist(request, env);
    }
    if (url.pathname === '/api/hit' && request.method === 'POST') {
      return handleHit(request, env);
    }

    // Last, so an `/api/` route is never served as a page. `VIBLD_NOINDEX` is
    // set on the preview deployment only, and keeps a byte-for-byte copy of
    // this site out of the index; production serves the same bytes without
    // that header.
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      return env.VIBLD_NOINDEX === '1' ? noindex(response) : response;
    }
    return new Response('Not found', { status: 404 });
  },
};

/**
 * Where this request should have gone, or null when it is already there.
 *
 * Only a leading `www.` is stripped, and only that: this Worker answers on
 * `vibld.com`, on `www.vibld.com`, and on a `workers.dev` preview hostname,
 * and the preview must keep serving itself rather than redirecting reviewers
 * to production.
 *
 * The path and query survive, so a shared `www` link to a legal page or a
 * campaign URL lands on the same page with its UTM parameters intact rather
 * than on the home page. The fragment is not handled because it is never
 * sent: the browser reattaches it to whatever this points at.
 */
export function canonicalHost(url: URL): string | null {
  if (!url.hostname.startsWith('www.')) return null;
  const canonical = new URL(url.toString());
  canonical.hostname = url.hostname.slice('www.'.length);
  return canonical.toString();
}

/**
 * The same response, told not to be indexed.
 *
 * Rebuilt rather than mutated: an immutable `Headers` on a response from a
 * binding throws on `set`, and a preview that 500s is not a preview.
 */
function noindex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
<title>${ok ? "You're on the list -- Vibld" : 'Something went wrong -- Vibld'}</title>
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
 *
 * Two candidates, in order, and the same rule applied to both: it counts only
 * if it names a page on this site.
 *
 * The rule is one function rather than a check at each branch because the
 * first version of this checked only the `Referer` fallback and trusted
 * whatever `page_url` a caller sent. `/api/hit` and `/api/waitlist` both take
 * unauthenticated posts, so that was an open door: anyone could write
 * `/their/page` and `utm_campaign=whatever` straight into this site's
 * traffic report. Per-branch checks are how the second branch gets forgotten.
 *
 * The last resort is deliberately not `request.url`. The no-JavaScript form
 * post is a supported path, and there `page_url` is the empty value the page
 * was prerendered with, so falling back to the Worker's own URL filed every
 * such signup under `/api/waitlist`: a path nobody visited, splitting the
 * real page's numbers rather than merely rounding them. A browser sends
 * `Referer` on a form navigation, and for a same-origin post it sends the
 * full URL, so the query string and its UTM parameters survive with it.
 *
 * What this does not claim: a caller can still send a plausible same-host URL
 * and be believed. Every field here is reported by the client and none of it
 * can be proved. The check removes the ability to write arbitrary paths and
 * campaigns from anywhere, which is worth having; it does not make an
 * unauthenticated beacon trustworthy, and nothing short of not having one
 * would.
 */
function attributionOf(
  request: Request,
  pageUrl: string,
  pageReferrer: string,
): { attribution: Attribution; path: string } {
  const selfHost = new URL(request.url).hostname;
  const url =
    onThisSite(pageUrl, selfHost) ??
    onThisSite(request.headers.get('referer'), selfHost) ??
    '';
  return {
    attribution: attributionFrom(url, pageReferrer, selfHost),
    // With nothing believable to go on, "/" is an honest guess at where a
    // visitor was. `pathOf` answers "/" for a value it cannot parse.
    path: pathOf(url),
  };
}

/** A URL, but only when it names a page on this site. */
function onThisSite(
  candidate: string | null | undefined,
  selfHost: string,
): string | null {
  if (!candidate) return null;
  try {
    return new URL(candidate).hostname === selfHost ? candidate : null;
  } catch {
    // Relative, malformed, or not a URL at all. All the same answer: this is
    // not something to record a path from.
    return null;
  }
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

  // Three outcomes, not two. A duplicate is a success to the person and not a
  // signup to the dataset, and collapsing the two into one boolean is what
  // made the count wrong.
  let outcome: 'created' | 'duplicate' | 'failed' = 'failed';
  try {
    const response = await fetch(url, init);
    if (response.ok) {
      outcome = 'created';
    } else {
      // Resend does not document the status for a duplicate email (see
      // worker/waitlist.ts's comment). Treating "already exists" as success
      // means someone who signs up twice sees confirmation, not an error,
      // which is the experience that matters -- not the exact status code.
      const body = await response.text().catch(() => '');
      if (/already exists|duplicate/i.test(body)) {
        outcome = 'duplicate';
      } else {
        console.error('Resend contact creation failed', response.status, body);
      }
    }
  } catch (error) {
    console.error('Resend request threw', error);
  }

  if (outcome === 'failed') {
    const message = 'Something went wrong. Please try again in a moment.';
    return html
      ? htmlResponse(CONFIRMATION_PAGE(message, false), 502)
      : jsonResponse({ ok: false, error: message }, 502);
  }

  // Recorded only for a contact Resend actually created, so the signup count
  // in the dataset means signups that exist, not submissions that were
  // attempted. A returning visitor re-submitting an address that is already on
  // the list created nothing, and counting it would inflate the conversion
  // rate and re-attribute an old contact to whatever campaign brought them
  // back -- the two numbers this dataset exists to answer.
  if (outcome === 'created') {
    const { attribution, path } = attributionOf(
      request,
      submission?.pageUrl ?? '',
      submission?.pageReferrer ?? '',
    );
    record(env.ANALYTICS, 'signup', request, attribution, path);
  }

  const message = "You're on the list. We'll email you when Vibld is ready.";
  return html
    ? htmlResponse(CONFIRMATION_PAGE(message, true), 200)
    : jsonResponse({ ok: true }, 200);
}
