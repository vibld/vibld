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
 *
 * `@cloudflare/sandbox` is stubbed the same way, and for the same reason
 * (D74): a live update's bookkeeping (which revision is served, what a
 * failure leaves behind, which fleet slot is given back) lives in
 * `PreviewSandbox` itself, and until now nothing in that class could be
 * run. `Sandbox` here holds `ctx` and `env` and nothing else; a test gives
 * the instance the container methods it uses (`exec`, `writeFile` and the
 * rest) as fakes of its own, so what is exercised is this Worker's code
 * and never a guess at the SDK's.
 */
const STUBS = {
  'cloudflare:workers': `export class DurableObject {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  }`,
  '@cloudflare/sandbox': `export class Sandbox {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  }
  export class ContainerProxy {}
  export function getSandbox() {
    throw new Error('getSandbox is not available under node --test');
  }
  export async function proxyToSandbox() {
    return null;
  }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUBS, specifier)) {
      return { url: `vibld-harness:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const name = url.startsWith('vibld-harness:')
      ? url.slice('vibld-harness:'.length)
      : undefined;
    if (name === undefined || !Object.hasOwn(STUBS, name)) {
      return nextLoad(url, context);
    }
    return { format: 'module', shortCircuit: true, source: STUBS[name] };
  },
});
