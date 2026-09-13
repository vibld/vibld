/**
 * Records which host `bin/plan.ts` would call, and answers nothing real.
 *
 * Loaded with `--import` so the CLI runs its own wiring: the same
 * `createPlanClient`, the same `resolveModel`, the same provider selection.
 * Only the socket is replaced, because the defect this guards against lives
 * in how those are called rather than in any of them.
 *
 * Never reached by a real run: nothing imports this outside the test that
 * names it on the command line.
 */
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input instanceof Request ? input.url : input);
  process.stdout.write(`called-host ${new URL(url).host}\n`);
  // Enough to end the run immediately. What was asked of which service is the
  // whole question; the answer is not.
  return new Response('{"error":"stopped by the test"}', { status: 400 });
}) as typeof fetch;
