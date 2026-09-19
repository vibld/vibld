import type { ProjectFile } from '@vibld/core';

/**
 * Reading a finished build's output back, one file at a time.
 *
 * Its own module so it can be called rather than read (#196 review).
 * `preview-sandbox.ts` imports `@cloudflare/sandbox` and cannot be loaded
 * under `node --test`, so every assertion about this loop has been a regex
 * over source, and the defect that prompted the extraction is exactly the
 * kind a regex does not see: the renewal counted the files it kept rather
 * than the files it read, so a build whose output was mostly binary did one
 * RPC per asset and renewed the lock either never or on every single one,
 * depending on where the text-file count happened to stop. Both are wrong
 * for the same reason, and a test that calls this with a hundred skipped
 * entries sees it at once.
 *
 * The same reasoning as `build-failure.ts` beside it, and the standing
 * answer to seven tests on that file that measured the text around a
 * property instead of the property.
 */

/** What `listFiles` gives back, narrowed to what this needs. */
export interface OutputEntry {
  type: string;
  relativePath: string;
}

/** What `readFile` gives back, likewise. */
export interface ReadFileResult {
  encoding?: string;
  content: string;
}

/**
 * How often the loop pushes the lock forward.
 *
 * Every file would be an extra storage write per file for no more safety;
 * never would leave the longest unbounded stretch in a build measured
 * against a TTL it can outrun.
 */
export const LOCK_RENEWAL_EVERY = 25;

/**
 * Only text output is returned. A build that emits binary assets (images,
 * fonts) names them in `skipped` rather than mangling them: apps/publish's
 * own R2 usage is text-only today, so there is nowhere correct to put
 * binary bytes yet.
 *
 * `renew` is called before the first read and every `LOCK_RENEWAL_EVERY`
 * reads after it, counted by what this does rather than by what it keeps.
 * A skipped asset costs exactly the same RPC as a kept one, which is the
 * whole reason the renewal exists.
 */
export async function collectOutput(
  entries: OutputEntry[],
  read: (relativePath: string) => Promise<ReadFileResult>,
  renew: () => Promise<void>,
): Promise<{ output: ProjectFile[]; skipped: string[] }> {
  const output: ProjectFile[] = [];
  const skipped: string[] = [];
  let asked = 0;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (asked % LOCK_RENEWAL_EVERY === 0) await renew();
    asked += 1;
    const file = await read(entry.relativePath);
    if (file.encoding === 'base64') {
      skipped.push(entry.relativePath);
      continue;
    }
    output.push({ path: entry.relativePath, content: file.content });
  }
  return { output, skipped };
}
