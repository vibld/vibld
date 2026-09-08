import {
  AnthropicModelProvider,
  ProviderError,
  createAnthropicPlanClient,
} from '@vibld/ai';
import type { GenerationRequest } from '@vibld/core';
import { fetchAccessKeys, verifyAccessJwt } from './access.ts';

export interface Env {
  /** Worker secret. Never reaches the browser. */
  ANTHROPIC_API_KEY?: string;
  /** e.g. "yourteam.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's AUD tag. */
  ACCESS_AUD?: string;
  VIBLD_MODEL?: string;
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

async function requireAccess(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!isConfigured(env)) {
    return json(
      { error: 'Model generation is not configured for this deployment.' },
      403,
    );
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(
      request.headers.get('Cookie') ?? '',
    )?.[1];

  if (!token) {
    return json(
      { error: 'This endpoint requires Cloudflare Access sign-in.' },
      401,
    );
  }

  try {
    const keys = await fetchAccessKeys(env.ACCESS_TEAM_DOMAIN!);
    await verifyAccessJwt(token, {
      keys,
      audience: env.ACCESS_AUD!,
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
    });
    return null;
  } catch {
    // Deliberately opaque: a verification failure should not tell a caller
    // which check failed.
    return json({ error: 'Access verification failed.' }, 403);
  }
}

function parseGenerationRequest(body: unknown): GenerationRequest | string {
  if (typeof body !== 'object' || body === null)
    return 'Body must be a JSON object';
  const { prompt, base } = body as { prompt?: unknown; base?: unknown };
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return 'A non-empty "prompt" is required';
  }
  if (prompt.length > 4000) return 'Prompt is too long';
  if (base === undefined) return { prompt };

  const snapshot = base as { revision?: unknown; files?: unknown };
  if (typeof snapshot.revision !== 'string' || !Array.isArray(snapshot.files)) {
    return '"base" must be a project snapshot';
  }
  const files = snapshot.files.filter(
    (file): file is { path: string; content: string } =>
      typeof file === 'object' &&
      file !== null &&
      typeof (file as { path?: unknown }).path === 'string' &&
      typeof (file as { content?: unknown }).content === 'string',
  );
  return { prompt, base: { revision: snapshot.revision, files } };
}

async function handlePlan(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405);
  }

  const denied = await requireAccess(request, env);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const parsed = parseGenerationRequest(body);
  if (typeof parsed === 'string') {
    return json({ error: parsed }, 400);
  }

  const provider = new AnthropicModelProvider(
    createAnthropicPlanClient({ apiKey: env.ANTHROPIC_API_KEY }),
    env.VIBLD_MODEL ? { model: env.VIBLD_MODEL } : {},
  );

  try {
    const plan = await provider.generate(parsed);
    return json({ providerId: provider.id, plan });
  } catch (error) {
    if (error instanceof ProviderError) {
      // These are expected, explainable outcomes, not server faults.
      return json({ error: error.message, kind: error.name }, 422);
    }
    // Never forward an upstream error body: it can carry request details.
    console.error('plan generation failed', error);
    return json({ error: 'Generation failed unexpectedly.' }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Lets the shell show which provider is actually in use instead of
    // implying AI when it is running the deterministic fake.
    if (pathname === '/api/config') {
      return json({ generation: isConfigured(env) ? 'model' : 'fake' });
    }

    if (pathname === '/api/plan') {
      return handlePlan(request, env);
    }

    return json({ error: 'Not found.' }, 404);
  },
};
