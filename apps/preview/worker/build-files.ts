import type { ProjectFile } from '@vibld/core';

/**
 * The two per-file loops a build runs: writing the project in, and reading
 * its output back.
 *
 * They live together because they are the same shape and the same hazard,
 * and keeping them apart is how one of them ended up without the other's
 * protection. A build holds a lock with a fifteen-minute TTL and both loops
 * are one or two RPCs per file, so each has to push that lock forward as it
 * goes. The read loop was given renewals; the write loop was not, and
 * nothing about either file said the pair existed (#196 review).
 *
 * `keepAlive` says whether to carry on, rather than only pushing the lock
 * forward (#196 review). Renewing was never enough by itself: the renewal
 * is conditional on still owning the lock, so a build that had already been
 * superseded renewed nothing, learned nothing, and went on writing into the
 * workspace its successor had just emptied. Losing the lock has to stop the
 * work rather than merely fail to extend it, and running out of time is the
 * same fact arriving the other way.
 *
 * Its own module so they can be called rather than read (#196 review).
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
 * What a build's own deadline throws, so a caller can tell being stopped
 * from a sandbox fault and report it as the stop it is.
 */
export const OUT_OF_TIME = 'vibld:build:out-of-time';

/**
 * One operation, bounded by what is left of a build's wall clock
 * (#196 review).
 *
 * Checking a deadline between operations bounds a build made of many quick
 * calls and does nothing about a build stuck inside one slow call. A single
 * `writeFile` hanging past the deadline left everything the bound was for:
 * the lock expired, a second build took the workspace, the fleet reclaimed
 * a ticket whose container was still up, and the stalled call eventually
 * landed in somebody else's tree.
 *
 * The losing operation is not cancelled, because none of these can be. What
 * this buys is that the build itself ends on time, so its teardown starts
 * on time and destroys the container, and destroying the container is what
 * actually stops an orphaned RPC.
 *
 * The timer is cleared on either outcome. A pending timer per file would
 * otherwise outlive the work it was watching, which in a Durable Object
 * means holding it awake for the rest of the build's budget, and in a test
 * run means the process never exits.
 */
export function withinDeadline<T>(
  work: Promise<T>,
  msLeft: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(OUT_OF_TIME)),
      Math.max(0, msLeft),
    );
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * A command's own cap, cut down to what is left of the build's wall clock
 * (#196 review).
 *
 * Bounding the calls that had no bound of their own left the ones that
 * did: each command kept its full five minutes however much of the budget
 * had already gone, so a compile starting just before the deadline ran
 * five minutes past it. The wall clock was not a bound on the build, it
 * was a bound on everything except the two slowest things in it, and the
 * comment above it claimed otherwise. That is the same shape as every
 * finding on this pull request, written by me one commit earlier.
 *
 * Never negative, because a caller that is already out of time asks for
 * zero rather than for a command with no timeout at all.
 */
export function budgeted(cap: number, msLeft: number): number {
  return Math.min(cap, Math.max(0, msLeft));
}

/**
 * Writing the caller's project into the container, one file at a time.
 *
 * `write` is the caller's, because creating directories and writing bytes
 * is the sandbox's API and not this function's business. What is this
 * function's business is the loop, the heartbeat, and stopping.
 *
 * `keepAlive` is required rather than defaulted. A default would be
 * something a later caller under a lock forgets to replace, and it would
 * fail exactly the way this loop already failed: silently, on a big
 * project, with nothing to say so. A caller holding no lock passes one
 * that answers true and says why.
 *
 * Returns whether every file was written. False means the build stopped
 * being entitled to this workspace part way through, which its caller has
 * to report as a fault of the service rather than a verdict on the
 * project: half a tree measures nothing.
 */
export async function writeFiles<T>(
  files: T[],
  write: (file: T) => Promise<void>,
  keepAlive: () => Promise<boolean>,
): Promise<boolean> {
  let asked = 0;
  for (const file of files) {
    if (asked % LOCK_RENEWAL_EVERY === 0 && !(await keepAlive())) return false;
    asked += 1;
    await write(file);
  }
  return true;
}

/**
 * Reading a finished build's output back, one file at a time.
 *
 * Only text output is returned. A build that emits binary assets (images,
 * fonts) names them in `skipped` rather than mangling them: apps/publish's
 * own R2 usage is text-only today, so there is nowhere correct to put
 * binary bytes yet.
 *
 * `keepAlive` is asked before the first read and every `LOCK_RENEWAL_EVERY`
 * reads after it, counted by what this does rather than by what it keeps.
 * A skipped asset costs exactly the same RPC as a kept one, which is the
 * whole reason the heartbeat exists.
 *
 * `complete` is false when it said to stop. Whatever had been read by then
 * comes back rather than being thrown away, but a caller must not report a
 * partial tree as the build's output.
 */
export async function collectOutput(
  entries: OutputEntry[],
  read: (relativePath: string) => Promise<ReadFileResult>,
  keepAlive: () => Promise<boolean>,
): Promise<{ output: ProjectFile[]; skipped: string[]; complete: boolean }> {
  const output: ProjectFile[] = [];
  const skipped: string[] = [];
  let asked = 0;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (asked % LOCK_RENEWAL_EVERY === 0 && !(await keepAlive())) {
      return { output, skipped, complete: false };
    }
    asked += 1;
    const file = await read(entry.relativePath);
    if (file.encoding === 'base64') {
      skipped.push(entry.relativePath);
      continue;
    }
    output.push({ path: entry.relativePath, content: file.content });
  }
  return { output, skipped, complete: true };
}
