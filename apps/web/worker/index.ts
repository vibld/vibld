import {
  PlanProvider,
  DEFAULT_MAX_TOKENS,
  ProviderError,
  availableModels,
  configuredProviders,
  createPlanClient,
  findModel,
  providerForRequest,
  resolveModel,
} from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';

import { fetchAccessKeys, verifyAccessJwt } from './access.ts';
import { UserBudget } from './budget.ts';
import {
  DEFAULT_LIMITS,
  checkBodySize,
  checkRequestOrigin,
  parseGenerationRequest,
  parseKnowledge,
  parseModel,
  parseStylePreset,
} from './request-guard.ts';
import { microUsdOf, parsePrices, worstCaseMicroUsd } from './spend.ts';
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
  VIBLD_USD_MICRO_PER_INPUT_TOKEN?: string;
  VIBLD_USD_MICRO_PER_OUTPUT_TOKEN?: string;
}

/** Re-exported so Wrangler can find the class from the Worker's entrypoint. */
export { UserBudget };

const DEFAULT_DAILY_MICRO_USD = 4_000_000;
const DEFAULT_MAX_IN_FLIGHT = 2;

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
  const chosen = chosenModel.value ? findModel(chosenModel.value) : null;
  const prices = parsePrices(
    env,
    providerForRequest(env, chosenModel.value),
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
  const ledger = env.USER_BUDGET!.getByName(access.email);

  let reservation;
  try {
    reservation = await ledger.reserve(
      worstCase,
      positiveInt(env.VIBLD_DAILY_MICRO_USD, DEFAULT_DAILY_MICRO_USD),
      positiveInt(env.VIBLD_MAX_IN_FLIGHT, DEFAULT_MAX_IN_FLIGHT),
    );
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

  if (!reservation.verdict.allow) {
    return json(
      {
        error:
          reservation.verdict.reason === 'daily-ceiling'
            ? 'Daily generation budget reached. It resets at 00:00 UTC.'
            : 'A generation is already running. Wait for it to finish.',
      },
      429,
    );
  }

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
  const provider = new PlanProvider(createPlanClient(env, chosenModel.value), {
    // The request's own choice wins; otherwise the deployment's. An unset or
    // blank VIBLD_MODEL falls back to the selected provider's own model
    // rather than to a single hard-coded one -- a model named for the other
    // provider is a 400 that reads like an outage.
    model: chosenModel.value ?? resolveModel(env),
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
            .settle(reservation.id, actual)
            .catch((error: unknown) =>
              console.error('spend settlement failed', error),
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
      // The picker is built from what this deployment can actually serve.
      // Offering a model whose provider has no key would produce a run that
      // fails after the user has already waited for it.
      const models = availableModels(configuredProviders(env));
      return json({
        generation: isConfigured(env) ? 'model' : 'fake',
        models: models.map(({ id, label, note, provider }) => ({
          id,
          label,
          note,
          provider,
        })),
        defaultModel: resolveModel(env),
      });
    }

    if (pathname === '/api/plan') {
      return handlePlan(request, env, ctx);
    }

    return json({ error: 'Not found.' }, 404);
  },
};
