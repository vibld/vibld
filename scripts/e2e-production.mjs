#!/usr/bin/env node
/**
 * Signs in to app.vibld.com as a throwaway account it creates in Clerk for
 * the run, walks the builder the way a person would, against production,
 * and deletes the account at the end (D67, Chris, 2026-09-29).
 *
 *   node scripts/e2e-production.mjs <deps> <out>
 *
 * <deps> is a directory where playwright and @clerk/testing are installed;
 * like the screenshot script's, they are not dependencies of the
 * repository, because nothing but this script and its workflow
 * (.github/workflows/e2e-production.yml) uses them. <out> receives a
 * screenshot per step and results.json.
 *
 * Read from the environment:
 *
 *   CLERK_SECRET_KEY      the live instance's Backend API key. Used to
 *                         create and delete the throwaway account, to mint
 *                         a one-time sign-in token for it and a Testing
 *                         Token for bot protection.
 *                         Never printed, and neither is anything minted
 *                         from it.
 *   E2E_JOURNEY           `no-builds` (default) spends nothing: sign-in,
 *                         access, projects, share link, duplicate, archive,
 *                         delete, billing and referral panels. `full` adds
 *                         one build, its preview, one follow-up, Stop, and
 *                         a build that carries on while its page is closed.
 *   E2E_TEST_USER         optional Clerk user id (user_...) of an existing
 *                         account to run as instead. Blank (the default)
 *                         means a throwaway account made for this run.
 *   E2E_MODEL             optional model id. Blank means the cheapest of
 *                         CHEAP_MODELS the account is granted.
 *   E2E_MAX_SPEND_USD     what the run may spend, measured from the
 *                         account's own billing status (default 2).
 *   E2E_CHROMIUM_PATH     optional Chromium executable, for running this
 *                         somewhere a browser is already installed.
 *
 * Every project the run makes is deleted before it ends, a share link it
 * turned on is turned off, and nothing is published. A step that fails
 * skips the rest of the journey and goes straight to that cleanup. The
 * throwaway account is deleted from Clerk last; one a run died before
 * deleting is deleted by the next run. Its usage rows in D1 stay, since
 * they record money that was really spent.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

export const APP_URL = 'https://app.vibld.com';
const CLERK_API = 'https://api.clerk.com/v1';

/** The Clerk Frontend API the live instance serves (wrangler.jsonc). */
export const DEFAULT_CLERK_FAPI = 'clerk.vibld.com';

/**
 * Models this run may build with unless one is named, cheapest first
 * (packages/ai/src/model-catalogue.ts: GPT-6 Luna at 0.1 and 0.5 micro-USD
 * a token in and out, DeepSeek Flash at 0.3 and 1.2). Anything dearer has
 * to be asked for by name.
 */
export const CHEAP_MODELS = ['gpt-6-luna', 'deepseek-flash'];

/**
 * Every project this script names starts with this, so a project left by
 * a run that died before its cleanup can be recognised by the next run.
 */
export const PROJECT_PREFIX = 'e2e-prod';

export const FIRST_PROMPT = 'A one-page site for a neighborhood bakery';
export const FOLLOW_UP_PROMPT =
  'Change the main headline to "Fresh bread every morning". Keep everything else as it is.';
export const STOP_PROMPT = 'A one-page site for a neighborhood flower shop';
/** Said when the agent answers a build request with a question. */
export const NUDGE = 'Yes, build it now exactly as described. No questions.';

/** What the builder says on reopening a build that carried on (session.ts). */
export const STILL_RUNNING_TEXT = 'This build is still running.';

/* ------------------------------------------------------------------ */
/* Pure parts, tested by e2e-production.test.mjs                        */
/* ------------------------------------------------------------------ */

function primaryEmail(user) {
  const addresses = Array.isArray(user.email_addresses)
    ? user.email_addresses
    : [];
  const primary =
    addresses.find((a) => a.id === user.primary_email_address_id) ??
    addresses[0];
  return typeof primary?.email_address === 'string'
    ? primary.email_address
    : '';
}

function allEmails(user) {
  return (Array.isArray(user.email_addresses) ? user.email_addresses : [])
    .map((a) => a?.email_address)
    .filter((e) => typeof e === 'string');
}

/**
 * The private-metadata key that marks a Clerk user as one this script made
 * for a run and may delete. Only this script sets it, and only a user
 * carrying it is ever deleted.
 */
export const THROWAWAY_KEY = 'vibldE2eThrowaway';

/** A throwaway left longer than this by a run that died is cleared. */
export const LEFTOVER_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * The address a throwaway account is made with. On vibld.com, which is
 * ours, and nothing is ever sent to it: a user made through the Backend
 * API is not asked to verify, and the app sends no mail on sign-up.
 */
export function throwawayEmail(stamp, nonce) {
  return `e2e-throwaway-${stamp}-${nonce}@vibld.com`.toLowerCase();
}

/** What `POST /v1/users` is sent to make the throwaway account. */
export function throwawayUserBody({ email, runId, now }) {
  return {
    email_address: [email],
    first_name: 'E2E',
    last_name: 'Throwaway',
    skip_password_requirement: true,
    skip_legal_checks: true,
    private_metadata: {
      [THROWAWAY_KEY]: { run: runId || 'local', createdAt: now },
    },
  };
}

export function isThrowaway(user) {
  const mark = user?.private_metadata?.[THROWAWAY_KEY];
  return typeof mark === 'object' && mark !== null;
}

/**
 * Throwaway accounts an earlier run made and never deleted. Only old ones,
 * so a run cannot take the account from under another (the workflow runs
 * one at a time as well).
 */
export function leftoverThrowaways(users, nowMs, minAgeMs = LEFTOVER_AGE_MS) {
  return users.filter(
    (user) =>
      isThrowaway(user) &&
      typeof user.created_at === 'number' &&
      nowMs - user.created_at >= minAgeMs,
  );
}

/** An address shown without giving it away: `ch…@example.com`. */
export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  if (!domain) return '(no address)';
  return `${local.slice(0, 2)}…@${domain}`;
}

