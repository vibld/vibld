import { registerHooks } from 'node:module';

/**
 * `cloudflare:workers`, resolvable, so `PreviewFleet` can be run here
 * rather than only read (internal issue 197).
 *
 * The fleet decides how many containers this deployment may run and who
 * gets them, and every test of it used to read its source, because it
 * extends `DurableObject` from a module node cannot resolve. That was a
 * poor instrument for the most safety-critical counting in this Worker:
 * Internal PR 196 took many review rounds on it, and none of them could run it.
 *
 * Loaded with `--import`, so it is in place before any test file resolves.
 * The same stub `apps/web/test/harness/components.mjs` registers for the
 * spend ledger, and deliberately not a simulation of the runtime: the base
 * class only has to hold `ctx` and `env`, which is all the code under test
 * reads from it. Anything that relied on real Durable Object behaviour, the
 * input gate above all, would be untested here and has to stay out of these
 * tests.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'vibld-harness:cloudflare-workers', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== 'vibld-harness:cloudflare-workers') {
      return nextLoad(url, context);
    }
    return {
      format: 'module',
      shortCircuit: true,
      source: `export class DurableObject {
        constructor(ctx, env) {
          this.ctx = ctx;
          this.env = env;
        }
      }`,
    };
  },
});
