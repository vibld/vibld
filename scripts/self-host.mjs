#!/usr/bin/env node
/**
 * Your own copy's Wrangler configuration, from vibld's (docs/decisions.md,
 * D115).
 *
 *   node scripts/self-host.mjs <settings.json>
 *
 * The `wrangler.jsonc` beside each Worker deploys vibld's own service: its
 * Worker names, its D1 database and R2 bucket, its domains and its Clerk.
 * Deployed unchanged into another account they fail; deployed into an
 * account that also runs vibld, they would take over its Workers and write
 * into its database. This writes `wrangler.self-host.jsonc` beside each one
 * (ignored by git) with every one of those names derived from your settings,
 * so nothing is edited by hand and nothing of vibld's is left in them. It
 * refuses to write a file that still names any of it.
 *
 * Deploy each with `wrangler deploy -c wrangler.self-host.jsonc`, in the
 * order https://vibld.com/docs/deploying gives. The settings file:
 *
 *   {
 *     "prefix": "acme",                        // Worker, database, bucket and
 *                                              // Workflow names start with it
 *     "d1DatabaseId": "…",                     // from `wrangler d1 create <prefix>-control-plane`
 *     "auth": "owner",                         // owner | access | clerk (D123)
 *     "ownerEmail": "you@example.com",         // owner: optional
 *     "accessTeamDomain": "acme.cloudflareaccess.com", // access: required
 *     "accessAud": "…",                        // access: the application's AUD tag
 *     "clerkFrontendApiUrl": "https://….clerk.accounts.dev", // clerk: required
 *     "provider": "deepseek",                  // anthropic | deepseek | openai
 *     "model": "deepseek-v4-flash",            // optional: the provider's default otherwise
 *     "builderDomain": "build.example.com",    // optional: a custom domain;
 *                                              // workers.dev otherwise
 *     "previewDomain": "example-preview.dev",  // optional: a zone for the
 *                                              // previews' wildcard route
 *     "rateLimitNamespaceBase": 5001           // required: rate-limit namespace
 *                                              // ids are account-wide, so a
 *                                              // copy beside vibld needs its own
 *   }
 *
 * `auth` is how people sign in to the copy. `owner` is one password, set
 * afterwards with `wrangler secret put VIBLD_OWNER_PASSWORD` (12 characters
 * or more); `access` is Cloudflare Access in front of the builder; `clerk`
 * is a Clerk instance of your own. Left out, it is `clerk` when
 * `clerkFrontendApiUrl` is given and `owner` otherwise. The builder's page
 * has to be built knowing which, so this also writes
 * `apps/web/.env.production.local` (ignored by git) with `VITE_VIBLD_AUTH`.
 *
 * Without a `previewDomain` the builder is not bound to the publish Worker,
 * so publishing reports itself unavailable: the publish Worker would
 * otherwise name its sites under vibld's `vibld-preview.dev`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const APPS = /** @type {const} */ (['web', 'preview', 'publish']);

/**
 * Everything in vibld's own configuration that names its deployment. A
 * generated file containing any of these is refused.
 */
export const VIBLD_OWN = [
  'vibld-web-preview',
  'vibld-preview',
  'vibld-publish',
  'vibld-generation',
  'vibld-control-plane',
  '4d3190b8-9093-4dfe-8f88-58b4f9c61c73',
  'app.vibld.com',
  'vibld-preview.dev',
  'clerk.vibld.com',
  'https://vibld.com',
];

/** JSONC as Wrangler reads it: comments and trailing commas allowed. */
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1];
        i += 1;
      } else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const PREFIX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
const PROVIDERS = ['anthropic', 'deepseek', 'openai'];
const AUTH_MODES = ['owner', 'access', 'clerk'];

/** The sign-in a copy uses: named, or inferred from what is given. */
export function authFor(settings) {
  return settings.auth ?? (settings.clerkFrontendApiUrl ? 'clerk' : 'owner');
}

