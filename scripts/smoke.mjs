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
  for (const path of ['/api/config', '/api/plan']) {
    const response = await head(path, { method: 'POST' });
    if (response.status !== 401) {
      throw new Error(
        `${path} answered ${response.status} for a signed-out caller, expected 401. ` +
          "A 200 here would mean anyone can spend the account's model budget.",
      );
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
