#!/usr/bin/env node
/**
 * Assert what the deployed Worker actually does, over HTTP.
 *
 * Every other check in this repository tests source. None of them could have
 * caught the failure that cost two days: Cloudflare Access answering
 * /api/plan with a cross-origin 302, which a browser's fetch follows and CORS
 * then refuses, surfacing as an unreadable "Load failed". The code was
 * correct. The deployment's behaviour was not what anyone assumed.
 *
 * So this talks to the real origin and asserts the contract a signed-out
 * caller must see. It needs no credentials, which is the point: it can run
 * after every deploy without anyone holding a session.
 *
 * docs/decisions.md L5: Cloudflare Access is off. Clerk is a Bearer-token
 * check now, not a redirect, so a signed-out caller sees a plain 401 rather
 * than a cross-origin bounce -- there is no redirect-following pitfall left
 * to assert against, only that the endpoint still refuses to answer.
 *
 * Usage: node scripts/smoke.mjs [origin]
 */

// `||`, not `??`: the deploy workflow always sets VIBLD_SMOKE_ORIGIN (even to
// an empty string, when wrangler's output didn't contain a URL to read --
// see deploy-web-preview.yml), and `??` only falls through for null/undefined,
// not '' -- an empty string would otherwise reach `new URL('/', '')` below
// and fail every check with an opaque "Invalid URL" instead of this default.
//
// app.vibld.com (docs/decisions.md L20), not the old *.workers.dev address:
// adding that custom domain route disabled the workers.dev route entirely
// (wrangler's own default once any custom domain exists), so the old address
// now 404s rather than reaching this Worker at all.
const ORIGIN =
  process.argv[2] || process.env.VIBLD_SMOKE_ORIGIN || 'https://app.vibld.com';

const results = [];
function check(name, fn) {
  results.push({ name, fn });
}

async function head(path, init = {}) {
  return fetch(new URL(path, ORIGIN), { redirect: 'manual', ...init });
}

/**
 * A refusal has to be one of the refusals the route is written to give.
 *
 * "Anything but 200" was the rule until the harness review (#59), and it let
 * a 500 through: a Worker throwing on every request passed every check here,
 * because an exception is not a 200. Naming the statuses a closed route
 * answers with means a crash, a 404 from a lost route and a redirect all
 * fail, which is what a smoke test after a deploy is for.
 */
function expectStatus(path, response, allowed, why) {
  if (!allowed.includes(response.status)) {
    throw new Error(
      `${path} answered ${response.status}, expected ${allowed.join(' or ')}. ${why}`,
    );
  }
}

check('the origin serves the app shell', async () => {
  const response = await head('/');
  expectStatus('/', response, [200], 'The builder did not load.');
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('text/html')) {
    throw new Error(`/ answered with ${type || 'no content type'}, not HTML.`);
  }
});

check('Clerk gates the API for a signed-out caller', async () => {
  // run_worker_first routes /api/* to the Worker; the SPA shell at / is
  // served straight from assets and carries no gate of its own -- the
  // endpoints that spend money are what must refuse an anonymous caller.
  //
  // A real caller always sends Content-Type: application/json (every
  // browser-side client in src/ does) -- this probe does too, so it reaches
  // and actually exercises the Clerk gate, rather than being refused a step
  // earlier by /api/plan's own content-type/origin check
  // (request-guard.ts's checkRequestOrigin, which runs before identity is
  // ever checked and would otherwise answer 415 here first -- also a closed
  // refusal, just not the one this check means to assert).
  for (const path of ['/api/config', '/api/plan']) {
    const response = await head(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (response.status !== 401) {
      throw new Error(
        `${path} answered ${response.status} for a signed-out caller, expected 401. ` +
          "A 200 here would mean anyone can spend the account's model budget.",
      );
    }
  }
});

check('/api/preview refuses a signed-out caller', async () => {
  // 401 (Clerk configured, caller isn't signed in) and 503 (PREVIEW isn't
  // configured on this deployment yet) are the two closed answers. A 200
  // would mean anyone can spend sandbox container time; anything else means
  // the route is broken.
  const response = await head('/api/preview', { method: 'POST' });
  expectStatus(
    '/api/preview',
    response,
    [401, 503],
    "A 200 would mean anyone can spend the account's sandbox budget.",
  );
});

check(
  '/api/stripe/webhook refuses a request with no Stripe-Signature header',
  async () => {
    // Confirms the endpoint checks for a signature before doing anything else
    // with the body -- not a full forged-signature test, which needs the
    // deployment's own webhook secret and has no business living in a smoke
    // test that runs with no credentials.
    //
    // 400 is the missing-signature refusal, 503 is billing not configured on
    // this deployment (billing-handlers.ts checks that first).
    const response = await head('/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
    });
    expectStatus(
      '/api/stripe/webhook',
      response,
      [400, 503],
      'A 200 would mean an unsigned request reached the billing ledger.',
    );
  },
);

check('/api/billing/* refuses a signed-out caller', async () => {
  // Same closed set as above: 401 (Clerk gate) or 503 (Stripe unconfigured
  // on this deployment). A 200 would mean anyone can start a Checkout or
  // Billing Portal session as somebody else's account.
  for (const path of ['/api/billing/checkout', '/api/billing/portal']) {
    const response = await head(path, { method: 'POST' });
    expectStatus(
      path,
      response,
      [401, 503],
      "A 200 would let anyone open a billing session on someone's account.",
    );
  }
});

const failures = [];
for (const { name, fn } of results) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}`);
    console.log(`        ${error instanceof Error ? error.message : error}`);
  }
}

console.log(
  `\n${results.length - failures.length}/${results.length} checks passed against ${ORIGIN}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