/** The settings, checked, or an error naming what is wrong. */
export function checkSettings(settings) {
  const problems = [];
  if (!PREFIX.test(settings.prefix ?? '')) {
    problems.push(
      '"prefix" must be lowercase letters, digits and hyphens, 2 to 32 long',
    );
  } else if (settings.prefix.startsWith('vibld')) {
    problems.push(
      '"prefix" must not start with "vibld": those names are taken',
    );
  }
  if (!/^[0-9a-f-]{36}$/.test(settings.d1DatabaseId ?? '')) {
    problems.push(
      `"d1DatabaseId" is the id \`wrangler d1 create ${settings.prefix ?? '<prefix>'}-control-plane\` prints`,
    );
  }
  const auth = authFor(settings);
  if (!AUTH_MODES.includes(auth)) {
    problems.push(`"auth" is one of ${AUTH_MODES.join(', ')}`);
  }
  if (
    auth === 'clerk' &&
    !/^https:\/\/[^/]+$/.test(settings.clerkFrontendApiUrl ?? '')
  ) {
    problems.push(
      '"clerkFrontendApiUrl" is your Clerk instance\'s Frontend API URL, https:// and no path',
    );
  }
  if (auth === 'access') {
    if (
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(
        settings.accessTeamDomain ?? '',
      )
    ) {
      problems.push(
        '"accessTeamDomain" is your Zero Trust team domain, such as acme.cloudflareaccess.com',
      );
    }
    if (!/^[0-9a-f]{64}$/.test(settings.accessAud ?? '')) {
      problems.push(
        '"accessAud" is the Access application\'s Application Audience (AUD) tag, 64 hex characters',
      );
    }
  }
  if (
    settings.ownerEmail !== undefined &&
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.ownerEmail)
  ) {
    problems.push('"ownerEmail" is an email address');
  }
  if (!PROVIDERS.includes(settings.provider)) {
    problems.push(`"provider" is one of ${PROVIDERS.join(', ')}`);
  }
  const base = settings.rateLimitNamespaceBase;
  if (!Number.isInteger(base) || base < 1 || base > 1_000_000) {
    problems.push(
      '"rateLimitNamespaceBase" is a whole number, such as 5001: rate-limit namespace ids are shared across a Cloudflare account, so pick a range nothing else in it uses',
    );
  }
  for (const key of ['builderDomain', 'previewDomain']) {
    const value = settings[key];
    if (value !== undefined && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
      problems.push(`"${key}" is a bare host name, such as example.com`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `The self-host settings are not usable:\n- ${problems.join('\n- ')}`,
    );
  }
  return settings;
}

/** The names your copy uses, from its prefix. */
export function namesFor(prefix) {
  return {
    web: `${prefix}-web`,
    preview: `${prefix}-preview`,
    publish: `${prefix}-publish`,
    workflow: `${prefix}-generation`,
    database: `${prefix}-control-plane`,
    bucket: `${prefix}-control-plane`,
  };
}

/**
 * One Worker's configuration for your copy: vibld's, with every name of
 * vibld's deployment replaced by yours. Pure: the tests read it directly.
 */
