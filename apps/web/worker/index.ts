import {
  PlanProvider,
  DEFAULT_MAX_TOKENS,
  ProviderError,
  configuredProviders,
  createPlanClient,
  findModel,
  providerForRequest,
  resolveModel,
} from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';

import { fetchAccessKeys, verifyAccessJwt } from './access.ts';
import { UserBudget } from './budget.ts';
import type { Reservation } from './budget.ts';
import {
  DEFAULT_LIMITS,
  checkBodySize,
  checkRequestOrigin,
  parseGenerationRequest,
  parseKnowledge,
  parseModel,
  parseStylePreset,
} from './request-guard.ts';
import { decideModel, grantedFor } from './model-access.ts';
import { microUsdOf, parsePrices, worstCaseMicroUsd } from './spend.ts';
import type { SpendVerdict } from './spend.ts';
import {
  KEEPALIVE_COMMENT,
  STREAM_HEADERS,
  createProgressThrottle,
  encodeEvent,
  parseKeepaliveMs,
} from './stream.ts';

export interface Env {
  /** Worker secret. Never reaches the browser. */
  ANTHROPIC_API_KEY?: string;
  /** Worker secret. Never reaches the browser. */
  DEEPSEEK_API_KEY?: string;
  /** "anthropic" or "deepseek". Explicit beats inferred; see selectProvider. */
  VIBLD_PROVIDER?: string;
  /**
   * Worker secret. Which models each principal may use, as JSON -- see
   * `parseModelPolicy`. A secret rather than a var because it names people
   * and this repository is public. Absent means no policy: everyone may use
   * whatever the deployment can serve.
   */
  VIBLD_MODEL_POLICY?: string;
  /** e.g. "yourteam.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's AUD tag. */
  ACCESS_AUD?: string;
  VIBLD_MODEL?: string;
  /** Transport keepalive interval in ms. Configuration, not a literal. */
  VIBLD_STREAM_KEEPALIVE_MS?: string;
  /** Per-user spend ledger. Without it the ceiling cannot be enforced. */
  USER_BUDGET?: DurableObjectNamespace<UserBudget>;
  /**
   * Burst gates. Optional: they are per-location and documented as permissive,
   * so they are a speed bump in front of the ledger rather than the limit.
   */
  PLAN_BURST?: RateLimit;
  PLAN_SUSTAINED?: RateLimit;
  /** Micro-USD one user may spend per UTC day. 4000000 == $4.00. */
  VIBLD_DAILY_MICRO_USD?: string;
  /** Runs one user may have in flight at once. */
  VIBLD_MAX_IN_FLIGHT?: string;
  /**
   * Micro-USD the whole deployment may spend per UTC day, across every user
   * -- docs/decisions.md L29. Layered above VIBLD_DAILY_MICRO_USD so one
   * compromised account cannot spend the month; the per-user ceiling alone
   * bounds only what *one* identity can do, not what N of them can do
   * together. Default is 20x the per-user default -- a starting point, not
   * a measured figure; correct it once real usage gives one.
   */
  VIBLD_ACCOUNT_DAILY_MICRO_USD?: string;
  VIBLD_USD_MICRO_PER_INPUT_TOKEN?: string;
  VIBLD_USD_MICRO_PER_OUTPUT_TOKEN?: string;
  /**
   * The control plane (docs/decisions.md L24/L25). Declared here because the
   * binding exists in wrangler.jsonc; not read by anything yet -- see
   * generation-store.ts's module comment for why that wiring waits on Clerk.
   */
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
}

/** Re-exported so Wrangler can find the class from the Worker's entrypoint. */
export { UserBudget };

const DEFAULT_DAILY_MICRO_USD = 4_000_000;
const DEFAULT_MAX_IN_FLIGHT = 2;
const DEFAULT_ACCOUNT_DAILY_MICRO_USD = 80_000_000;

/**
 * Reserved key for the account-wide ledger, sharing `USER_BUDGET`'s
 * namespace with every per-user key rather than needing a second binding.
 * Safe as long as it can never collide with a real identity: Access
 * authenticates real email addresses, and this is not one.
 */
const ACCOUNT_BUDGET_KEY = '__account__';

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Generation is available only when the key AND both Access settings are
 * present. Missing configuration means unavailable, never "open" — an
 * unauthenticated endpoint on a public URL lets anyone spend the account's
 * model budget, so the failure has to be closed.
 */
