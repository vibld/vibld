import type { GenerationStage } from '../src/generation/session.ts';

/**
 * What to call a Workflow's current state, on screen, to the person waiting.
 *
 * `WorkflowInstanceStatus` has more states than the two the meter has words
 * for, and the first version of this treated everything that was not
 * `queued` as writing. That is wrong for at least four of them: `paused`,
 * `waiting`, `waitingForPause` and `unknown` all reach here, and `waiting`
 * is ordinary -- it is where a run sits during the delayed retries the
 * settlement step is configured for. Telling somebody "Writing your
 * project" while nothing is being written is the same lie as the frozen
 * line this meter replaced, only fluent.
 *
 * So the mapping names the two states it can name and returns nothing for
 * the rest. An absent stage is already a supported shape (`progress.ts`):
 * the line carries the clock alone, which is exactly what is still true.
 *
 * A type-only import of the client's union, because a second copy of it
 * here is how the worker and the shell would come to disagree about what a
 * stage is. It is erased at build; no client code enters the worker bundle.
 */
export function stageFor(status: string): GenerationStage | undefined {
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'writing';
  return undefined;
}
