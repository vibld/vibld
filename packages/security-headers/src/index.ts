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
 *
 * Published sites get a smaller set of their own, `PUBLISHED_SITE_HEADERS`,
 * applied by apps/publish with `withDefaultHeaders()` (D64).
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
  return rebuilt(response, (headers) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
  });
}

/**
 * What a published site (`<slug>.vibld-preview.dev`) carries, when the site
 * has not said otherwise (D64).
 *
 * Its own set rather than `SECURITY_HEADERS`, because the facts that decide
 * that one are not true here. vibld.com and app.vibld.com are pages Vibld
 * wrote; a published site is a page a user's prompt wrote, and it is theirs
 * to embed a video in, load a font from anywhere, run a third-party widget
 * and be framed by whoever they like. So nothing below restricts what the
 * page may load or who may frame it: no CSP of any kind, no
 * `X-Frame-Options`. Each of those would break somebody's site in a way
 * neither they nor we would see until a visitor did.
 *
 * Written out rather than spread from `SECURITY_HEADERS`, although three of
 * the values are the same today. A change made for the two Vibld hostnames
 * should not arrive on every user's site as a side effect.
 */
export const PUBLISHED_SITE_HEADERS: Readonly<Record<string, string>> = {
  /**
   * A year, without `includeSubDomains` or `preload`.
   *
   * The directive would not reach the other sites: sent by
   * `acme.vibld-preview.dev`, it covers `*.acme.vibld-preview.dev` and not
   * `other.vibld-preview.dev`, which sends its own. What it would cover is
   * two labels deep, and nothing there is HTTPS. The zone's free
   * certificate covers one level only, and apps/preview does not forward a
   * dotted label here (`publish-route.ts`). `preload` needs the apex to
   * send the header, and the apex is not a published site.
   */
  'strict-transport-security': 'max-age=31536000',

  /**
   * No MIME sniffing. This Worker decides every type from the extension
   * (`content-type.ts`), so a type is never a guess the browser should
   * second-guess.
   */
  'x-content-type-options': 'nosniff',

  /**
   * The browser's own default, sent so it does not vary by browser: a site's
   * full URL within the site, its origin only when a visitor leaves.
   */
  'referrer-policy': 'strict-origin-when-cross-origin',

  /**
   * Device and payment access a generated marketing site has no use for.
   *
   * This also binds every iframe on the page, so the list stops at what the
   * site itself would have to be asking for. Features an ordinary embed
   * delegates to its frame (`autoplay`, `fullscreen`, `encrypted-media`,
   * `picture-in-picture`, `clipboard-write`, `web-share`, the motion
   * sensors a 360-degree video reads, `xr-spatial-tracking` for a 3D
   * viewer) are left alone. `browsing-topics` is too: it is an advertising
   * choice, and a user running ads on their own site gets to make it.
   *
   * `payment=()` turns off the Payment Request API, so an in-page wallet
   * button (Apple Pay, Google Pay) inside an embedded checkout does not
   * appear. A link out to a hosted checkout is unaffected.
   */
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), display-capture=()',
};

/**
 * The same response, with each of `defaults` it does not already carry.
 *
 * `secured` has the last word, which is right for pages Vibld wrote. This
 * one never does: a header already on the response is the site's own
 * decision, or a more specific one made nearer the bytes, and is kept as
 * it is. Rebuilt for the reason `secured` is.
 */
export function withDefaultHeaders(
  response: Response,
  defaults: Readonly<Record<string, string>>,
): Response {
  return rebuilt(response, (headers) => {
    for (const [name, value] of Object.entries(defaults)) {
      if (!headers.has(name)) headers.set(name, value);
    }
  });
}

function rebuilt(
  response: Response,
  edit: (headers: Headers) => void,
): Response {
  const headers = new Headers(response.headers);
  edit(headers);
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
   * Headers this one site sends that the other must not (internal PR 192 review).
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
