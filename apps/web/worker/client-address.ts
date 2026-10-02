/**
 * The address a request came from, for the limits keyed on it: the owner's
 * sign-in throttle and the pre-auth limiter read `CF-Connecting-IP`.
 *
 * On Cloudflare the edge sets that header and a client cannot. Under
 * `wrangler dev` behind a server's proxy (D141) it is neither: every request
 * arrives from the proxy on 127.0.0.1, so all clients would share one
 * bucket, and a client-sent `CF-Connecting-IP` is passed through as it came,
 * so anyone could pick their own. There the proxy names the client in a
 * header of its own, which it sets from the connection and never takes from
 * the client (Traefik's `X-Real-Ip`), and `VIBLD_CLIENT_IP_HEADER` names
 * that header. Unset, the request is left exactly as it is.
 */
export interface ClientAddressEnv {
  VIBLD_CLIENT_IP_HEADER?: string;
}

export function withClientAddress(
  request: Request,
  env: ClientAddressEnv,
): Request {
  const header = env.VIBLD_CLIENT_IP_HEADER?.trim();
  if (!header) return request;
  const address = request.headers.get(header)?.split(',')[0]?.trim();
  const headers = new Headers(request.headers);
  // No address from the proxy is one shared, unspoofable bucket, never the
  // client's own choice.
  headers.set('CF-Connecting-IP', address || 'unknown');
  return new Request(request, { headers });
}
