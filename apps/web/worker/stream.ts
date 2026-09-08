/**
 * Server-sent event framing for generation responses.
 *
 * A generation can run for a minute or more with no model output to forward.
 * Browsers, mobile networks and intermediate proxies drop a connection that
 * goes quiet long before the work finishes, and the failure looks like a
 * network error rather than anything the user did. So the transport emits
 * keepalives on its own timer, independent of model activity -- the
 * requirement recorded under "Long-running generation streams" in
 * docs/implementation-plan.md.
 */

export const KEEPALIVE_COMMENT = ': keepalive\n\n';

/** Documented default. Comfortably inside common browser and proxy idle windows. */
export const DEFAULT_KEEPALIVE_MS = 10_000;

export function parseKeepaliveMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 60_000) {
    return DEFAULT_KEEPALIVE_MS;
  }
  return Math.floor(parsed);
}

export function encodeEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Belt and braces for any proxy that would otherwise buffer the response
  // and defeat the keepalives entirely.
  'x-accel-buffering': 'no',
};
