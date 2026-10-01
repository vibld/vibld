#!/usr/bin/env node
/**
 * The Wrangler configuration vibld runs with under Docker (docs/decisions.md
 * D126, D137).
 *
 *   node scripts/docker-config.mjs
 *
 * Writes `wrangler.docker.jsonc` beside each Worker (ignored by git), from
 * the same `wrangler.jsonc` the self-host script reads, for `wrangler dev`
 * to run with no Cloudflare account: D1, R2, the Durable Objects, the
 * Workflow and the rate limiters all run in workerd with their data on
 * disk, and each preview's sandbox is a container on the host's Docker
 * (D137). Nothing in it names a Cloudflare resource; the ids are
 * placeholders that only ever reach local storage.
 *
 * What differs from a deployed copy:
 *
 * - Sign-in is the owner's password (D123, `VIBLD_AUTH=owner`): Clerk and
 *   Cloudflare Access are services outside the box.
 * - The builder, previews and published sites are three Workers on three
 *   ports of one host. Previews are `http://<port>-<sandbox>-<token>.
 *   localhost:<PREVIEW_PORT>/`, which browsers resolve to this machine,
 *   and published sites `http://<slug>.localhost:<PUBLISH_PORT>/`.
 * - Settings and keys come from the environment at start
 *   (`docker/entrypoint.sh` writes them to `.dev.vars`), not from here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { APPS, ROOT, parseJsonc, selfHostConfig } from './self-host.mjs';

/** The ports each Worker listens on inside the box, and on the host. */
export const PORTS = /** @type {const} */ ({
  web: 8787,
  preview: 8788,
  publish: 8789,
});

/** Placeholders: local storage only ever sees them. */
const LOCAL_SETTINGS = {
  prefix: 'local',
  d1DatabaseId: '00000000-0000-4000-8000-000000000000',
  auth: 'owner',
  provider: 'openai',
  rateLimitNamespaceBase: 9001,
  previewDomain: 'localhost.invalid',
};

/** Keys `wrangler dev` has no use for, or would reach Cloudflare for. */
const DEPLOY_ONLY = ['routes', 'workers_dev', 'observability', 'limits'];

/**
 * One Worker's configuration under Docker: the self-host configuration,
 * with the hosts made local. Pure: the tests read it directly.
 */
export function dockerConfig(app, base) {
  const config = selfHostConfig(app, base, LOCAL_SETTINGS);
  for (const key of DEPLOY_ONLY) delete config[key];
  config.dev = { ip: '0.0.0.0', port: PORTS[app] };
  const vars = { ...(config.vars ?? {}) };
  if (app === 'preview') {
    vars.PREVIEW_HOSTNAME = `localhost:${PORTS.preview}`;
    // Cloudflare's machine size means nothing on this one. `max_instances`
    // is left as it is: `wrangler dev` does not apply it, and the fleet's
    // own ceiling (apps/preview/worker/capacity.ts) is written to match it.
    for (const container of config.containers ?? []) {
      delete container.instance_type;
    }
  }
  if (app === 'web' || app === 'publish') {
    vars.PUBLISH_HOSTNAME = `localhost:${PORTS.publish}`;
  }
  config.vars = vars;
  const text = JSON.stringify(config);
  if (text.includes('localhost.invalid')) {
    throw new Error(`${app}: a placeholder host was left in the config`);
  }
  return config;
}

function main() {
  for (const app of APPS) {
    const base = parseJsonc(
      readFileSync(join(ROOT, 'apps', app, 'wrangler.jsonc'), 'utf8'),
    );
    const file = join(ROOT, 'apps', app, 'wrangler.docker.jsonc');
    writeFileSync(
      file,
      '// Written by scripts/docker-config.mjs from wrangler.jsonc.\n' +
        '// Do not edit: change that script and run it again.\n' +
        `${JSON.stringify(dockerConfig(app, base), null, 2)}\n`,
    );
    console.log(`wrote ${file}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