export function selfHostConfig(app, base, settings) {
  const s = checkSettings(settings);
  const names = namesFor(s.prefix);
  const config = structuredClone(base);
  config.name = names[app];

  for (const db of config.d1_databases ?? []) {
    db.database_name = names.database;
    db.database_id = s.d1DatabaseId;
  }
  for (const bucket of config.r2_buckets ?? []) {
    bucket.bucket_name = names.bucket;
  }
  for (const service of config.services ?? []) {
    const target = { 'vibld-preview': 'preview', 'vibld-publish': 'publish' }[
      service.service
    ];
    if (!target) throw new Error(`${app}: unknown service ${service.service}`);
    service.service = names[target];
  }
  if (app === 'web' && !s.previewDomain) {
    // Unbound, publishing answers "not configured" (autoPublishConfigured)
    // instead of publishing under vibld's hostname.
    config.services = config.services.filter((b) => b.binding !== 'PUBLISH');
  }
  for (const workflow of config.workflows ?? []) {
    workflow.name = names.workflow;
  }
  const ownIds = new Set((base.ratelimits ?? []).map((l) => l.namespace_id));
  (config.ratelimits ?? []).forEach((limit, index) => {
    limit.namespace_id = String(s.rateLimitNamespaceBase + index);
    if (ownIds.has(limit.namespace_id)) {
      throw new Error(
        `${app}: rate-limit namespace ${limit.namespace_id} is one of vibld's own; choose a "rateLimitNamespaceBase" past them`,
      );
    }
  });

  const vars = { ...(config.vars ?? {}) };
  delete config.routes;
  if (app === 'web') {
    if (s.builderDomain) {
      config.routes = [{ pattern: s.builderDomain, custom_domain: true }];
    } else config.workers_dev = true;
    const auth = authFor(s);
    vars.VIBLD_AUTH = auth;
    delete vars.CLERK_FRONTEND_API_URL;
    delete vars.VIBLD_ACCESS_TEAM_DOMAIN;
    delete vars.VIBLD_ACCESS_AUD;
    delete vars.VIBLD_OWNER_EMAIL;
    if (auth === 'clerk') vars.CLERK_FRONTEND_API_URL = s.clerkFrontendApiUrl;
    if (auth === 'access') {
      vars.VIBLD_ACCESS_TEAM_DOMAIN = s.accessTeamDomain;
      vars.VIBLD_ACCESS_AUD = s.accessAud;
    }
    if (auth === 'owner' && s.ownerEmail) vars.VIBLD_OWNER_EMAIL = s.ownerEmail;
    vars.VIBLD_PROVIDER = s.provider;
    if (s.model) vars.VIBLD_MODEL = s.model;
    else delete vars.VIBLD_MODEL;
    if (s.builderDomain)
      vars.VIBLD_REFERRAL_ORIGIN = `https://${s.builderDomain}`;
    else delete vars.VIBLD_REFERRAL_ORIGIN;
    if (s.previewDomain) vars.PUBLISH_HOSTNAME = s.previewDomain;
  }
  if (app === 'preview') {
    if (s.previewDomain) {
      config.routes = [
        { pattern: `*.${s.previewDomain}/*`, zone_name: s.previewDomain },
      ];
      vars.PREVIEW_HOSTNAME = s.previewDomain;
    } else {
      // Without a domain for them, previews report themselves unavailable
      // (https://vibld.com/docs/deploying, "What to check").
      delete vars.PREVIEW_HOSTNAME;
      config.workers_dev = true;
    }
  }
  if (app === 'publish') {
    if (s.previewDomain) vars.PUBLISH_HOSTNAME = s.previewDomain;
    else delete vars.PUBLISH_HOSTNAME;
  }
  config.vars = vars;

  const text = JSON.stringify(config);
  const left = VIBLD_OWN.filter((name) => text.includes(name));
  if (left.length > 0) {
    throw new Error(`${app}: still names vibld's own ${left.join(', ')}`);
  }
  return config;
}

/** Relative paths in a config are read from the file's own directory. */
function writeConfig(app, config) {
  const file = join(ROOT, 'apps', app, 'wrangler.self-host.jsonc');
  writeFileSync(
    file,
    '// Written by scripts/self-host.mjs from wrangler.jsonc and your\n' +
      '// settings. Do not edit: change the settings and run it again.\n' +
      `${JSON.stringify(config, null, 2)}\n`,
  );
  return file;
}

/** What the builder's page is built with: which sign-in it shows. */
export function buildEnvFor(auth) {
  return (
    '# Written by scripts/self-host.mjs. Vite reads it on `vite build`.\n' +
    `VITE_VIBLD_AUTH=${auth}\n`
  );
}

function writeBuildEnv(auth) {
  const file = join(ROOT, 'apps', 'web', '.env.production.local');
  writeFileSync(file, buildEnvFor(auth));
  return file;
}

function main([settingsPath]) {
  if (!settingsPath) {
    console.error('usage: node scripts/self-host.mjs <settings.json>');
    process.exit(2);
  }
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const names = namesFor(checkSettings(settings).prefix);
  for (const app of APPS) {
    const base = parseJsonc(
      readFileSync(join(ROOT, 'apps', app, 'wrangler.jsonc'), 'utf8'),
    );
    console.log(
      `wrote ${writeConfig(app, selfHostConfig(app, base, settings))}`,
    );
  }
  console.log(`wrote ${writeBuildEnv(authFor(settings))}`);
  if (authFor(settings) === 'access') {
    console.log(
      'Set your admin before signing in: cd apps/web && npx wrangler secret put VIBLD_PLATFORM_ADMINS -c wrangler.self-host.jsonc (the email you sign in to Access with)',
    );
  }
  if (authFor(settings) === 'owner') {
    console.log(
      'Set the password before signing in: cd apps/web && npx wrangler secret put VIBLD_OWNER_PASSWORD -c wrangler.self-host.jsonc',
    );
  }
  console.log(
    `\nWorkers ${names.publish}, ${names.preview}, ${names.web}; ` +
      `database and bucket ${names.database}.\n` +
      `Apply the migrations with: wrangler d1 migrations apply ${names.database} --remote -c wrangler.self-host.jsonc (in apps/web)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
