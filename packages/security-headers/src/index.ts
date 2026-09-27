/**
 * The response headers vibld.com and app.vibld.com send on every request.
 *
 * One object rather than one per site, because the two sites were sending
 * none of these and the reason was that nobody owned the question. Both are
 * Cloudflare Workers serving a single origin over TLS, and every header
 * below is decided by that fact rather than by what the site does, so a
 * second copy could only ever drift.
 *
 * Two mechanisms are needed to deliver them, which is a Cloudflare fact
 * rather than a choice: a `_headers` file applies only to responses served
 * from the static asset store, and never to a response a Worker generated.
 * So `app.vibld.com`, whose Worker runs first on `/api/*` alone, ships
 * `apps/web/public/_headers` (written by `headersFile()`) for its shell and
 * calls `secured()` in the Worker for its API, while `vibld.com`, whose
 * Worker runs first on everything (`run_worker_first: true`, for the www
 * redirect), can only use `secured()`.
 */

/**
 * What every response carries.
 *
 * Lower-cased names, so the same object can be read back from a `Headers`
 * (which lower-cases) and written into a `_headers` file without a second
 * spelling of each name.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  /**
   * A year, and deliberately without `includeSubDomains` or `preload`.
   *
   * Both of those are close to irreversible: a browser that has seen them
   * refuses plain HTTP for every current and future subdomain of vibld.com
   * until the max-age runs out, and `preload` additionally bakes the name
   * into browser binaries. Every subdomain in use today is HTTPS-only, so
   * the stronger form would work, but it would also be a promise made on
   * behalf of subdomains nobody has created yet. The apex and the app each
   * send this header for themselves, which is what protects the two
   * hostnames that exist.
   */
  'strict-transport-security': 'max-age=31536000',

  /** No MIME sniffing. A JSON error must never be run as a script. */
  'x-content-type-options': 'nosniff',

  /**
   * Full URL within a site, origin only when leaving it.
   *
   * The builder's URLs are not secret, but they do name a project, and the
   * default a browser applies is already this. Sending it means the answer
   * does not change with the browser.
   */
  'referrer-policy': 'strict-origin-when-cross-origin',

  /**
   * Deny the capabilities neither site has any use for.
   *
   * Nothing here is in `payment=()`, on purpose: billing is a redirect to
   * checkout.stripe.com today, so denying it would cost nothing today and
   * would silently break the day checkout moves in-page. A denial that has
   * to be remembered at exactly the moment it starts mattering is a trap,
   * so this list is the features the sites will not use rather than the
   * features they do not use yet.
   */
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), browsing-topics=()',

  /**
   * `frame-ancestors` and nothing else, which is the whole of what can be
   * verified from here.
   *
   * A script-restricting CSP is not shipped, and not because it would not
   * help. Two specific things make it unverifiable in this environment.
   * The marketing build emits a per-page inline hydration script, so
   * `script-src` there needs a nonce or a per-build hash set, and a wrong
   * one turns the site into a blank page. The app shell loads Clerk, whose
   * hosted components fetch and inject at sign-in time; nothing short of a
   * live sign-in shows whether a policy holds, and this environment cannot
   * drive one (its Chromium will not trust the agent proxy's CA). Shipping
   * an unverified policy to the two production hostnames is how a launch
   * gets a white screen nobody can reproduce.
   *
   * `frame-ancestors` has neither problem: nothing frames either site --
   * the builder frames a sandbox and its own `srcdoc` documents, never
   * itself -- and a browser that disagreed would show it immediately.
   */
  'content-security-policy': "frame-ancestors 'none'",

  /**
   * The same refusal for a client too old to read the line above. One
   * decision, written twice because two generations of browser read two
   * different headers, not two decisions that could disagree.
   */
  'x-frame-options': 'DENY',
};

/**
 * The same response, carrying the headers above.
 *
 * Rebuilt rather than mutated: a `Headers` on a response that came from a
 * binding is immutable and throws on `set`, and a site that 500s is worse
 * than one missing a header. The body is passed through, not read, so a
 * streamed response stays streamed.
 */
export function secured(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The same headers as a Cloudflare `_headers` file, for the asset store.
 *
 * A generator rather than a hand-written file so the app's shell and the
 * app's API cannot come to send different headers. `apps/web/public/_headers`
 * is what this returns, and a test there fails if the checked-in file has
 * stopped matching.
 *
 * `/*` because every path on app.vibld.com that the asset store answers is
 * the shell: `not_found_handling` is `single-page-application`, so an
 * unknown path is `index.html` rather than a miss.
 */
export function headersFile(
  /**
   * Headers this one site sends that the other must not (#192 review).
   *
   * Everything in `SECURITY_HEADERS` is decided by facts both sites share,
   * which is why there is one object. Indexing is the first thing that is
   * genuinely per-site: the marketing site wants to be found and the
   * builder is an invite-only application whose every page needs an
   * account. Putting that in the shared set would have told vibld.com not
   * to be indexed.
   */
  extra: Readonly<Record<string, string>> = {},
): string {
  const lines = ['# Generated by @vibld/security-headers. Do not edit.', '/*'];
  for (const [name, value] of Object.entries({
    ...SECURITY_HEADERS,
    ...extra,
  })) {
    lines.push(`  ${name}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}
