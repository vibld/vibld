#!/usr/bin/env node
/**
 * Signs in to a self-hosted copy of vibld with the owner's password and
 * runs one real build on it, the way its owner would (docs/decisions.md
 * D122, D123). The Self-host check runs it against a copy on Cloudflare and
 * against one under Docker.
 *
 *   node scripts/self-host-journey.mjs <deps> <out>
 *
 * <deps> is a directory where playwright is installed (not a dependency of
 * the repository, as for scripts/e2e-production.mjs). <out> receives a
 * screenshot per step and results.json.
 *
 * Read from the environment:
 *
 *   SELF_HOST_URL          the builder's origin, e.g. https://acme-web.example.workers.dev
 *   VIBLD_OWNER_PASSWORD   the copy's owner password. Never printed.
 *   SELF_HOST_CHROMIUM_PATH  optional Chromium executable.
 *
 * It builds with the copy's own default model: what an owner who changes
 * nothing gets. The project it makes is deleted at the end, pass or fail.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { FIRST_PROMPT, NUDGE, redact } from './e2e-production.mjs';

/** The iframes the preview pane shows a running app in (PreviewPanel.tsx). */
export const PREVIEW_FRAMES = {
  sandbox: 'Sandbox preview of the generated application',
  browser: 'In-browser preview of the generated application',
};

/** The origin to check, without a trailing slash, or an error. */
export function originOf(value) {
  const text = String(value ?? '').trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`SELF_HOST_URL is not a URL: "${text}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SELF_HOST_URL must be http or https, not ${url.protocol}`);
  }
  return url.origin;
}

/** The step's outcome as one Markdown table row. */
export function summaryRow(result) {
  const detail = String(result.detail ?? '')
    .replace(/\|/g, '/')
    .replace(/\n/g, ' ');
  const seconds = result.seconds === undefined ? '' : ` (${result.seconds}s)`;
  return `| ${result.name} | ${result.status}${seconds} | ${detail} |`;
}

const inActions = process.env.GITHUB_ACTIONS === 'true';
const secrets = [];

function log(message) {
  console.log(redact(message, secrets));
}

