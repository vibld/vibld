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

const ORIGIN =
  process.argv[2] ??
  process.env.VIBLD_SMOKE_ORIGIN ??
  'https://vibld-web-preview.chris-brock-llc.workers.dev';

const results = [];
function check(name, fn) {
  results.push({ name, fn });
}

async function head(path, init = {}) {
  return fetch(new URL(path, ORIGIN), { redirect: 'manual', ...init });
}

check('the origin is reachable', async () => {
  const response = await head('/');
  if (response.status === 0) throw new Error('no response from the origin');
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

check('/api/preview never answers a signed-out caller with 200', async () => {
  // 401 (Clerk configured, caller isn't signed in) and 503 (PREVIEW isn't
  // configured on this deployment yet) are both a safe "closed"; either is
  // fine here. Only 200 would mean anyone can spend sandbox container time.
  const response = await head('/api/preview', { method: 'POST' });
  if (response.status === 200) {
    throw new Error(
      "/api/preview answered 200 for a signed-out caller. That would mean anyone can spend the account's sandbox budget.",
    );
  }
});

check(
  '/api/stripe/webhook refuses a request with no Stripe-Signature header',
  async () => {
    // Confirms the endpoint checks for a signature before doing anything else
    // with the body -- not a full forged-signature test, which needs the
    // deployment's own webhook secret and has no business living in a smoke
    // test that runs with no credentials.
    const response = await head('/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
    });
    if (response.status === 200) {
      throw new Error(
        '/api/stripe/webhook answered 200 with no Stripe-Signature header.',
      );
    }
  },
);

check('/api/billing/* never answers a signed-out caller with 200', async () => {
  // Same closed set as above: 401 (Clerk gate) or 503 (Stripe unconfigured
  // on this deployment) are both fine. Only 200 would mean anyone can start
  // a Checkout or Billing Portal session as somebody else's account.
  for (const path of ['/api/billing/checkout', '/api/billing/portal']) {
    const response = await head(path, { method: 'POST' });
    if (response.status === 200) {
      throw new Error(`${path} answered 200 for a signed-out caller.`);
    }
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
