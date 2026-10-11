/**
 * `/.well-known/openai-apps-challenge`: the token OpenAI's plugin portal
 * asks for before it connects a directory listing to `/mcp` (D220).
 *
 * The portal issues the token when the MCP server is connected, and checks
 * that this host serves exactly that, as plain text. It is public by
 * design, so it is a plain variable (`OPENAI_APPS_CHALLENGE` in
 * `wrangler.jsonc`) rather than a secret. Unset, the path is a 404, as
 * on every deployment that is not listed.
 */

export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

export interface OpenAiAppsEnv {
  OPENAI_APPS_CHALLENGE?: string;
}

export function handleOpenAiAppsChallenge(
  request: Request,
  env: OpenAiAppsEnv,
): Response {
  const token = env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response('Not found.', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Use GET.', { status: 405, headers: { allow: 'GET' } });
  }
  return new Response(request.method === 'HEAD' ? null : token, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
