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

/** How often a run reports characters written. See `createProgressThrottle`. */
export const DEFAULT_PROGRESS_INTERVAL_MS = 1000;

export interface ProgressThrottleOptions {
  /** Emits one frame. Called only for updates that survive the throttle. */
  emit: (update: { characters: number; elapsedMs: number }) => void;
  /** Injected so the throttle can be tested without waiting in real time. */
  now?: () => number;
  intervalMs?: number;
}

/**
 * Rate-limits progress updates to one per interval.
 *
 * A generation writes tens of thousands of characters and the SDK reports
 * every delta. Forwarding each one would put thousands of frames on a stream
 * to say something a person can only read once a second, so this drops the
 * ones in between. The first update always passes: the earliest possible
 * "something is happening" is the most valuable one.
 */
export function createProgressThrottle({
  emit,
  now = () => Date.now(),
  intervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
}: ProgressThrottleOptions): (characters: number) => void {
  const startedAt = now();
  let lastEmittedAt: number | null = null;

  return (characters: number) => {
    const at = now();
    if (lastEmittedAt !== null && at - lastEmittedAt < intervalMs) return;
    lastEmittedAt = at;
    emit({ characters, elapsedMs: at - startedAt });
  };
}
