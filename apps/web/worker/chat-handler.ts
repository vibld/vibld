import {
  ChatProvider,
  ProviderError,
  configuredProviders,
  resolveModel,
} from '@vibld/ai';
import type { PlanClient, PlanUsage } from '@vibld/ai';
import type { RunRefusal } from '@vibld/core';

import { whenClientGone } from './client-gone.ts';
import { sanitizedProviderFailure, settleBudget } from './generation-run.ts';
import { NO_PANEL, decideModel } from './model-access.ts';
import type { ModelAccessEnv, ModelGrantSource } from './model-access.ts';
import { modelGrantSource } from './model-grants.ts';
import type {
  Principal,
  PrincipalDenied,
  PrincipalGranted,
} from './principal.ts';
import {
  checkBodySize,
  checkRequestOrigin,
  parseChatRequest,
  parseModel,
} from './request-guard.ts';
import { refusalFor, reserveBudget } from './reserve.ts';
import type { ReserveEnv } from './reserve.ts';
import { CHAT_INPUT_CHARS, runCeilingFor } from './run-ceiling.ts';
import type { RunCeilingEnv } from './run-ceiling.ts';
import { cancelledUsage, worstCaseMicroUsd } from './spend.ts';
import type { Tier } from './entitlement.ts';
import { SUSPENDED_MESSAGE, spendableFor, tierOf } from './spendable.ts';
import type { Spendable } from './spendable.ts';
import type { TierEnv } from './spendable.ts';

/**
 * `POST /api/chat`: one turn of the builder's conversation (docs/decisions.md,
 * "Resolved 2026-09-28").
 *
 * The agent decides what each message is for. It either replies in words and
 * changes nothing, or returns a self-contained brief that the client then
 * submits to `/api/plan` exactly as a typed prompt is submitted today. This
 * route never builds anything itself.
 *
 * Modelled on `handleMockups` in `index.ts`, and deliberately guarded and
 * charged by the same code: the origin and size checks, the principal, the
 * model policy, its own rate-limit bucket on the same limiters, and the
 * shared reservation and settlement (`runCeilingFor`, `worstCaseMicroUsd`,
 * `spendableFor`, `reserveBudget`, `settleBudget`). The invite gate stands
 * in front of it in the router, as it does for every route that spends
 * model budget (`access-gate.ts`).
 *
 * What differs from mockups is only the shape of the run. A turn is one
 * short call whose answer is a sentence or a brief, so the response is a
 * JSON body rather than an event stream, and there is no retry of an empty
 * reply: a failed turn is asked again by typing.
 *
 * In its own module rather than in `index.ts`, which cannot be loaded under
 * `node --test`, so every refusal and both settlement paths are exercised by
 * `chat-handler.test.ts` against the real guards and ledger code.
 */

export interface ChatEnv
  extends ReserveEnv, TierEnv, RunCeilingEnv, ModelAccessEnv {
  PLAN_BURST?: RateLimit;
  PLAN_SUSTAINED?: RateLimit;
}

export interface ChatDeps {
  /** Whether this deployment can generate at all (`isConfigured`). */
  configured: boolean;
  resolvePrincipal: (
    request: Request,
  ) => Promise<PrincipalDenied | PrincipalGranted>;
  /** The provider client for a model (`createPlanClient` in production). */
  createClient: (model: string) => PlanClient;
  /** Keeps settlement alive past a client that disconnected. */
  waitUntil: (promise: Promise<unknown>) => void;
  /** Defaults to `spendableFor`, which reads D1. */
  spendable?: (principal: Principal) => Promise<Spendable>;
  /** Defaults to `tierOf`, which reads D1. */
  tier?: (principal: Principal) => Promise<Tier | null>;
  /** Defaults to `modelGrantSource`, the panel's model access in D1. */
  access?: (principal: Principal) => Promise<ModelGrantSource>;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The same shape `index.ts`'s `refuse` answers with. */
function refuse(reason: RunRefusal, error: string, status: number): Response {
  return json({ error, reason }, status);
}

export async function handleChat(
  request: Request,
  env: ChatEnv,
  deps: ChatDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  const waitingSince = Date.now();

  if (!deps.configured) {
    return refuse('not-configured', 'Generation is not configured.', 503);
  }

  const origin = checkRequestOrigin(
    request.headers,
    new URL(request.url).origin,
  );
  if (!origin.ok) {
    return refuse('request-invalid', origin.error, origin.status);
  }

  const size = checkBodySize(request.headers);
  if (!size.ok) return refuse('request-invalid', size.error, size.status);

  const resolved = await deps.resolvePrincipal(request);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse('request-invalid', 'Body must be valid JSON.', 400);
  }