/**
 * The one account to sign in as, or why there is not one.
 *
 * `wanted` (a user id, or an address) wins when given. Otherwise the
 * strongly marked accounts decide if there are any, and the weakly marked
 * ones only if there are none; either way exactly one, or nothing.
 */
export function chooseTestUser(users, wanted) {
  const want = wanted.trim();
  const describe = (user, reasons) => ({
    id: user.id,
    email: maskEmail(primaryEmail(user)),
    created: user.created_at ? new Date(user.created_at).toISOString() : null,
    reasons,
  });
  const match = users.filter(
    (user) =>
      user.id === want ||
      allEmails(user).some((e) => e.toLowerCase() === want.toLowerCase()),
  );
  if (match.length === 1) {
    return { ok: true, user: match[0], why: ['named by E2E_TEST_USER'] };
  }
  return {
    ok: false,
    problem:
      match.length === 0
        ? 'No Clerk user matches E2E_TEST_USER.'
        : 'More than one Clerk user matches E2E_TEST_USER.',
    candidates: match.map((u) => describe(u, ['matches E2E_TEST_USER'])),
  };
}

export function chooseModel(config, wanted = '') {
  const offered = Array.isArray(config?.models)
    ? config.models.map((m) => m.id)
    : [];
  // A single model is not listed in the picker, but it is still the one
  // the Worker answers with.
  const available = offered.length
    ? offered
    : config?.defaultModel
      ? [config.defaultModel]
      : [];
  const want = wanted.trim();
  if (want) {
    return available.includes(want)
      ? { ok: true, model: want }
      : {
          ok: false,
          problem: `${want} is not granted to the test account.`,
          offered: available,
        };
  }
  const cheap = CHEAP_MODELS.find((id) => available.includes(id));
  return cheap
    ? { ok: true, model: cheap }
    : {
        ok: false,
        problem: `None of ${CHEAP_MODELS.join(', ')} is granted to the test account, and nothing dearer is used unless named.`,
        offered: available,
      };
}

/** What the account can still spend, in micro-USD. */
export function spendable(billing) {
  const left = Math.max(
    0,
    (billing.allowanceMicroUsd ?? 0) - (billing.spentMicroUsd ?? 0),
  );
  return left + (billing.topupRemainingMicroUsd ?? 0);
}

/**
 * What was spent between two billing readings, in micro-USD: the monthly
 * allowance used plus the credit drawn down. A month rolling over between
 * the two readings would make the first term negative; it is then read as
 * nothing spent from the allowance rather than as money back.
 */
export function spentBetween(before, after) {
  const allowance = Math.max(
    0,
    (after.spentMicroUsd ?? 0) - (before.spentMicroUsd ?? 0),
  );
  const credit = Math.max(
    0,
    (before.topupRemainingMicroUsd ?? 0) - (after.topupRemainingMicroUsd ?? 0),
  );
  return allowance + credit;
}

export function usd(micro) {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

/** The Frontend API host a publishable key names (`pk_live_<base64 host$>`). */
export function fapiFromPublishableKey(key) {
  const match = /^pk_(?:live|test)_(.+)$/.exec(String(key ?? '').trim());
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    return decoded.endsWith('$') ? decoded.slice(0, -1) : null;
  } catch {
    return null;
  }
}

