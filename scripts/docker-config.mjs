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
 *
 * With `VIBLD_SANDBOX=off`, for a host that runs one container on one port
 * with no Docker socket (D141): only the builder runs, unbound from the
 * other two, so previews bundle in the viewer's browser (D125), builds are
 * not checked in a sandbox and publishing reports itself unavailable.
 *
 * With `VIBLD_DOMAIN` and `VIBLD_PREVIEW_DOMAIN`, for a server on the
 * internet behind deploy/vps's proxy (D141): the builder answers as
 * `https://<VIBLD_DOMAIN>`, previews and published sites are minted under
 * the second domain (L8: never the builder's cookie scope), and every
 * Worker listens on 127.0.0.1 only, so nothing is reachable without TLS.
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
export function dockerConfig(
  app,
  base,
  { sandbox = true, domains = null } = {},
) {
  const config = selfHostConfig(app, base, LOCAL_SETTINGS);
  for (const key of DEPLOY_ONLY) delete config[key];
  config.dev = { ip: domains ? '127.0.0.1' : '0.0.0.0', port: PORTS[app] };
  // The proxy ends TLS, so without this the builder would see `http:` and
  // refuse the browser's `https:` origin. Only the builder: previews are
  // routed by their own host name, which this would overwrite.
  if (domains && app === 'web') {
    config.dev.host = domains.builder;
    config.dev.upstream_protocol = 'https';
  }
  const publishHost = domains ? domains.preview : `localhost:${PORTS.publish}`;
  const vars = { ...(config.vars ?? {}) };
  if (app === 'preview') {
    vars.PREVIEW_HOSTNAME = domains
      ? domains.preview
      : `localhost:${PORTS.preview}`;
    // Cloudflare's machine size means nothing on this one. `max_instances`
    // is left as it is: `wrangler dev` does not apply it, and the fleet's
    // own ceiling (apps/preview/worker/capacity.ts) is written to match it.
    for (const container of config.containers ?? []) {
      delete container.instance_type;
    }
  }
  if (app === 'web' || app === 'publish') {
    vars.PUBLISH_HOSTNAME = publishHost;
  }
  // `.env` decides the provider, and left blank there the only key or local
  // model set does (D124). The placeholder here would otherwise name OpenAI
  // on a copy with no OpenAI key.
  if (app === 'web') delete vars.VIBLD_PROVIDER;
  // Behind the proxy every request comes from 127.0.0.1, and a client could
  // name its own CF-Connecting-IP; the proxy's X-Real-Ip is set from the
  // connection (apps/web/worker/client-address.ts).
  if (domains && app === 'web') vars.VIBLD_CLIENT_IP_HEADER = 'X-Real-Ip';
  if (app === 'web' && !sandbox) {
    config.services = (config.services ?? []).filter(
      (b) => b.binding !== 'PREVIEW' && b.binding !== 'PUBLISH',
    );
    delete vars.PUBLISH_HOSTNAME;
    vars.VIBLD_PREVIEW = 'browser';
  }
  config.vars = vars;
  const text = JSON.stringify(config);
  if (text.includes('localhost.invalid')) {
    throw new Error(`${app}: a placeholder host was left in the config`);
  }
  return config;
}

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * The builder's and the previews' domains on a server on the internet
 * (D141), or null on a machine of one's own. Both or neither, two different
 * names, and the previews' never under the builder's: a preview runs code
 * nobody has reviewed, and a domain of its own keeps it out of the
 * builder's cookie scope (L8).
 */
export function vpsDomains(env) {
  const builder = (env.VIBLD_DOMAIN ?? '').trim().toLowerCase();
  const preview = (env.VIBLD_PREVIEW_DOMAIN ?? '').trim().toLowerCase();
  if (!builder && !preview) return null;
  if (!builder || !preview) {
    throw new Error(
      'Set both VIBLD_DOMAIN and VIBLD_PREVIEW_DOMAIN, or neither.',
    );
  }
  for (const [name, value] of [
    ['VIBLD_DOMAIN', builder],
    ['VIBLD_PREVIEW_DOMAIN', preview],
  ]) {
    if (!HOST.test(value)) {
      throw new Error(`${name} is a bare host name, such as example.com.`);
    }
  }
  if (siteOf(builder) === siteOf(preview)) {
    throw new Error(
      'VIBLD_PREVIEW_DOMAIN is a domain of its own, not the builder’s, one under it or beside it (L8).',
    );
  }
  return { builder, preview };
}

/**
 * Public suffixes of two labels, under which each name is a site of its own
 * (`example.co.uk`). Not the whole public suffix list: a suffix missing here
 * only makes two names look like one site, which refuses a pair that would
 * have been safe and never accepts one that is not.
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  'ac.uk',
  'co.uk',
  'gov.uk',
  'ltd.uk',
  'me.uk',
  'net.uk',
  'org.uk',
  'plc.uk',
  'asn.au',
  'com.au',
  'id.au',
  'net.au',
  'org.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'ac.jp',
  'co.jp',
  'ne.jp',
  'or.jp',
  'co.kr',
  'or.kr',
  'co.in',
  'firm.in',
  'net.in',
  'org.in',
  'co.za',
  'org.za',
  'com.br',
  'net.br',
  'org.br',
  'com.mx',
  'org.mx',
  'com.ar',
  'com.cn',
  'com.hk',
  'com.sg',
  'com.tr',
  'com.tw',
  'co.il',
  'co.id',
  'co.th',
]);

/**
 * The registered domain a host name belongs to: the last two labels, or
 * three under a known two-label public suffix. Two hosts under one of these
 * can set cookies for each other.
 */
export function siteOf(host) {
  const labels = host.split('.');
  const suffix = labels.slice(-2).join('.');
  const take = labels.length >= 3 && SECOND_LEVEL_SUFFIXES.has(suffix) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Whether the sandbox and publishing run beside the builder. */
export function sandboxOn(env) {
  return (env.VIBLD_SANDBOX ?? '').trim().toLowerCase() !== 'off';
}

function main() {
  const sandbox = sandboxOn(process.env);
  const domains = sandbox ? vpsDomains(process.env) : null;
  for (const app of APPS) {
    const base = parseJsonc(
      readFileSync(join(ROOT, 'apps', app, 'wrangler.jsonc'), 'utf8'),
    );
    const file = join(ROOT, 'apps', app, 'wrangler.docker.jsonc');
    writeFileSync(
      file,
      '// Written by scripts/docker-config.mjs from wrangler.jsonc.\n' +
        '// Do not edit: change that script and run it again.\n' +
        `${JSON.stringify(dockerConfig(app, base, { sandbox, domains }), null, 2)}\n`,
    );
    console.log(`wrote ${file}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
