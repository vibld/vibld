import { fileURLToPath } from 'node:url';

/**
 * Which files the component harness transforms, decided apart from the
 * hook that does it.
 *
 * The same reason the view rules live outside the components: a hook
 * registered with `--import` runs before any test and cannot be asserted on
 * from inside one. The bug this exists to prevent was in here rather than
 * in the transform, and it was invisible on a checkout path with no spaces
 * in it.
 */

/**
 * Where this app's browser sources are, as a native path.
 *
 * `new URL(...).pathname` is URL-encoded and `fileURLToPath` is not, so a
 * checkout under `/home/a b/vibld` gives `/home/a%20b/...` from one and
 * `/home/a b/...` from the other, and every comparison between them is
 * false. Nothing then gets the `import.meta.env` define, `clerkConfigured`
 * reads false, and the component tests exercise an early return instead of
 * a component. Both sides come from `fileURLToPath` so they are the same
 * kind of string.
 */
export function sourceRoot(harnessUrl: string | URL): string {
  return fileURLToPath(new URL('../../src/', harnessUrl));
}

/**
 * The esbuild loader to use for a file, or null to leave it to the runner.
 *
 * `.tsx` anywhere, because that is what the runner cannot load at all.
 * `.ts` only under `src/`, because the define has to reach
 * `clerk-token.ts`, which carries no JSX. Everything else keeps node's own
 * type stripping, so this is not quietly rebuilding the whole suite on a
 * different transform.
 */
export function transformFor(path: string, root: string): 'tsx' | 'ts' | null {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts') && path.startsWith(root)) return 'ts';
  return null;
}
