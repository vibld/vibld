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
 */
const entry = process.argv[1] ?? '';
if (entry.endsWith('.test.tsx')) {
  const { transformSync } = await import('esbuild');
  const { Window } = await import('happy-dom');

  const SOURCE = new URL('../../src/', import.meta.url).pathname;

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
      const isTsx = path.endsWith('.tsx');
      // `.ts` under `src/` as well, and only there: the define above has to
      // reach `clerk-token.ts`, which carries no JSX. Everything outside
      // `src/` keeps the runner's own type stripping.
      if (!isTsx && !(path.endsWith('.ts') && path.startsWith(SOURCE))) {
        return nextLoad(url, context);
      }
      const { code } = transformSync(readFileSync(path, 'utf8'), {
        loader: isTsx ? 'tsx' : 'ts',
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
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'MouseEvent',
    'CustomEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    if (!(name in globalThis)) globalThis[name] = window[name];
  }

  // React 19 refuses to run `act` without it, and `act` is how a test waits
  // for an effect to settle rather than guessing at a timeout.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