function isConfigured(env: Env): boolean {
  return Boolean(
    // Either provider's key configures the endpoint. Which one it selects is
    // `selectProvider`'s business, not this gate's.
    (env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY) &&
    env.ACCESS_TEAM_DOMAIN &&
    env.ACCESS_AUD &&
    // The ledger is part of the grant, not an optimisation: a deployment
    // that cannot account for spend must not be able to spend.
    env.USER_BUDGET,
  );
}

interface AccessDenied {
  denied: Response;
}
interface AccessGranted {
  denied: null;
  email: string;
}

async function requireAccess(
  request: Request,
  env: Env,
): Promise<AccessDenied | AccessGranted> {
  if (!isConfigured(env)) {
    return {
      denied: json(
        { error: 'Model generation is not configured for this deployment.' },
        403,
      ),
    };
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(
      request.headers.get('Cookie') ?? '',
    )?.[1];

  if (!token) {
    return {
      denied: json(
        { error: 'This endpoint requires Cloudflare Access sign-in.' },
        401,
      ),
    };
  }

  try {
    const keys = await fetchAccessKeys(env.ACCESS_TEAM_DOMAIN!);
    const claims = await verifyAccessJwt(token, {
      keys,
      audience: env.ACCESS_AUD!,
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
    });
    // The identity is carried forward so a run's cost is attributable to
    // someone. Spend with no name attached cannot be limited or explained.
    //
    // A token with no email claim falls into one shared 'unknown' bucket
    // rather than getting its own. That is deliberately the strict reading:
    // every such caller then competes for a single ceiling instead of each
    // being handed a fresh one.
    return { denied: null, email: claims.email ?? 'unknown' };
  } catch {
    // Deliberately opaque: a verification failure should not tell a caller
    // which check failed.
    return { denied: json({ error: 'Access verification failed.' }, 403) };
  }
}

interface BudgetLayers {
  account: Reservation;
  user: Reservation;
}

/** Only ever constructed from a verdict already known to deny the run. */
type DeniedVerdict = Extract<SpendVerdict, { allow: false }>;

/**
 * Reserves against both ceilings before a run may start: the account-wide
 * one first (cheaper to check, and failing it means the user-level ledger
 * never needs touching at all), then the per-user one. If the account layer
 * allows but the user layer then refuses, the account-level hold is
 * released at once -- a run that never starts must never leave a phantom
 * charge sitting against the account for up to fifteen minutes waiting on
 * the abandoned-reservation reclaim.
 */
async function reserveBudget(
  env: Env,
  email: string,
  worstCase: number,
): Promise<
  { ok: true; layers: BudgetLayers } | { ok: false; verdict: DeniedVerdict }
> {
  const ledger = env.USER_BUDGET!;
  const accountCeiling = positiveInt(
    env.VIBLD_ACCOUNT_DAILY_MICRO_USD,
    DEFAULT_ACCOUNT_DAILY_MICRO_USD,
  );
  // Unbounded in-flight on purpose: concurrency is the per-user layer's job
  // below. This layer enforces spend only.
  const account = await ledger
    .getByName(ACCOUNT_BUDGET_KEY)
    .reserve(worstCase, accountCeiling, Number.MAX_SAFE_INTEGER);
  if (!account.verdict.allow) {
    return { ok: false, verdict: account.verdict };
  }

  const userCeiling = positiveInt(
    env.VIBLD_DAILY_MICRO_USD,
    DEFAULT_DAILY_MICRO_USD,
  );
  const maxInFlight = positiveInt(
    env.VIBLD_MAX_IN_FLIGHT,
    DEFAULT_MAX_IN_FLIGHT,
  );
  const user = await ledger
    .getByName(email)
    .reserve(worstCase, userCeiling, maxInFlight);
  if (!user.verdict.allow) {
    if (account.id !== undefined) {
      await ledger.getByName(ACCOUNT_BUDGET_KEY).settle(account.id, 0);
    }
    return { ok: false, verdict: user.verdict };
  }

  return { ok: true, layers: { account, user } };
}

async function handlePlan(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  // Cheap rejections first, so a hostile request is refused before it costs
  // anything: shape, then size, then identity, then content.
  const origin = checkRequestOrigin(
    request.headers,
    new URL(request.url).origin,
  );
  if (!origin.ok) return json({ error: origin.error }, origin.status);

  const size = checkBodySize(request.headers);
  if (!size.ok) return json({ error: size.error }, size.status);

  const access = await requireAccess(request, env);
  if (access.denied) return access.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const parsed = parseGenerationRequest(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  const style = parseStylePreset(body);
  if (!style.ok) {
    return json({ error: style.error }, style.status);
  }

  const knowledge = parseKnowledge(body);
  if (!knowledge.ok) {
    return json({ error: knowledge.error }, knowledge.status);
  }

  const chosenModel = parseModel(body, configuredProviders(env));
  if (!chosenModel.ok) {
    return json({ error: chosenModel.error }, chosenModel.status);
  }

  // The picker only offers what this person may use, but the picker is a
  // convenience and this endpoint is the boundary.
  const decision = decideModel(
    env,
    access.email,
    chosenModel.value,
    resolveModel(env),
  );
  if (!decision.ok) return json({ error: decision.error }, decision.status);
  const effectiveModel = decision.model;

  // Layer one: a burst gate keyed on the caller. It is per-location and
  // documented as permissive, so it stops a naive flood and nothing more --
  // it is allowed to fail open only because the layer below fails closed.
  try {
    const key = `plan:${access.email}`;
    const gates = [env.PLAN_BURST, env.PLAN_SUSTAINED].filter(
      (gate): gate is RateLimit => gate !== undefined,
    );
    const results = await Promise.all(gates.map((gate) => gate.limit({ key })));
    if (results.some((result) => !result.success)) {
      return json(
        { error: 'Too many generation requests. Try again shortly.' },
        429,
      );
    }
  } catch (error) {
    console.error('rate limiter unavailable', error);
  }

  // Layer two: the ceiling. The worst case is charged before the run, because
  // charging afterwards gives an accurate ledger and no limit -- concurrent
  // callers would all read the same balance and all find headroom.
  const chosen = findModel(effectiveModel);
  const prices = parsePrices(
    env,
    providerForRequest(env, effectiveModel),
    chosen
      ? {
          inputMicroUsd: chosen.inputMicroUsd,
          outputMicroUsd: chosen.outputMicroUsd,
        }
      : undefined,
  );
  const worstCase = worstCaseMicroUsd(
    prices,
    DEFAULT_MAX_TOKENS,
    // Prompt plus the base project that goes with it. Both are what the
    // guard above has already refused to exceed.
    DEFAULT_LIMITS.maxPromptChars +
      DEFAULT_LIMITS.maxTotalContentChars +
      DEFAULT_LIMITS.maxKnowledgeChars,
  );
  const ledger = env.USER_BUDGET!;

  let reserved;
  try {
    reserved = await reserveBudget(env, access.email, worstCase);
  } catch (error) {
    // Fail closed. A retry costs the user a minute; an unbounded endpoint on
    // a public URL costs real money. 503 rather than 429: this is the
    // service's problem, and telling the user they did too much is a lie.
    console.error('spend ledger unavailable', error);
    return new Response(
      JSON.stringify({
        error: 'Usage accounting is unavailable; generation is paused.',
      }),
      { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
    );
  }

  if (!reserved.ok) {
    return json(
      {
        error:
          reserved.verdict.reason === 'daily-ceiling'
            ? 'Daily generation budget reached. It resets at 00:00 UTC.'
            : 'A generation is already running. Wait for it to finish.',
      },
      429,
    );
  }
  const reservation = reserved.layers.user;

  // Stream rather than buffer. A buffered response sends nothing until the
  // model finishes, and the client gives up first -- which surfaces as an
  // opaque network error, not a failed generation.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const keepaliveMs = parseKeepaliveMs(env.VIBLD_STREAM_KEEPALIVE_MS);

  let keepalive: ReturnType<typeof setInterval> | undefined;
  const stopKeepalive = () => {
    if (keepalive !== undefined) {
      clearInterval(keepalive);
      keepalive = undefined;
    }
  };

  // A run nobody is waiting for is still billed until the call to the model
  // ends. `ctx.waitUntil` deliberately outlives the response, so without this
  // a user who closes the tab -- or presses Cancel -- pays for a plan that is
  // then thrown away.
  const abort = new AbortController();
  let cancelledBy: string | undefined;
  const cancel = (reason: string) => {
    if (abort.signal.aborted) return;
    cancelledBy = reason;
    stopKeepalive();
    abort.abort();
  };

  // Two independent notices that the client is gone. The runtime aborts
  // `request.signal` on disconnect; a failed write catches the same thing at
  // the next keepalive, which is the backstop if the signal is unavailable.
  request.signal?.addEventListener('abort', () => cancel('client-disconnect'));

  const write = (chunk: string) =>
    writer.write(encoder.encode(chunk)).catch(() => cancel('write-failed'));

  // A whole project takes minutes to write, so the wait needs to show
  // something real rather than a spinner that could equally mean "hung".
  const reportProgress = createProgressThrottle({
    emit: (update) => void write(encodeEvent('progress', update)),
  });

  let usage: PlanUsage | undefined;
  const provider = new PlanProvider(createPlanClient(env, effectiveModel), {
    // Always a model this person is granted: their own choice when they made
    // one, otherwise the deployment default if they may use it, otherwise the
    // first thing they may.
    model: effectiveModel,
    onUsage: (reported) => {
      usage = reported;
    },
    onProgress: ({ characters }) => reportProgress(characters),
    signal: abort.signal,
    ...(style.value ? { style: style.value } : {}),
    ...(knowledge.value ? { knowledge: knowledge.value } : {}),
  });

  // First bytes immediately, so the connection is never idle from the start.
  void write(KEEPALIVE_COMMENT);
  keepalive = setInterval(() => void write(KEEPALIVE_COMMENT), keepaliveMs);

  const run = (async () => {
    let outcome = 'ok';
    try {
      const plan = await provider.generate(parsed.value);
      await write(encodeEvent('plan', { providerId: provider.id, plan }));
    } catch (error) {
      if (abort.signal.aborted) {
        // The caller left. Writing an error to a closed stream would fail
        // anyway, and this is not a fault worth reporting as one.
        outcome = 'cancelled';
      } else if (error instanceof ProviderError) {
        // Expected, explainable outcomes, not server faults.
        outcome = 'provider-error';
        await write(
          encodeEvent('error', { error: error.message, kind: error.name }),
        );
      } else {
        // Never forward an upstream error body: it can carry request details.
        outcome = 'error';
        console.error('plan generation failed', error);
        await write(
          encodeEvent('error', { error: 'Generation failed unexpectedly.' }),
        );
      }
    } finally {
      stopKeepalive();
      // Reconcile the pessimistic debit down to what the run really cost.
      // A run that never reported usage settles at the full reservation
      // rather than at zero: failing safe means over-counting, not under.
      const actual = usage ? microUsdOf(usage, prices) : worstCase;
      if (reservation.id !== undefined) {
        ctx.waitUntil(
          ledger
            .getByName(access.email)
            .settle(reservation.id, actual)
            .catch((error: unknown) =>
              console.error('spend settlement failed', error),
            ),
        );
      }
      // Both layers were reserved together, so both settle together -- the
      // account-wide ledger must reflect the same run at the same cost, or
      // its ceiling stops meaning what it says.
      const accountReservation = reserved.layers.account;
      if (accountReservation.id !== undefined) {
        ctx.waitUntil(
          ledger
            .getByName(ACCOUNT_BUDGET_KEY)
            .settle(accountReservation.id, actual)
            .catch((error: unknown) =>
              console.error('account spend settlement failed', error),
            ),
        );
      }
      // Spend is recorded even when the run failed: a refusal, a truncation
      // or a cancellation still consumed tokens, and a record that counts
      // only successes under-reports the bill.
      console.log(
        JSON.stringify({
          event: 'generation.settled',
          email: access.email,
          model: provider.id,
          outcome,
          ...(cancelledBy ? { cancelledBy } : {}),
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          microUsd: actual,
        }),
      );
      await writer.close().catch(() => {});
    }
  })();

  // `waitUntil` is safe here only because the run is now abortable. Without
  // that it would guarantee an abandoned generation up to 30 more seconds of
  // billable model time; with it, the window is used for the opposite -- the
  // spend record still gets written after the caller has gone.
  ctx.waitUntil(run);

  return new Response(readable, { status: 200, headers: STREAM_HEADERS });
}

/** The slice of Cloudflare's ExecutionContext this Worker uses. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Lets the shell show which provider is actually in use instead of
    // implying AI when it is running the deterministic fake.
    if (pathname === '/api/config') {
      // Identified before answered: the picker is per-person now, so this
      // cannot be served to an anonymous caller without telling them what
      // somebody else may use.
      const access = await requireAccess(request, env);
      if (access.denied) return access.denied;

      // Two filters, in order. What the deployment can serve at all --
      // offering a model whose provider has no key produces a run that fails
      // after the user has waited for it. Then what this person is granted.
      const models = grantedFor(env, access.email);
      // The deployment default is only offered if this person may use it.
      const decided = decideModel(env, access.email, null, resolveModel(env));
      return json({
        generation: isConfigured(env) ? 'model' : 'fake',
        models: models.map(({ id, label, note, provider }) => ({
          id,
          label,
          note,
          provider,
        })),
        defaultModel: decided.ok ? decided.model : null,
      });
    }

    if (pathname === '/api/plan') {
      return handlePlan(request, env, ctx);
    }

    return json({ error: 'Not found.' }, 404);
  },
};