  const parsed = parseChatRequest(body);
  if (!parsed.ok) {
    return refuse('request-invalid', parsed.error, parsed.status);
  }

  const chosenModel = parseModel(body, configuredProviders(env));
  if (!chosenModel.ok) {
    return refuse('request-invalid', chosenModel.error, chosenModel.status);
  }

  // The plan holds a Free account to GPT-6 Luna (D66), or to what the
  // panel saved for it (D133). Unreadable, the turn is refused as the
  // reservation below refuses it: guessing a plan either way is wrong for
  // somebody.
  let tier: Tier | null;
  let access: ModelGrantSource;
  try {
    [tier, access] = await Promise.all([
      (deps.tier ?? ((who: Principal) => tierOf(env, who)))(principal),
      (
        deps.access ??
        ((who: Principal) =>
          env.DB ? modelGrantSource(env.DB, who.userId) : NO_PANEL)
      )(principal),
    ]);
  } catch (error) {
    console.error('tier unavailable', error);
    return new Response(
      JSON.stringify({
        error: 'Usage accounting is unavailable; generation is paused.',
        reason: 'accounting-unavailable' satisfies RunRefusal,
      }),
      { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
    );
  }

  const decision = decideModel(
    env,
    principal.policyIdentity,
    tier,
    chosenModel.value,
    resolveModel(env),
    access,
  );
  if (!decision.ok) {
    return refuse('model-not-allowed', decision.error, decision.status);
  }
  const effectiveModel = decision.model;

  // Its own bucket on the build's limiters, as mockups has: talking is not
  // building, and sharing the counter would mean a question cost somebody
  // the build they were about to ask for.
  try {
    const key = `chat:${principal.userId}`;
    const gates = [env.PLAN_BURST, env.PLAN_SUSTAINED].filter(
      (gate): gate is RateLimit => gate !== undefined,
    );
    const results = await Promise.all(gates.map((gate) => gate.limit({ key })));
    if (results.some((result) => !result.success)) {
      return refuse(
        'rate-limited',
        'Too many requests. Try again shortly.',
        429,
      );
    }
  } catch (error) {
    console.error('rate limiter unavailable', error);
  }

  const { prices, maxTokens } = runCeilingFor(env, effectiveModel, 'chat');
  const worstCase = worstCaseMicroUsd(prices, maxTokens, CHAT_INPUT_CHARS);

  let reserved;
  try {
    const spendable =
      deps.spendable ?? ((who: Principal) => spendableFor(env, who));
    const allowed = await spendable(principal);
    if (allowed.suspended) {
      return refuse('account-suspended', SUSPENDED_MESSAGE, 403);
    }
    const { monthlyAllowance, topupCeiling } = allowed;
    reserved = await reserveBudget(
      env,
      principal.userId,
      worstCase,
      monthlyAllowance,
      topupCeiling,
      Date.now(),
    );
  } catch (error) {
    console.error('budget unavailable', error);
    return new Response(
      JSON.stringify({
        error: 'Usage accounting is unavailable; generation is paused.',
        reason: 'accounting-unavailable' satisfies RunRefusal,
      }),
      { status: 503, headers: { ...JSON_HEADERS, 'retry-after': '30' } },
    );
  }

  // Not fitted to what the caller has left, as a build is: a turn is one
  // call with its own small ceiling, and a brief it returns is built by
  // `/api/plan`, which does its own fitting. Only the sentence changes.
  if (!reserved.ok) {
    const refusal = refusalFor(reserved, 'A reply on this model', worstCase);
    return refuse(refusal.reason, refusal.error, 429);
  }

  const settleParams = {
    userId: principal.userId,
    ...(principal.email ? { email: principal.email } : {}),
    reservationId: reserved.layers.user.id,
    reservationKey: reserved.layers.userReservationKey,
    accountReservationId: reserved.layers.account.id,
    worstCaseMicroUsd: worstCase,
    prices,
  };

  // A reader who leaves stops the model call, and the turn is settled from
  // what was measured rather than at its worst case (internal PR 189 review): the same
  // rule, and the same helper, as a cancelled mockup run.
  const abort = new AbortController();
  let cancelled = false;
  whenClientGone(request.signal, () => {
    cancelled = true;
    abort.abort();
  });

  const run = (async (): Promise<Response> => {
    let usage: PlanUsage | undefined;
    let providerRan = false;
    let streamedCharacters = 0;
    let reasoningCharacters = 0;
    let sentChars = 0;
    let action: 'reply' | 'build' | undefined;
    try {
      const provider = new ChatProvider(deps.createClient(effectiveModel), {
        model: effectiveModel,
        maxTokens,
        signal: abort.signal,
        onUsage: (reported) => {
          usage = reported;
        },
        onProgress: ({ characters, reasoningCharacters: reasoning }) => {
          streamedCharacters = characters;
          if (reasoning !== undefined) reasoningCharacters = reasoning;
        },
        onPromptChars: (characters) => {
          sentChars = characters;
        },
      });

      // Nothing has been asked for yet, so a caller who left before this
      // line costs nothing: `providerRan` stays false and settles at zero.
      if (cancelled) return json({ error: 'Canceled.' }, 499);

      providerRan = true;
      const turn = await provider.respond({
        messages: parsed.value.messages,
        project: parsed.value.project,
      });
      action = turn.action;
      return json({ turn, model: effectiveModel });
    } catch (error) {
      if (cancelled) return json({ error: 'Canceled.' }, 499);
      const visible = sanitizedProviderFailure(
        error,
        'chat turn failed',
        'Could not answer that. Try again shortly.',
      );
      return json(
        {
          error: visible.message,
          ...(visible instanceof ProviderError ? { stop: visible.stop } : {}),
        },
        502,
      );
    } finally {
      try {
        // Usage when the provider reported it, which it does before the
        // reply is validated, so a reply of the wrong shape is charged what
        // it cost. A cancelled call is settled from what was streamed.
        // Anything else that ran is left to `settleBudget`'s own rule: no
        // usage from a call that went out is charged at its worst case.
        const settled = usage
          ? usage
          : cancelled && providerRan
            ? cancelledUsage(
                streamedCharacters,
                maxTokens,
                sentChars,
                reasoningCharacters,
              )
            : undefined;
        const actual = await settleBudget(
          env.USER_BUDGET!,
          settleParams,
          settled,
          providerRan,
        );
        // Counts and money only. Never the conversation, the brief or the
        // project: those are the person's words, and a log line is not
        // where they belong.
        console.log(
          JSON.stringify({
            event: 'chat.settled',
            userId: principal.userId,
            ...(principal.email ? { email: principal.email } : {}),
            model: effectiveModel,
            ...(action ? { action } : { failed: true }),
            ...(usage ? {} : { cancelled, streamedCharacters }),
            inputTokens: settled?.inputTokens ?? 0,
            outputTokens: settled?.outputTokens ?? 0,
            microUsd: actual,
            elapsedMs: Date.now() - waitingSince,
          }),
        );
      } catch (error) {
        // Not lost: `budget.ts` reclaims an abandoned reservation at its
        // worst case, which over-charges rather than under-charges.
        console.error('chat settlement failed', error);
      }
    }
  })();

  // Held open past a client that disconnects, so settlement always runs.
  deps.waitUntil(run);
  return run;
}
