/**
 * Notice that the caller has left, including when they left already.
 *
 * `addEventListener('abort', ...)` does not replay an abort that has
 * already happened. Both streaming routes registered their `cancel` after
 * doing real work first -- verifying a token, reading an allowance,
 * reserving budget -- and a caller who disconnected during any of that had
 * already aborted the signal by the time the listener went on. Nothing
 * fired, and the run started anyway: a Workflow for a build, a model call
 * for a look, both for somebody who is not there (#189 review).
 *
 * The finding named the mockup route. The build route had it too, and that
 * one is the more expensive instance of the same bug -- a whole generation
 * rather than three sketches. This is why it is a function: the two routes
 * had the same two lines, so they had the same hole, and a third route
 * would have copied it.
 *
 * Registered before the check, not after. Either order handles an abort
 * that has already landed, but this one also has the listener live for the
 * window in between, so nothing can slip through it. `cancel` is expected
 * to be idempotent -- both callers guard on a `cancelled` flag -- so firing
 * it twice is harmless.
 */
export function whenClientGone(
  signal: AbortSignal | undefined,
  cancel: () => void,
): void {
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) cancel();
}
