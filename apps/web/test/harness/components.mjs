import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * What it takes to run a component here, rather than only typecheck one.
 *
 * `node --test --experimental-strip-types` strips TypeScript types and
 * errors on JSX, so every `.tsx` in this app was typechecked and never
 * exercised. Four findings on #122 and four on #123 were rules or wiring
 * inside a component for exactly that reason, and two of those were
 * introduced while fixing the one before. The rules moved into plain
 * modules, which is the better half of the answer; this is the other half,
 * for the wiring that cannot move anywhere.
 *
 * Loaded with `--import`, so it is in place before any test file resolves.
 *
 * It does nothing at all unless the file being run is a `*.test.tsx`. The
 * runner gives each test file its own process, so that check is exact, and
 * it is worth making: without it every existing test would swap the
 * runner's type stripping for a different transform and gain a `document`
 * it never had. Worker code that reached for a browser global would then
 * pass here and fail in production, which is the opposite of what this is
 * for.
 *
 * That rests on one assumption about the runner, so here is what happens if
 * it ever stops holding. Should node put two test files in one process, the
 * entry is one of them and the other is mismatched: if the entry is the
 * `.tsx`, a DOM appears where `harness-scope.test.ts` asserts there is
 * none and that test fails; if the entry is the `.ts`, the component test
 * loads untransformed and dies on its first tag. Both are loud. The
 * assumption is load-bearing, but it cannot fail quietly, which is the
 * property worth having.
 */
/**
 * `cloudflare:workers`, resolvable.
 *
 * `UserBudget` is the spend ledger and extends `DurableObject` from this
 * module, which node cannot resolve, so the one class that decides what a
 * caller is charged was the one class no test could even import. That is
 * not a gap worth keeping: #180 turned on whether a reclaimed reservation
 * can be corrected, and answering that by reading the SQL is how the bug
 * got there.
 *
 * Registered for every test rather than behind the `.test.tsx` check
 * below, because a `.test.ts` is exactly what needs it. Deliberately not a
 * simulation of the runtime: the base class only has to hold `ctx` and
 * `env`, which is all the code under test reads from it. Anything that
 * relied on real Durable Object behaviour -- the input gate above all --
 * would be untested here and has to stay out of these tests, which is why
 * `sqlite-do-storage.ts` says so in its own comment.
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

const entry = process.argv[1] ?? '';
if (entry.endsWith('.test.tsx')) {
  const { transformSync } = await import('esbuild');
  const { Window } = await import('happy-dom');
  const { sourceRoot, transformFor } = await import('./transform-target.ts');

  const SOURCE = sourceRoot(import.meta.url);

  /**
   * What Vite would have replaced, replaced here.
   *
   * `clerk-token.ts` reads `import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY`,
   * and node leaves `import.meta.env` undefined, so every Clerk-gated
   * component returns null before it draws anything. Testing them against
   * that would be testing the early return.
   *
   * The whole object rather than the one path, because the source reads it
   * through `?.` and a define for the longer path does not reliably match
   * through optional chaining. Not a real key: nothing here reaches Clerk,
   * and a value shaped like one would invite somebody to paste a real one
   * in.
   */
  const ENV = { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_harness_not_a_real_key' };

  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:')) return nextLoad(url, context);
      const path = fileURLToPath(url);
      const loader = transformFor(path, SOURCE);
      if (!loader) return nextLoad(url, context);
      const { code } = transformSync(readFileSync(path, 'utf8'), {
        loader,
        format: 'esm',
        jsx: 'automatic',
        target: 'esnext',
        sourcefile: path,
        define: { 'import.meta.env': JSON.stringify(ENV) },
      });
      return { format: 'module', source: code, shortCircuit: true };
    },
  });

  /**
   * A DOM, installed before anything can import `react-dom/client`.
   *
   * Here rather than in each test file so it cannot depend on import order:
   * `react-dom/client` reads these at module scope, and a test that
   * imported it above its own DOM setup would fail in a way that looked
   * like the component's fault.
   */
  const window = new Window({ url: 'https://app.vibld.test/' });
  // Taken from this window even where node already has a global of the same
  // name, which is the point rather than an oversight. Node defines `Event`,
  // and happy-dom's DOM checks events against its own class: a test that
  // built one from node's global got "parameter 1 is not of type 'Event'"
  // from `dispatchEvent`, which reads like a broken component and is a
  // broken harness. Only a `*.test.tsx` process reaches here, and in one the
  // DOM's implementations are the ones that have to win.
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'Element',
    'Node',
    'Event',
    'InputEvent',
    'MouseEvent',
    'KeyboardEvent',
    'CustomEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    // `mockup-frame.ts` parses untrusted model HTML with this rather than
    // matching it, after five review rounds in which a pattern was beaten
    // by something the real tokenizer does. A component that renders a
    // mockup therefore needs a parser here, and it has to be happy-dom's:
    // node has no DOMParser of its own, and one that disagreed with the
    // document those nodes belong to would be worse than none.
    'DOMParser',
  ]) {
    if (window[name] === undefined) continue;
    // Defined rather than assigned: some of these are getter-only on node's
    // globalThis (`navigator` is), and a plain assignment throws there.
    Object.defineProperty(globalThis, name, {
      value: window[name],
      writable: true,
      configurable: true,
    });
  }

  // React 19 refuses to run `act` without it, and `act` is how a test waits
  // for an effect to settle rather than guessing at a timeout.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
