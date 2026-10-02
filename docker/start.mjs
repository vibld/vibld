#!/usr/bin/env node
/**
 * Starts vibld inside its container (docs/decisions.md D126, D137).
 *
 * 1. Writes each Worker's `wrangler.docker.jsonc` (scripts/docker-config.mjs).
 * 2. Creates the secrets the Workers share, once, in the data volume:
 *    the two internal secrets the builder, previews and publishing check
 *    each other with, and the key panel-stored provider keys are encrypted
 *    under (D132: made once, never replaced).
 * 3. Writes each Worker's `.dev.vars` from those and from the settings
 *    passed in the environment (.env, docker-compose.yml).
 * 4. Applies the D1 migrations to the local database.
 * 5. Runs the three Workers with `wrangler dev`, their data in the volume,
 *    and stops all of them when any one stops.
 *
 * Every step is in `startPlan` below, which the tests read without starting
 * anything.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PORTS, sandboxOn, vpsDomains } from '../scripts/docker-config.mjs';
import { ROOT } from '../scripts/self-host.mjs';

/** Where the state lives: the compose file mounts a volume here. */
export const DATA = process.env.VIBLD_DATA_DIR || '/data';

/** The wrangler every deploy uses (.github/workflows). */
export const WRANGLER = process.env.VIBLD_WRANGLER || 'wrangler';

/** Settings read from the environment, and which Worker each goes to. */
export const PASSED = {
  web: [
    'VIBLD_OWNER_PASSWORD',
    'VIBLD_OWNER_EMAIL',
    'VIBLD_PROVIDER',
    'VIBLD_MODEL',
    'VIBLD_MODEL_POLICY',
    'VIBLD_PLATFORM_ADMINS',
    'VIBLD_FREE_MONTHLY_MICRO_USD',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    // A model on the owner's own machine (D124, D138).
    'VIBLD_LOCAL_BASE_URL',
    'VIBLD_LOCAL_MODEL',
    'VIBLD_LOCAL_API_KEY',
  ],
  preview: [],
  publish: [],
};

/** Made once and kept in the volume, shared by the Workers that check it. */
export const SHARED_SECRETS = {
  PREVIEW_INTERNAL_SECRET: ['web', 'preview'],
  PUBLISH_INTERNAL_SECRET: ['web', 'preview', 'publish'],
  // Signs preview share links (apps/preview's share-token.ts).
  PREVIEW_SHARE_SECRET: ['preview'],
  VIBLD_KEY_ENCRYPTION_KEY: ['web'],
};

