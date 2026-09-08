import {
  AnthropicModelProvider,
  ProviderError,
  createAnthropicPlanClient,
} from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';

import { fetchAccessKeys, verifyAccessJwt } from './access.ts';
import {
  checkBodySize,
  checkRequestOrigin,
  parseGenerationRequest,
} from './request-guard.ts';
import {
  KEEPALIVE_COMMENT,
  STREAM_HEADERS,
  encodeEvent,
  parseKeepaliveMs,
} from './stream.ts';

export interface Env {
  /** Worker secret. Never reaches the browser. */
  ANTHROPIC_API_KEY?: string;
  /** e.g. "yourteam.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's AUD tag. */
  ACCESS_AUD?: string;
  VIBLD_MODEL?: string;
  /** Transport keepalive interval in ms. Configuration, not a literal. */
  VIBLD_STREAM_KEEPALIVE_MS?: string;
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
    env.ANTHROPIC_API_KEY && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD,
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

  let usage: PlanUsage | undefined;
  const provider = new AnthropicModelProvider(
    createAnthropicPlanClient({ apiKey: env.ANTHROPIC_API_KEY }),
    {
      ...(env.VIBLD_MODEL ? { model: env.VIBLD_MODEL } : {}),
      onUsage: (reported) => {
        usage = reported;
      },
    },
  );

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

  const write = (chunk: string) =>
    writer.write(encoder.encode(chunk)).catch(() => {
      // The client hung up. Stop the timer so it cannot outlive the request.
      stopKeepalive();
    });

  // First bytes immediately, so the connection is never idle from the start.
  void write(KEEPALIVE_COMMENT);
  keepalive = setInterval(() => void write(KEEPALIVE_COMMENT), keepaliveMs);

  const run = (async () => {
    try {
      const plan = await provider.generate(parsed.value);
      await write(encodeEvent('plan', { providerId: provider.id, plan }));
    } catch (error) {
      if (error instanceof ProviderError) {
        // Expected, explainable outcomes, not server faults.
        await write(
          encodeEvent('error', { error: error.message, kind: error.name }),
        );
      } else {
        // Never forward an upstream error body: it can carry request details.
        console.error('plan generation failed', error);
        await write(
          encodeEvent('error', { error: 'Generation failed unexpectedly.' }),
        );
      }
    } finally {
      stopKeepalive();
      // Spend is recorded even when the run failed: a refusal or a truncation
      // still consumed tokens, and a record that counts only successes
      // under-reports the bill.
      console.log(
        JSON.stringify({
          event: 'generation.settled',
          email: access.email,
          model: provider.id,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
        }),
      );
      await writer.close().catch(() => {});
    }
  })();

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
      return json({ generation: isConfigured(env) ? 'model' : 'fake' });
    }

    if (pathname === '/api/plan') {
      return handlePlan(request, env, ctx);
    }

    return json({ error: 'Not found.' }, 404);
  },
};