/**
 * Anything that could carry a credential, blanked before it reaches the
 * log: the values this run minted, a Testing Token in a URL, a bearer
 * header, and anything shaped like a JWT.
 */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 8)
      out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(/(__clerk_testing_token=)[^&\s"']+/g, '$1[redacted]')
    .replace(/(__clerk_ticket=)[^&\s"']+/g, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
      '[jwt]',
    )
    .replace(/\/s\/[A-Za-z0-9_-]{43}/g, '/s/[share-token]')
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_$1_[redacted]');
}

/* ------------------------------------------------------------------ */
/* The run                                                              */
/* ------------------------------------------------------------------ */

const inActions = process.env.GITHUB_ACTIONS === 'true';
const secrets = [];

/** Keep a value out of this run's log, here and in the Actions log. */
function hide(value) {
  if (!value) return;
  secrets.push(value);
  // The workflow command itself is not shown in the log; outside Actions
  // nothing is printed at all.
  if (inActions) process.stdout.write(`::add-mask::${value}\n`);
}

function log(message) {
  console.log(redact(message, secrets));
}

class Skip extends Error {}

async function clerkApi(path, { method = 'GET', body } = {}) {
  const key = process.env.CLERK_SECRET_KEY;
  const response = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    // Clerk's error bodies name the problem and carry no credential.
    throw new Error(
      `Clerk ${method} ${path.split('?')[0]} answered ${response.status}: ${redact(text.slice(0, 300), secrets)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function listAllUsers() {
  const users = [];
  const limit = 100;
  for (let offset = 0; offset < 10_000; offset += limit) {
    const page = await clerkApi(
      `/users?limit=${limit}&offset=${offset}&order_by=-created_at`,
    );
    const rows = Array.isArray(page) ? page : (page?.data ?? []);
    users.push(...rows);
    if (rows.length < limit) break;
  }
  return users;
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
 * Every 429 an API call met, with what says where it came from: the
 * Worker's own refusals are JSON with a `reason`, while a limit in front of
 * it (a zone rule at Cloudflare's edge) answers with a page of its own.
 * Run 36579908217 met one whose body was not JSON, and nothing recorded
 * which it was. Headers and a short start of the body only; no token is in
 * either.
 */
export const rateLimited = [];

/** How long to wait before retrying a 429, in milliseconds. */
export function retryDelayMs(retryAfter, attempt) {
  const seconds = Number(retryAfter);
  const base =
    Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : 2000 * 2 ** attempt;
  return Math.min(base, 20_000);
}

/**
 * A call to the app's own API from inside a page, with that page's Clerk
 * session. The token never leaves the browser: only the status, the body
 * and, for a 429, the headers that say who sent it come back.
 *
 * A 429 is retried up to three times, waiting what `Retry-After` asks or
 * a doubling two seconds, at most twenty: a run from one runner fires its
 * requests faster than a person does, and a limit meant for floods is not
 * what this journey tests.
 */
async function api(page, path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await page.evaluate(
      async ({ path, method, body }) => {
        const token = await window.Clerk?.session?.getToken();
        const response = await fetch(path, {
          method,
          headers: {
            ...(body !== undefined
              ? { 'content-type': 'application/json' }
              : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        const limited =
          response.status === 429
            ? {
                server: response.headers.get('server'),
                cfRay: response.headers.get('cf-ray'),
                contentType: response.headers.get('content-type'),
                retryAfter: response.headers.get('retry-after'),
                reason: json?.reason ?? null,
                bodyStart: text.slice(0, 160),
              }
            : null;
        return { status: response.status, json, limited };
      },
      { path, method, body },
    );
    if (result.status !== 429) {
      return { status: result.status, json: result.json };
    }
    rateLimited.push({ path, method, attempt, ...result.limited });
    if (attempt >= 3) return { status: result.status, json: result.json };
    const wait = retryDelayMs(result.limited?.retryAfter, attempt);
    log(`  ${method} ${path} answered 429; retrying in ${wait}ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** The label of the first locator to become visible, polling. */
async function firstVisible(entries, { timeoutMs, what }) {
  return until(
    async () => {
      for (const [label, locator] of entries) {
        if (
          await locator
            .first()
            .isVisible()
            .catch(() => false)
        )
          return label;
      }
      return null;
    },
    { timeoutMs, intervalMs: 1_000, what },
  );
}

async function main() {
  const [depsArg, outArg] = process.argv.slice(2);
  if (!depsArg || !outArg) {
    console.error('usage: node scripts/e2e-production.mjs <deps> <out>');
    process.exit(2);
  }
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const require = createRequire(join(resolve(depsArg), 'package.json'));
  const { chromium } = require('playwright');
  const {
    clerk,
    setupClerkTestingToken,
  } = require('@clerk/testing/playwright');

  const journey =
    (process.env.E2E_JOURNEY ?? 'no-builds').trim() || 'no-builds';
  if (journey !== 'no-builds' && journey !== 'full') {
    console.error(`E2E_JOURNEY must be no-builds or full, not ${journey}.`);
    process.exit(2);
  }
  const maxSpendUsd = Number(process.env.E2E_MAX_SPEND_USD ?? '2');
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0 || maxSpendUsd > 5) {
    console.error('E2E_MAX_SPEND_USD must be a number above 0 and at most 5.');
    process.exit(2);
  }
  const maxSpendMicro = Math.round(maxSpendUsd * 1_000_000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);

  const results = [];
  const created = new Set();
  const facts = { journey, maxSpendUsd };
  let failed = false;
  let shotCount = 0;

  const browser = await chromium.launch({
    ...(process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  // Nothing waits for ever: an action on a control that never becomes
  // usable fails the step rather than the job's own timeout.
  context.setDefaultTimeout(60_000);
  const pageEvents = [];
  const refusals = [];
  const modelViolations = [];
  let chosenModel = null;
  let defaultModel = null;

  /** Everything a builder page reports that the run wants to know about. */
  function watch(page) {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageEvents.push(redact(message.text(), secrets).slice(0, 400));
      }
    });
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'POST') return;
      if (path !== '/api/plan' && path !== '/api/chat') return;
      let model = null;
      try {
        model = request.postDataJSON()?.model ?? null;
      } catch {
        model = null;
      }
      const effective = model ?? defaultModel;
      if (chosenModel && effective !== chosenModel) {
        modelViolations.push(`${path} asked for ${effective ?? 'no model'}`);
      }
    });
    page.on('response', async (response) => {
      const path = new URL(response.url()).pathname;
      if (path !== '/api/plan' && path !== '/api/chat') return;
      if (response.status() < 400) return;
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      refusals.push({
        path,
        status: response.status(),
        reason: body?.reason ?? null,
        error:
          typeof body?.error === 'string' ? body.error.slice(0, 200) : null,
      });
    });
  }

  let page = await context.newPage();
  watch(page);
  let control = null;

  async function shot(name) {
    shotCount += 1;
    const file = `${String(shotCount).padStart(2, '0')}-${name}.png`;
    try {
      await page.screenshot({ path: join(out, file) });
    } catch {
      // A closed page has nothing to show; the step's own result says why.
    }
  }

  async function step(name, fn, { critical = true } = {}) {
    if (failed && critical) {
      results.push({ name, status: 'skipped' });
      log(`- ${name}: skipped`);
      return undefined;
    }
    const started = Date.now();
    if (inActions) console.log(`::group::${name}`);
    log(`> ${name}`);
    try {
      const detail = await fn();
      const seconds = Math.round((Date.now() - started) / 1000);
      results.push({ name, status: 'passed', seconds, detail: detail ?? null });
      log(`  passed in ${seconds}s${detail ? `: ${detail}` : ''}`);
      await shot(
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 40),
      );
      return detail;
    } catch (error) {
      const seconds = Math.round((Date.now() - started) / 1000);
      const skipped = error instanceof Skip;
      const message = redact(error?.message ?? String(error), secrets);
      results.push({
        name,
        status: skipped ? 'skipped' : 'failed',
        seconds,
        detail: message,
      });
      log(`  ${skipped ? 'skipped' : 'FAILED'} after ${seconds}s: ${message}`);
      if (!skipped) {
        await shot(
          `failed-${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 30)}`,
        );
        if (critical) failed = true;
      }
      return undefined;
    } finally {
      if (inActions) console.log('::endgroup::');
    }
  }

  const composer = () => page.locator('form.prompt');
  const sendButton = () => composer().locator('button[type="submit"]');
  const cancelButton = () =>
    composer().getByRole('button', { name: 'Cancel', exact: true });
  const lastReply = () => page.locator('.bubble--vibld').last();

  async function lastReplyStatus() {
    const count = await page.locator('.bubble--vibld').count();
    if (count === 0) return null;
    const cls = (await lastReply().getAttribute('class')) ?? '';
    const match = /bubble--(running|accepted|failed|cancelled|replied)/.exec(
      cls,
    );
    return match ? match[1] : null;
  }

  async function projectState(id) {
    const answer = await api(
      control,
      `/api/projects/${encodeURIComponent(id)}`,
    );
    if (answer.status !== 200) {
      throw new Error(`GET /api/projects/:id answered ${answer.status}.`);
    }
    return answer.json;
  }

  async function projectList() {
    const answer = await api(control, '/api/projects');
    if (answer.status !== 200 || !Array.isArray(answer.json?.projects)) {
      throw new Error(`GET /api/projects answered ${answer.status}.`);
    }
    return answer.json;
  }

  async function billing() {
    const answer = await api(control, '/api/billing/status');
    if (
      answer.status !== 200 ||
      typeof answer.json?.spentMicroUsd !== 'number'
    ) {
      throw new Error(`GET /api/billing/status answered ${answer.status}.`);
    }
    return answer.json;
  }

  let billingBefore = null;
  async function spendGuard() {
    if (!billingBefore) return 'no billing baseline';
    const now = await billing();
    const spent = spentBetween(billingBefore, now);
    facts.spentMicroUsd = spent;
    if (spent > maxSpendMicro) {
      throw new Error(
        `Spent ${usd(spent)} so far, past the ${usd(maxSpendMicro)} this run may spend. Stopping here.`,
      );
    }
    return `spent so far ${usd(spent)} of ${usd(maxSpendMicro)}`;
  }

  async function openProjectsPage() {
    await page.goto(`${APP_URL}/projects`);
    await page
      .locator('section.projectspage')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await page
      .getByText('Loading your projects.')
      .waitFor({ state: 'hidden', timeout: 60_000 });
  }

  async function createProjectFromList() {
    const before = new Set((await projectList()).projects.map((p) => p.id));
    await openProjectsPage();
    await page
      .locator('section.projectspage')
      .getByRole('button', { name: 'New project', exact: true })
      .click();
    await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });
    const id = decodeURIComponent(new URL(page.url()).pathname.slice(3));
    if (before.has(id)) {
      throw new Error('"New project" opened a project that already existed.');
    }
    created.add(id);
    await composer().waitFor({ state: 'visible', timeout: 60_000 });
    return id;
  }

  async function renameInBar(name) {
    await page.locator('button.projectbar__name').click();
    const field = page.getByLabel('Project name');
    await field.fill(name);
    await field.press('Enter');
  }

  async function useModel() {
    const picker = composer().locator('select.models__select');
    if ((await picker.count()) > 0) {
      await picker.selectOption(chosenModel);
      const value = await picker.inputValue();
      if (value !== chosenModel) {
        throw new Error(`The model picker shows ${value}, not ${chosenModel}.`);
      }
      return `picked ${chosenModel}`;
    }
    if (defaultModel !== chosenModel) {
      throw new Error(`No model picker, and the default is ${defaultModel}.`);
    }
    return `${chosenModel} is the only model offered`;
  }

  async function type(text) {
    await composer().locator('textarea.prompt__message').fill(text);
    await sendButton().click();
  }

  /**
   * Send a build request and wait for the Worker to hold a build for this
   * project. The agent decides whether a message is a build; if it answers
   * with a question instead, it is told to go ahead, twice at most.
   */
  async function sendUntilBuild(id, prompt) {
    const sentAt = Date.now();
    // Replies are only read from turns this call started: until the new
    // turn is on screen, the last one is still an earlier answer.
    let baseline = await page.locator('.bubble--vibld').count();
    await type(prompt);
    for (let nudges = 0; ; nudges += 1) {
      const outcome = await until(
        async () => {
          if (modelViolations.length > 0) {
            return { kind: 'violation' };
          }
          const state = await projectState(id);
          if (state.build?.runId) return { kind: 'build', build: state.build };
          if ((await page.locator('.bubble--vibld').count()) <= baseline) {
            return null;
          }
          const status = await lastReplyStatus();
          if (status === 'replied' || status === 'failed') {
            return { kind: status };
          }
          return null;
        },
        { timeoutMs: 180_000, intervalMs: 1_000, what: 'the build to start' },
      );
      if (outcome.kind === 'violation') {
        throw new Error(
          `The builder asked for a model other than ${chosenModel}: ${modelViolations.join('; ')}`,
        );
      }
      if (outcome.kind === 'build') {
        return { ...outcome.build, waitedMs: Date.now() - sentAt, nudges };
      }
      if (outcome.kind === 'failed') {
        const text = redact(await lastReply().innerText(), secrets);
        throw new Error(
          `The turn failed before a build started: ${text.slice(0, 300)}`,
        );
      }
      if (nudges >= 2) {
        throw new Error(
          'The agent kept answering with questions instead of building.',
        );
      }
      log(`  the agent replied instead of building; nudging (${nudges + 1})`);
      baseline = await page.locator('.bubble--vibld').count();
      await type(NUDGE);
    }
  }

  /** Wait until neither the Worker nor the page thinks a build is running. */
  async function waitForSettled(id, runId, timeoutMs) {
    await until(
      async () => {
        const state = await projectState(id);
        if (state.build) return false;
        const status = await lastReplyStatus();
        return status !== null && status !== 'running';
      },
      { timeoutMs, intervalMs: 5_000, what: 'the build to finish' },
    );
    const run = await api(control, `/api/runs/${encodeURIComponent(runId)}`);
    return {
      page: await lastReplyStatus(),
      worker: run.json?.run?.state ?? `unreadable (${run.status})`,
    };
  }

  /* ---------------------------- the journey --------------------------- */

  await step(
    'Signed out, the builder shows the sign-in form',
    async () => {
      await page.goto(`${APP_URL}/projects`);
      await page
        .locator('.auth-gate')
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page.locator('.cl-signIn-root, .cl-rootBox').first().waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      const status = await page.evaluate(async () => {
        const response = await fetch('/api/projects');
        return response.status;
      });
      if (status !== 401 && status !== 403) {
        throw new Error(
          `/api/projects answered ${status} to a caller with no session.`,
        );
      }
      return `sign-in form shown; /api/projects refuses with ${status}`;
    },
    { critical: false },
  );

  let testUser = null;
  // Set only once this run has made the account, so the last step deletes
  // what this run made and never an account somebody named.
  let throwaway = null;
  await step('Make the account this run signs in as', async () => {
    const key = process.env.CLERK_SECRET_KEY ?? '';
    if (!key.trim()) {
      throw new Error(
        'CLERK_SECRET_KEY is not set, so no account can be made or signed in.',
      );
    }
    hide(key);
    facts.clerkInstance = key.startsWith('sk_live_')
      ? 'live'
      : key.startsWith('sk_test_')
        ? 'development'
        : 'unrecognised';
    if (facts.clerkInstance !== 'live') {
      throw new Error(
        `CLERK_SECRET_KEY is a ${facts.clerkInstance} instance key; app.vibld.com runs on the live instance.`,
      );
    }
    const users = await listAllUsers();
    const named = (process.env.E2E_TEST_USER ?? '').trim();
    if (named) {
      const chosen = chooseTestUser(users, named);
      if (!chosen.ok) {
        facts.testUserCandidates = chosen.candidates;
        throw new Error(`${chosen.problem} Looked at ${users.length} users.`);
      }
      testUser = chosen.user;
      hide(primaryEmail(testUser));
      facts.testUser = { id: testUser.id, why: chosen.why };
      return `${testUser.id}, named by E2E_TEST_USER`;
    }
    const cleared = [];
    for (const old of leftoverThrowaways(users, Date.now())) {
      await clerkApi(`/users/${encodeURIComponent(old.id)}`, {
        method: 'DELETE',
      });
      cleared.push(old.id);
    }
    const email = throwawayEmail(stamp, randomBytes(4).toString('hex'));
    hide(email);
    const made = await clerkApi('/users', {
      method: 'POST',
      body: throwawayUserBody({
        email,
        runId: process.env.GITHUB_RUN_ID ?? '',
        now: new Date().toISOString(),
      }),
    });
    if (!made?.id || !isThrowaway(made)) {
      throw new Error('Clerk made the user without the throwaway mark.');
    }
    testUser = made;
    throwaway = made.id;
    facts.testUser = { id: made.id, why: ['throwaway made for this run'] };
    facts.leftoversCleared = cleared;
    return `made ${made.id}${cleared.length ? `; deleted ${cleared.length} left by an earlier run` : ''}`;
  });

  await step('Sign in with a Clerk sign-in token', async () => {
    const fapi =
      fapiFromPublishableKey(process.env.CLERK_PUBLISHABLE_KEY) ??
      DEFAULT_CLERK_FAPI;
    const testing = await clerkApi('/testing_tokens', { method: 'POST' });
    hide(testing?.token);
    process.env.CLERK_FAPI = fapi;
    process.env.CLERK_TESTING_TOKEN = testing?.token ?? '';
    await setupClerkTestingToken({ context });
    const signInToken = await clerkApi('/sign_in_tokens', {
      method: 'POST',
      body: { user_id: testUser.id, expires_in_seconds: 300 },
    });
    hide(signInToken?.token);
    await page.goto(`${APP_URL}/projects`);
    await clerk.signIn({
      page,
      signInParams: { strategy: 'ticket', ticket: signInToken.token },
    });
    await page.waitForFunction(() => window.Clerk?.user != null, null, {
      timeout: 30_000,
    });
    const signedInAs = await page.evaluate(() => window.Clerk.user.id);
    if (signedInAs !== testUser.id) {
      throw new Error(
        'Clerk signed in a different user than the one asked for.',
      );
    }
    return `signed in through ${fapi}`;
  });

  await step('Load the builder and check access', async () => {
    await page.goto(`${APP_URL}/projects`);
    const outcome = await firstVisible(
      [
        ['builder', page.locator('section.projectspage')],
        ['waiting list', page.getByText('You are on the waiting list')],
        ['unchecked', page.getByText('We could not check your account')],
        ['deletion', page.getByText('This account is scheduled for deletion')],
      ],
      { timeoutMs: 90_000, what: 'the builder or a refusal' },
    );
    const access = await api(page, '/api/access/status');
    facts.access = access.json;
    if (outcome !== 'builder' || access.json?.allowed !== true) {
      throw new Error(
        `The builder did not open (${outcome}); /api/access/status answered ${access.status} ${JSON.stringify(access.json)}.`,
      );
    }
    // A second tab for the API calls that check what the builder did. It
    // stays on the project list, which opens and makes nothing, and it
    // outlives the builder tab the keep-building step closes.
    control = await context.newPage();
    await control.goto(`${APP_URL}/projects`);
    await control
      .locator('section.projectspage')
      .waitFor({ state: 'visible', timeout: 90_000 });
    return `allowed, mode ${access.json.mode}`;
  });

  await step('Read the deployment config and choose the model', async () => {
    const config = await api(page, '/api/config');
    if (config.status !== 200) {
      throw new Error(`/api/config answered ${config.status}.`);
    }
    facts.generation = config.json.generation;
    facts.modelsOffered = (config.json.models ?? []).map((m) => m.id);
    facts.isAdmin = config.json.isAdmin;
    defaultModel = config.json.defaultModel ?? null;
    if (config.json.generation !== 'model') {
      throw new Error(
        `The deployment reports generation "${config.json.generation}".`,
      );
    }
    const choice = chooseModel(config.json, process.env.E2E_MODEL ?? '');
    if (!choice.ok) {
      throw new Error(
        `${choice.problem} Offered: ${choice.offered.join(', ') || 'none'}.`,
      );
    }
    chosenModel = choice.model;
    facts.model = chosenModel;
    return `${chosenModel} (offered: ${facts.modelsOffered.join(', ')})`;
  });

  /**
   * Take a project away the way its owner would: stop a build still
   * running in it (a project with a build in flight cannot be deleted),
   * turn its share link off, then delete it. Nothing here publishes, and
   * deleting takes down any site it had (project-handlers.ts).
   */
  async function removeProject(id) {
    const path = `/api/projects/${encodeURIComponent(id)}`;
    const opened = await api(control, path);
    if (opened.status === 404) return 'already gone';
    if (opened.json?.build?.runId) {
      await api(
        control,
        `/api/runs/${encodeURIComponent(opened.json.build.runId)}`,
        {
          method: 'DELETE',
        },
      );
      await until(async () => !(await api(control, path)).json?.build, {
        timeoutMs: 90_000,
        what: 'its build to stop',
      });
    }
    if (opened.json?.project?.share?.on) {
      await api(control, `${path}/share`, { method: 'DELETE' });
    }
    const removed = await api(control, path, { method: 'DELETE' });
    if (removed.status >= 400) {
      throw new Error(
        `delete answered ${removed.status} ${JSON.stringify(removed.json)}`,
      );
    }
    return 'deleted';
  }

  // Every project that was there before the run, which cleanup never
  // touches. Anything else it deletes, including a project the builder
  // made by itself on arrival.
  let existing = null;
  await step(
    'List projects, and clear any an earlier run left behind',
    async () => {
      let list = await projectList();
      const leftovers = list.projects.filter((p) =>
        p.name.startsWith(`${PROJECT_PREFIX} `),
      );
      for (const p of leftovers) await removeProject(p.id);
      if (leftovers.length) list = await projectList();
      existing = new Set(list.projects.map((p) => p.id));
      facts.projectsBefore = list.projects.length;
      facts.limits = list.limits;
      const active = list.projects.filter((p) => !p.archived).length;
      const room =
        list.limits?.maxActive == null
          ? Infinity
          : list.limits.maxActive - active;
      // Two at once: the project and its duplicate.
      if (room < 2) {
        throw new Error(
          `The account has room for ${room} more active project(s) and the run needs 2. Archive or delete some of the test account's projects.`,
        );
      }
      await openProjectsPage();
      if (active > 0) {
        await page
          .getByRole('list', { name: 'Active projects' })
          .waitFor({ state: 'visible', timeout: 30_000 });
      } else {
        await page
          .getByText('No active projects.')
          .waitFor({ timeout: 30_000 });
      }
      return `${list.projects.length} project(s) (cleared ${leftovers.length} from an earlier run); tier ${list.limits?.tier}, ${active} active of ${list.limits?.maxActive ?? 'unlimited'}`;
    },
  );

  await step(
    'Read the billing status and set the spending baseline',
    async () => {
      billingBefore = await billing();
      facts.billingBefore = {
        tier: billingBefore.tier,
        spendable: usd(spendable(billingBefore)),
        suspended: billingBefore.suspended ?? false,
      };
      if (billingBefore.suspended) {
        throw new Error('The test account is suspended.');
      }
      if (journey === 'full' && spendable(billingBefore) < 50_000) {
        throw new Error(
          `The test account has ${usd(spendable(billingBefore))} to spend, too little for a build.`,
        );
      }
      return `tier ${billingBefore.tier}, ${usd(spendable(billingBefore))} spendable`;
    },
  );

  await step('Billing and referral panels load', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const panel = page.locator('.settings__panel');
    await panel.waitFor({ state: 'visible', timeout: 10_000 });
    const found = [];
    if (billingBefore?.billingConfigured) {
      await panel.locator('.billing__usage').waitFor({ timeout: 30_000 });
      found.push(
        `billing: "${(await panel.locator('.billing__usage').innerText()).trim()}"`,
      );
    } else {
      found.push('billing not configured on this deployment');
    }
    const referral = await api(page, '/api/referral/status');
    if (referral.status === 200) {
      await panel
        .getByRole('heading', { name: 'Refer a friend' })
        .waitFor({ timeout: 30_000 });
      await panel.locator('.referral').waitFor({ timeout: 30_000 });
      found.push('referral panel shown');
    } else {
      throw new Error(`/api/referral/status answered ${referral.status}.`);
    }
    await page.getByRole('button', { name: 'Settings' }).click();
    return found.join('; ');
  });

  let projectA = null;
  await step('Create a project and rename it', async () => {
    projectA = await createProjectFromList();
    const name = `${PROJECT_PREFIX} ${stamp} bakery`;
    await renameInBar(name);
    await until(
      async () => (await projectState(projectA)).project?.name === name,
      { timeoutMs: 30_000, what: 'the new name to be saved' },
    );
    return `${projectA}, renamed and saved`;
  });

  let firstRun = null;
  if (journey === 'full') {
    await step('Build: a one-page site for a neighborhood bakery', async () => {
      await useModel();
      firstRun = await sendUntilBuild(projectA, FIRST_PROMPT);
      facts.firstRun = firstRun.runId;
      const settled = await waitForSettled(
        projectA,
        firstRun.runId,
        25 * 60_000,
      );
      if (settled.worker !== 'accepted' || settled.page !== 'accepted') {
        const text = redact(await lastReply().innerText(), secrets);
        throw new Error(
          `The build ended ${settled.worker} (page shows ${settled.page}): ${text.slice(0, 300)}`,
        );
      }
      const guard = await spendGuard();
      return `accepted in ${Math.round((Date.now() - (Date.parse(firstRun.startedAt) || Date.now())) / 1000)}s; ${guard}`;
    });

    await step('The preview renders', async () => {
      await page.locator('#tab-preview').click();
      await page
        .getByRole('button', { name: 'Run live preview' })
        .first()
        .click({ timeout: 30_000 });
      const frame = page.locator(
        'iframe[title="Sandbox preview of the generated application"]',
      );
      // Either the frame, or the panel's failure with its Try again. A
      // start-up can be lost with the sandbox's instance, which the panel
      // reports as a failure (run 36611993082); a reader would try once
      // more, so this does too, and says that it did.
      const tryAgain = page.getByRole('button', { name: 'Try again' });
      let retried = null;
      for (let attempt = 0; ; attempt += 1) {
        await frame
          .or(tryAgain)
          .first()
          .waitFor({ state: 'visible', timeout: 6 * 60_000 });
        if (await frame.isVisible()) break;
        const said = redact(
          await page
            .locator('.preview__error')
            .innerText()
            .catch(() => ''),
          secrets,
        );
        if (attempt > 0) {
          throw new Error(`The preview did not start twice: ${said}`);
        }
        retried = said;
        facts.previewRetried = said;
        await tryAgain.click({ timeout: 10_000 });
      }
      const body = page
        .frameLocator(
          'iframe[title="Sandbox preview of the generated application"]',
        )
        .locator('body');
      await until(
        async () => {
          const text = await body
            .innerText({ timeout: 10_000 })
            .catch(() => '');
          return text.trim().length > 40 ? text : null;
        },
        { timeoutMs: 120_000, what: 'the preview to show a page' },
      );
      const text = await body.innerText();
      await shot('preview');
      // The sandbox expires on its own; stopping it now is the polite end.
      await page
        .locator('.preview__sandbox')
        .getByRole('button', { name: 'Stop', exact: true })
        .click({ timeout: 10_000 })
        .catch(() => undefined);
      return `${text.trim().length} characters of page text${/bak/i.test(text) ? ', mentions baking' : ''}${retried === null ? '' : `; started on the second try (first: ${retried.slice(0, 120)})`}`;
    });

    await step('A small follow-up', async () => {
      const run = await sendUntilBuild(projectA, FOLLOW_UP_PROMPT);
      const settled = await waitForSettled(projectA, run.runId, 20 * 60_000);
      if (settled.worker !== 'accepted') {
        const text = redact(await lastReply().innerText(), secrets);
        throw new Error(
          `The follow-up ended ${settled.worker}: ${text.slice(0, 300)}`,
        );
      }
      return await spendGuard();
    });
  }

  await step('Share link on, then off', async () => {
    const share = page.locator('details.projectbar__share');
    await share.locator('summary').click();
    await share.getByRole('button', { name: 'Turn on link' }).click();
    const field = share.getByLabel('Share link');
    await field.waitFor({ state: 'visible', timeout: 30_000 });
    const url = await field.inputValue();
    const token = /\/s\/([A-Za-z0-9_-]{43})/.exec(url)?.[1];
    if (!token) throw new Error('The share link is not a /s/<token> address.');
    hide(token);
    const on = await fetch(`${APP_URL}/api/share/${token}`);
    if (on.status !== 200) {
      throw new Error(
        `The link, opened with no session, answered ${on.status}.`,
      );
    }
    await share.getByRole('button', { name: 'Turn off link' }).click();
    await share
      .getByRole('button', { name: 'Turn on link' })
      .waitFor({ timeout: 30_000 });
    await share.locator('summary').click();
    const off = await fetch(`${APP_URL}/api/share/${token}`);
    if (off.status !== 404) {
      throw new Error(
        `After turning it off the link answered ${off.status}, not 404.`,
      );
    }
    const state = await projectState(projectA);
    if (state.project?.share?.on) {
      throw new Error('The project still reports its link as on.');
    }
    return 'link worked with no session while on, and 404 once off';
  });

  await step('Duplicate, archive, and delete the duplicate', async () => {
    const before = new Set((await projectList()).projects.map((p) => p.id));
    await openProjectsPage();
    const row = page
      .getByRole('list', { name: 'Active projects' })
      .locator('li.projectlist__item')
      .filter({
        has: page.locator(`a[href="/p/${encodeURIComponent(projectA)}"]`),
      });
    await row.getByRole('button', { name: 'Duplicate', exact: true }).click();
    const copy = await until(
      async () =>
        (await projectList()).projects.find((p) => !before.has(p.id)) ?? null,
      { timeoutMs: 60_000, what: 'the duplicate to appear' },
    );
    created.add(copy.id);
    if (journey === 'full' && !copy.hasCode) {
      throw new Error('The duplicate has no code.');
    }
    // The duplicate's name was chosen by the Worker; the next run needs to
    // recognise it if this one dies before cleaning up.
    await openProjectsPage();
    const copyRow = () =>
      page
        .locator('li.projectlist__item')
        .filter({ has: page.getByText(copy.name, { exact: true }) });
    await copyRow()
      .getByRole('button', { name: 'Archive', exact: true })
      .click();
    await page
      .getByRole('list', { name: 'Archived projects' })
      .getByText(copy.name, { exact: true })
      .waitFor({ timeout: 30_000 });
    const archived = (await projectList()).projects.find(
      (p) => p.id === copy.id,
    );
    if (!archived?.archived) throw new Error('The duplicate is not archived.');
    await copyRow()
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await copyRow().getByRole('button', { name: 'Delete for good' }).click();
    await until(
      async () => !(await projectList()).projects.some((p) => p.id === copy.id),
      { timeoutMs: 30_000, what: 'the duplicate to be deleted' },
    );
    created.delete(copy.id);
    return `duplicated as "${copy.name}"${copy.hasCode ? ' with its code' : ''}, archived, deleted`;
  });

  if (journey === 'full') {
    let projectB = null;
    let stopRun = null;
    await step('Stop a build within 20 seconds', async () => {
      projectB = await createProjectFromList();
      await renameInBar(`${PROJECT_PREFIX} ${stamp} stop`);
      await useModel();
      stopRun = await sendUntilBuild(projectB, STOP_PROMPT);
      // Long enough for the build to be under way, well inside twenty.
      await page.waitForTimeout(8_000);
      const pressedAt = Date.now();
      await cancelButton().click();
      await page
        .getByText('Canceled. Nothing was changed.')
        .last()
        .waitFor({ timeout: 60_000 });
      const run = await until(
        async () => {
          const answer = await api(
            control,
            `/api/runs/${encodeURIComponent(stopRun.runId)}`,
          );
          const state = answer.json?.run?.state;
          return state && state !== 'running' ? state : null;
        },
        { timeoutMs: 60_000, what: 'the Worker to report the build ended' },
      );
      if (run !== 'cancelled')
        throw new Error(`The stopped build ended ${run}.`);
      const state = await projectState(projectB);
      if (state.build)
        throw new Error('The project still reports a build running.');
      const sinceStart = Math.round(
        (pressedAt - (Date.parse(stopRun.startedAt) || pressedAt)) / 1000,
      );
      return `pressed ${sinceStart}s after the build started; cancelled in ${Math.round((Date.now() - pressedAt) / 1000)}s; ${await spendGuard()}`;
    });

    let keepRun = null;
    await step(
      'A new build straight after Stop is not refused as already running',
      async () => {
        const refusedBefore = refusals.length;
        keepRun = await sendUntilBuild(projectB, FIRST_PROMPT);
        const refused = refusals
          .slice(refusedBefore)
          .filter(
            (r) =>
              r.reason === 'already-running' ||
              /already running/i.test(r.error ?? ''),
          );
        if (refused.length > 0) {
          throw new Error(
            `Refused as already running: ${JSON.stringify(refused)}`,
          );
        }
        if (keepRun.runId === stopRun.runId) {
          throw new Error(
            'The Worker reports the stopped build as the running one.',
          );
        }
        return `started ${keepRun.runId} after ${keepRun.nudges} nudge(s)`;
      },
    );

    await step(
      'Keep building: close the page, reopen, see it running, then settled',
      async () => {
        await page.close();
        await new Promise((r) => setTimeout(r, 5_000));
        const still = await projectState(projectB);
        if (!still.build) {
          throw new Error(
            'With its page closed, the Worker no longer reports the build running.',
          );
        }
        page = await context.newPage();
        watch(page);
        await page.goto(`${APP_URL}/p/${encodeURIComponent(projectB)}`);
        await composer().waitFor({ state: 'visible', timeout: 60_000 });
        const shown = await firstVisible(
          [
            ['the still-running notice', page.getByText(STILL_RUNNING_TEXT)],
            ['a running build with its Cancel button', cancelButton()],
          ],
          {
            timeoutMs: 60_000,
            what: 'the reopened project to show its build running',
          },
        );
        await shot('reopened-running');
        const settled = await waitForSettled(
          projectB,
          keepRun.runId,
          25 * 60_000,
        );
        facts.keepBuilding = settled;
        const guard = await spendGuard();
        if (settled.page !== settled.worker) {
          throw new Error(
            `Settled, but the page shows ${settled.page} and the Worker ${settled.worker}.`,
          );
        }
        return `reopened showing ${shown}; settled ${settled.worker}; ${guard}`;
      },
    );
  }

  /* ------------------------------ cleanup ----------------------------- */

  await step(
    'Clean up: stop builds, turn off links, delete every project this run made',
    async () => {
      if (!control || control.isClosed() || existing === null) {
        throw new Skip('never reached the project list, so nothing was made');
      }
      const before = await projectList();
      const made = new Set([
        ...created,
        ...before.projects.filter((p) => !existing.has(p.id)).map((p) => p.id),
      ]);
      const done = [];
      const problems = [];
      for (const id of made) {
        try {
          done.push(`${id} ${await removeProject(id)}`);
        } catch (error) {
          problems.push(`${id}: ${error?.message ?? error}`);
        }
      }
      const after = await projectList();
      const left = after.projects.filter((p) => !existing.has(p.id));
      const shared = after.projects.filter(
        (p) => made.has(p.id) && p.share?.on,
      );
      if (problems.length || left.length || shared.length) {
        throw new Error(
          `Not everything was cleaned up. ${problems.join('; ')} Left: ${left.map((p) => p.id).join(', ') || 'none'}.`,
        );
      }
      return done.join('; ') || 'nothing to delete';
    },
    { critical: false },
  );

  await step(
    'What the run spent',
    async () => {
      if (!billingBefore || !control || control.isClosed()) {
        throw new Skip('no billing baseline');
      }
      const now = await billing();
      const spent = spentBetween(billingBefore, now);
      facts.spentMicroUsd = spent;
      facts.spent = usd(spent);
      return `${usd(spent)} (cap ${usd(maxSpendMicro)})`;
    },
    { critical: false },
  );

  await step(
    'Delete the throwaway account',
    async () => {
      if (!throwaway) throw new Skip('ran as a named account, or made none');
      const user = await clerkApi(`/users/${encodeURIComponent(throwaway)}`);
      if (!isThrowaway(user)) {
        throw new Error(
          `${throwaway} is not marked as a throwaway, so it was kept.`,
        );
      }
      await clerkApi(`/users/${encodeURIComponent(throwaway)}`, {
        method: 'DELETE',
      });
      return `deleted ${throwaway}`;
    },
    { critical: false },
  );

  await browser.close();

  facts.refusals = refusals;
  facts.rateLimited = rateLimited;
  facts.modelViolations = modelViolations;
  facts.pageErrors = pageEvents.slice(0, 50);
  writeFileSync(
    join(out, 'results.json'),
    redact(JSON.stringify({ results, facts }, null, 2), secrets),
  );

  const lines = [
    '## End-to-end on production',
    '',
    `Journey: \`${journey}\`${facts.model ? `, model \`${facts.model}\`` : ''}${facts.spent ? `, spent ${facts.spent}` : ''}`,
    '',
    '| Step | Result | Detail |',
    '| --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.status}${r.seconds !== undefined ? ` (${r.seconds}s)` : ''} | ${String(
          r.detail ?? '',
        )
          .replace(/\|/g, '/')
          .replace(/\n/g, ' ')} |`,
    ),
  ];
  if (pageEvents.length) {
    lines.push(
      '',
      `${pageEvents.length} console error(s) from the builder; see results.json.`,
    );
  }
  if (rateLimited.length) {
    const first = rateLimited[0];
    lines.push(
      '',
      `${rateLimited.length} API call(s) answered 429; the first came from server ${first.server ?? '?'}, ${first.reason ? `reason ${first.reason}` : `content-type ${first.contentType ?? '?'}`}. See results.json.`,
    );
  }
  const summary = redact(lines.join('\n'), secrets);
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  const anyFailed = results.some((r) => r.status === 'failed');
  process.exit(anyFailed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