function until(check, { timeoutMs, intervalMs = 2_000, what }) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}.`,
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
}

/**
 * A call to the copy's API from inside a page. The owner's session is an
 * HttpOnly cookie, so the browser sends it and nothing here can read it.
 */
async function api(page, path, { method = 'GET' } = {}) {
  return page.evaluate(
    async ({ path, method }) => {
      const response = await fetch(path, { method });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: response.status, json };
    },
    { path, method },
  );
}

async function main() {
  const [depsArg, outArg] = process.argv.slice(2);
  if (!depsArg || !outArg) {
    console.error('usage: node scripts/self-host-journey.mjs <deps> <out>');
    process.exit(2);
  }
  const origin = originOf(process.env.SELF_HOST_URL);
  const password = process.env.VIBLD_OWNER_PASSWORD ?? '';
  if (!password) {
    console.error('Set VIBLD_OWNER_PASSWORD to sign in with.');
    process.exit(2);
  }
  secrets.push(password);
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const require = createRequire(join(resolve(depsArg), 'package.json'));
  const { chromium } = require('playwright');

  const browser = await chromium.launch({
    ...(process.env.SELF_HOST_CHROMIUM_PATH
      ? { executablePath: process.env.SELF_HOST_CHROMIUM_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(60_000);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(redact(message.text(), secrets).slice(0, 400));
    }
  });

  const results = [];
  const facts = { origin };
  let failed = false;
  let shots = 0;

  async function shot(name) {
    shots += 1;
    const file = `${String(shots).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(out, file) }).catch(() => undefined);
  }

  async function step(name, fn, { always = false } = {}) {
    if (failed && !always) {
      results.push({ name, status: 'skipped' });
      log(`- ${name}: skipped`);
      return undefined;
    }
    const started = Date.now();
    if (inActions) console.log(`::group::${name}`);
    log(`> ${name}`);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    try {
      const detail = await fn();
      const seconds = Math.round((Date.now() - started) / 1000);
      results.push({ name, status: 'passed', seconds, detail: detail ?? '' });
      log(`  passed in ${seconds}s${detail ? `: ${detail}` : ''}`);
      await shot(slug);
      return detail;
    } catch (error) {
      const seconds = Math.round((Date.now() - started) / 1000);
      const message = redact(error?.message ?? String(error), secrets);
      results.push({ name, status: 'failed', seconds, detail: message });
      log(`  FAILED after ${seconds}s: ${message}`);
      await shot(`failed-${slug}`);
      failed = true;
      return undefined;
    } finally {
      if (inActions) console.log('::endgroup::');
    }
  }

  const composer = () => page.locator('form.prompt');
  const lastReply = () => page.locator('.bubble--vibld').last();

  async function lastReplyStatus() {
    if ((await page.locator('.bubble--vibld').count()) === 0) return null;
    const cls = (await lastReply().getAttribute('class')) ?? '';
    const match = /bubble--(running|accepted|failed|cancelled|replied)/.exec(
      cls,
    );
    return match ? match[1] : null;
  }

  async function projectState(id) {
    const answer = await api(page, `/api/projects/${encodeURIComponent(id)}`);
    if (answer.status !== 200) {
      throw new Error(`GET /api/projects/:id answered ${answer.status}.`);
    }
    return answer.json;
  }

  async function type(text) {
    await composer().locator('textarea.prompt__message').fill(text);
    await composer().locator('button[type="submit"]').click();
  }

  let projectId = null;

  await step('Signed out, the copy asks for the password', async () => {
    await page.goto(`${origin}/projects`);
    await page
      .locator('form.owner-sign-in')
      .waitFor({ state: 'visible', timeout: 90_000 });
    const answer = await api(page, '/api/config');
    if (answer.status !== 401 && answer.status !== 403) {
      throw new Error(`/api/config answered ${answer.status} signed out.`);
    }
    return `password form shown; /api/config refuses with ${answer.status}`;
  });

  await step('A wrong password is refused', async () => {
    const form = page.locator('form.owner-sign-in');
    await form.locator('input[type="password"]').fill(`${password}-wrong`);
    await form.locator('button[type="submit"]').click();
    const alert = form.locator('.owner-sign-in__error');
    await alert.waitFor({ state: 'visible', timeout: 30_000 });
    return `says "${(await alert.innerText()).trim()}"`;
  });

  await step('The owner signs in with the password', async () => {
    const form = page.locator('form.owner-sign-in');
    await form.locator('input[type="password"]').fill(password);
    await form.locator('button[type="submit"]').click();
    await page
      .locator('section.projectspage')
      .waitFor({ state: 'visible', timeout: 90_000 });
    const config = await api(page, '/api/config');
    if (config.status !== 200) {
      throw new Error(`/api/config answered ${config.status} signed in.`);
    }
    facts.generation = config.json.generation;
    facts.defaultModel = config.json.defaultModel ?? null;
    facts.modelsOffered = (config.json.models ?? []).map((m) => m.id);
    if (config.json.generation !== 'model') {
      throw new Error(
        `The copy reports generation "${config.json.generation}", so it has no model to build with.`,
      );
    }
    return `builds with ${facts.defaultModel ?? 'its only model'}`;
  });

  await step('Create a project', async () => {
    await page
      .getByText('Loading your projects.')
      .waitFor({ state: 'hidden', timeout: 60_000 });
    await page
      .locator('section.projectspage')
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });
    projectId = decodeURIComponent(new URL(page.url()).pathname.slice(3));
    await composer().waitFor({ state: 'visible', timeout: 60_000 });
    return projectId;
  });

  await step('Build: a one-page site for a neighborhood bakery', async () => {
    const sentAt = Date.now();
    let baseline = await page.locator('.bubble--vibld').count();
    await type(FIRST_PROMPT);
    let build = null;
    for (let nudges = 0; !build; nudges += 1) {
      const outcome = await until(
        async () => {
          const state = await projectState(projectId);
          if (state.build?.runId) return { kind: 'build', build: state.build };
          if ((await page.locator('.bubble--vibld').count()) <= baseline) {
            return null;
          }
          const status = await lastReplyStatus();
          return status === 'replied' || status === 'failed'
            ? { kind: status }
            : null;
        },
        { timeoutMs: 180_000, intervalMs: 1_000, what: 'the build to start' },
      );
      if (outcome.kind === 'build') {
        build = outcome.build;
      } else if (outcome.kind === 'failed') {
        const text = redact(await lastReply().innerText(), secrets);
        throw new Error(`The turn failed: ${text.slice(0, 300)}`);
      } else if (nudges >= 2) {
        throw new Error('The agent kept answering instead of building.');
      } else {
        log(`  the agent replied instead of building; nudging`);
        baseline = await page.locator('.bubble--vibld').count();
        await type(NUDGE);
      }
    }
    facts.runId = build.runId;
    await until(
      async () => {
        const state = await projectState(projectId);
        if (state.build) return false;
        const status = await lastReplyStatus();
        return status !== null && status !== 'running';
      },
      { timeoutMs: 25 * 60_000, intervalMs: 5_000, what: 'the build to end' },
    );
    const run = await api(page, `/api/runs/${encodeURIComponent(build.runId)}`);
    const worker = run.json?.run?.state ?? `unreadable (${run.status})`;
    const shown = await lastReplyStatus();
    if (worker !== 'accepted' || shown !== 'accepted') {
      const text = redact(await lastReply().innerText(), secrets);
      throw new Error(
        `The build ended ${worker} (page shows ${shown}): ${text.slice(0, 300)}`,
      );
    }
    return `accepted in ${Math.round((Date.now() - sentAt) / 1000)}s`;
  });

  await step('The preview renders', async () => {
    await page.locator('#tab-preview').click();
    await page
      .getByRole('button', { name: 'Run live preview' })
      .first()
      .click({ timeout: 30_000 });
    const frames = Object.entries(PREVIEW_FRAMES).map(([kind, title]) => [
      kind,
      page.locator(`iframe[title="${title}"]`),
    ]);
    const failure = page.locator('.preview__error');
    const kind = await until(
      async () => {
        for (const [name, frame] of frames) {
          if (await frame.isVisible().catch(() => false)) return name;
        }
        if (await failure.isVisible().catch(() => false)) return 'failed';
        return null;
      },
      { timeoutMs: 8 * 60_000, intervalMs: 1_000, what: 'the preview' },
    );
    if (kind === 'failed') {
      const said = redact(await failure.innerText(), secrets);
      throw new Error(`The preview did not start: ${said.slice(0, 300)}`);
    }
    facts.preview = kind;
    const body = page
      .frameLocator(`iframe[title="${PREVIEW_FRAMES[kind]}"]`)
      .locator('body');
    const text = await until(
      async () => {
        const shown = await body.innerText({ timeout: 10_000 }).catch(() => '');
        return shown.trim().length > 40 ? shown : null;
      },
      { timeoutMs: 180_000, what: 'the preview to show a page' },
    );
    return `${kind} preview, ${text.trim().length} characters of page text${/bak/i.test(text) ? ', mentions baking' : ''}`;
  });

  await step(
    'Delete the project',
    async () => {
      if (!projectId) return 'nothing was made';
      const path = `/api/projects/${encodeURIComponent(projectId)}`;
      const state = await api(page, path);
      if (state.status === 404) return 'already gone';
      const runId = state.json?.build?.runId;
      if (runId) {
        await api(page, `/api/runs/${encodeURIComponent(runId)}`, {
          method: 'DELETE',
        });
        await until(async () => !(await api(page, path)).json?.build, {
          timeoutMs: 90_000,
          what: 'its build to stop',
        });
      }
      const gone = await api(page, path, { method: 'DELETE' });
      if (gone.status >= 300) {
        throw new Error(`DELETE answered ${gone.status}.`);
      }
      return `deleted ${projectId}`;
    },
    { always: true },
  );

  await browser.close();

  facts.pageErrors = pageErrors;
  writeFileSync(
    join(out, 'results.json'),
    `${redact(JSON.stringify({ facts, results }, null, 2), secrets)}\n`,
  );
  const summary = redact(
    [
      `### Signed in and built on ${origin}`,
      '',
      '| Step | Result | Detail |',
      '| --- | --- | --- |',
      ...results.map(summaryRow),
    ].join('\n'),
    secrets,
  );
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
