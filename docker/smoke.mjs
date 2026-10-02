#!/usr/bin/env node
/**
 * Checks a vibld started with `docker compose up` (docs/decisions.md D126):
 * the three Workers answer, the owner signs in with the password, and the
 * builder then reports what it can do. Used by CI's Docker job.
 *
 *   VIBLD_OWNER_PASSWORD=... node docker/smoke.mjs [seconds to wait]
 *
 * With VIBLD_LOCAL_MODEL set as it is in .env, it also checks that the
 * local model is offered (D124).
 *
 * Starting a preview is not checked here: the end-to-end check does that
 * with a real build (D122).
 *
 * With VIBLD_SANDBOX=off (D141) only the builder runs, on PORT.
 */
import { PORTS, sandboxOn } from '../scripts/docker-config.mjs';
import { builderPort } from './start.mjs';

const BUILDER = `http://localhost:${builderPort(process.env)}`;
const RUNNING = sandboxOn(process.env)
  ? Object.entries(PORTS)
  : [['web', builderPort(process.env)]];

/** Wait until a URL answers anything at all, or give up. */
async function answers(url, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return response.status;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error(`${url} did not answer in time`);
}

async function main(seconds = 600) {
  const password = process.env.VIBLD_OWNER_PASSWORD;
  if (!password) throw new Error('Set VIBLD_OWNER_PASSWORD to sign in with.');
  const deadline = Date.now() + seconds * 1000;
  for (const [app, port] of RUNNING) {
    const status = await answers(`http://localhost:${port}/`, deadline);
    console.log(`${app} answers on ${port} (${status})`);
  }

  const refused = await fetch(`${BUILDER}/api/config`);
  if (refused.status !== 401) {
    throw new Error(
      `/api/config answered ${refused.status} signed out, not 401`,
    );
  }

  const wrong = await fetch(`${BUILDER}/api/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BUILDER },
    body: JSON.stringify({ password: `${password}-wrong` }),
  });
  if (wrong.status !== 401) {
    throw new Error(`a wrong password answered ${wrong.status}, not 401`);
  }

  const signIn = await fetch(`${BUILDER}/api/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BUILDER },
    body: JSON.stringify({ password }),
  });
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
  if (signIn.status !== 200 || !cookie) {
    throw new Error(`signing in answered ${signIn.status}`);
  }
  console.log('the owner signs in');

  const config = await fetch(`${BUILDER}/api/config`, {
    headers: { cookie },
  });
  const body = await config.json();
  if (config.status !== 200 || body.isAdmin !== true) {
    throw new Error(
      `/api/config answered ${config.status} ${JSON.stringify(body)}`,
    );
  }
  console.log(
    `the builder answers signed in: generation "${body.generation}", ${body.models.length} models`,
  );

  // Alone on one port, the builder previews in the browser (D125, D141).
  const expected = sandboxOn(process.env) ? 'sandbox' : 'browser';
  if (body.preview !== expected) {
    throw new Error(`previews run in "${body.preview}", not "${expected}"`);
  }
  console.log(`previews run in the ${expected}`);

  // A local model set in .env reaches the builder, offered by its own name
  // (D124). No server needs to answer for it to be listed.
  const local = process.env.VIBLD_LOCAL_MODEL;
  if (local) {
    const listed = body.models.find((model) => model.id === 'local');
    if (listed?.label !== `Local: ${local}`) {
      throw new Error(
        `the local model ${local} is not offered: ${JSON.stringify(body.models)}`,
      );
    }
    console.log(`the local model is offered as "${listed.label}"`);
  }
}

main(Number(process.argv[2]) || undefined).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