/** The secrets, read from the volume or made and written there. */
export function sharedSecrets(
  dir,
  make = () => randomBytes(32).toString('base64'),
) {
  const file = join(dir, 'secrets.json');
  const known = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let changed = false;
  for (const name of Object.keys(SHARED_SECRETS)) {
    if (typeof known[name] !== 'string' || known[name] === '') {
      known[name] = make();
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(known, null, 2)}\n`, { mode: 0o600 });
  }
  return known;
}

/** A `.dev.vars` file: one KEY="value" per line, values JSON-quoted. */
export function devVars(app, env, secrets) {
  const lines = [];
  for (const name of PASSED[app]) {
    const value = env[name];
    if (value !== undefined && value !== '') {
      lines.push(`${name}=${JSON.stringify(value)}`);
    }
  }
  for (const [name, apps] of Object.entries(SHARED_SECRETS)) {
    if (apps.includes(app))
      lines.push(`${name}=${JSON.stringify(secrets[name])}`);
  }
  // Sign-in is the owner's password under Docker (D123).
  if (app === 'web') lines.push('VIBLD_AUTH="owner"');
  return `${lines.join('\n')}\n`;
}

/** What is wrong with the settings, before anything starts. */
export function settingsProblems(env) {
  const problems = [];
  const password = env.VIBLD_OWNER_PASSWORD ?? '';
  if (password.length < 12) {
    problems.push(
      'VIBLD_OWNER_PASSWORD is the password you sign in with: set it in .env, 12 characters or more.',
    );
  }
  // Trimmed, as `localModelSettings` in @vibld/ai reads them: a quoted
  // blank would pass here and leave the builder with no model at all.
  const local = Boolean(
    env.VIBLD_LOCAL_BASE_URL?.trim() && env.VIBLD_LOCAL_MODEL?.trim(),
  );
  if (
    !env.ANTHROPIC_API_KEY &&
    !env.DEEPSEEK_API_KEY &&
    !env.OPENAI_API_KEY &&
    !local
  ) {
    problems.push(
      'No model: set ANTHROPIC_API_KEY, DEEPSEEK_API_KEY or OPENAI_API_KEY in .env, or VIBLD_LOCAL_BASE_URL and VIBLD_LOCAL_MODEL for a model on your own machine, or sign in and add a key under Provider keys on the admin page.',
    );
  }
  return problems;
}

/** Debugger ports, inside the container only. */
const INSPECTOR_PORTS = { web: 9229, preview: 9230, publish: 9231 };

/**
 * The builder's port: `PORT` where a host sets it, with the sandbox off
 * (D141); the fixed one otherwise, which the compose file publishes.
 */
export function builderPort(env) {
  const port = Number(env.PORT);
  return !sandboxOn(env) && Number.isInteger(port) && port > 0
    ? port
    : PORTS.web;
}

/**
 * The commands, in order: the migrations, then the three Workers, or the
 * builder alone with the sandbox off (D141).
 */
export function startPlan(
  data = DATA,
  wrangler = WRANGLER,
  { sandbox = true, port = PORTS.web, ip = '0.0.0.0' } = {},
) {
  const state = join(data, 'state');
  const config = (app) => join(ROOT, 'apps', app, 'wrangler.docker.jsonc');
  return {
    migrate: [
      wrangler,
      'd1',
      'migrations',
      'apply',
      'local-control-plane',
      '--local',
      '--persist-to',
      state,
      '-c',
      config('web'),
    ],
    // Publishing and previews first, so the builder finds them bound.
    workers: (sandbox ? ['publish', 'preview', 'web'] : ['web']).map((app) => ({
      app,
      port: app === 'web' ? port : PORTS[app],
      command: [
        wrangler,
        'dev',
        '-c',
        config(app),
        '--persist-to',
        state,
        '--ip',
        ip,
        '--port',
        String(app === 'web' ? port : PORTS[app]),
        // Each its own debugger port: all three default to the same one.
        '--inspector-port',
        String(INSPECTOR_PORTS[app]),
        '--show-interactive-dev-session=false',
      ],
    })),
  };
}

function main() {
  const problems = settingsProblems(process.env);
  // A missing key is said, not fatal: one can be added in the panel.
  const fatal = problems.filter((p) => p.startsWith('VIBLD_OWNER_PASSWORD'));
  for (const problem of problems) console.error(problem);
  if (fatal.length > 0) process.exit(1);

  const generated = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'docker-config.mjs')],
    { stdio: 'inherit' },
  );
  if (generated.status !== 0) process.exit(generated.status ?? 1);

  const secrets = sharedSecrets(DATA);
  for (const app of Object.keys(PASSED)) {
    writeFileSync(
      join(ROOT, 'apps', app, '.dev.vars'),
      devVars(app, process.env, secrets),
      { mode: 0o600 },
    );
  }

  const sandbox = sandboxOn(process.env);
  const port = builderPort(process.env);
  // Behind infrastructure/vps's proxy on a server, only the proxy reaches the Workers
  // (D141).
  const ip = sandbox && vpsDomains(process.env) ? '127.0.0.1' : '0.0.0.0';
  const plan = startPlan(DATA, WRANGLER, { sandbox, port, ip });
  const [cmd, ...args] = plan.migrate;
  const migrated = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: join(ROOT, 'apps', 'web'),
    env: { ...process.env, CI: '1' },
  });
  if (migrated.status !== 0) process.exit(migrated.status ?? 1);

  const children = plan.workers.map(({ app, command }) => {
    const [bin, ...rest] = command;
    const child = spawn(bin, rest, {
      stdio: 'inherit',
      cwd: join(ROOT, 'apps', app),
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      console.error(`${app} stopped (${signal ?? code}); stopping vibld.`);
      for (const other of children) if (other !== child) other.kill('SIGTERM');
      process.exit(code ?? 1);
    });
    return child;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      for (const child of children) child.kill(signal);
    });
  }
  console.log(
    `vibld is starting: the builder on port ${port} (sign in with VIBLD_OWNER_PASSWORD)${sandbox ? '' : ', with previews in the browser and no sandbox'}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
