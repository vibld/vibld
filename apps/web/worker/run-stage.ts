import type { GenerationStage } from '../src/generation/session.ts';

/**
 * What to call a Workflow's current state, on screen, to the person waiting.
 *
 * Two corrections from the same review, both of the same kind: a word that
 * claimed more than the poll loop can see.
 *
 * The first was the fallback. `WorkflowInstanceStatus` has more states than
 * the meter has words for, and this began as "queued, or else writing".
 * `paused`, `waiting`, `waitingForPause` and `unknown` all reach here, and
 * `waiting` is ordinary rather than exotic: it is where a run sits during
 * the delayed retries the settlement step is configured for.
 *
 * The second was the word itself. A Workflow instance reports `running` for
 * the whole of its work, and writing the project is only the first of its
 * three steps (`generation-workflow.ts`): settling the budget and recording
 * the trace follow, each with its own timeout and retries. So "writing"
 * went on being displayed for a while after the writing had stopped. The
 * stage is named for what the instance reports, and the shell's wording
 * describes the whole job rather than one step of it.
 *
 * What is left is two states this can name honestly and nothing for the
 * rest. An absent stage is already a supported shape (`progress.ts`): the
 * line carries the clock alone, which stays true in every state.
 *
 * A type-only import of the client's union, because a second copy of it
 * here is how the worker and the shell would come to disagree about what a
 * stage is. It is erased at build; no client code enters the worker bundle.
 */
export function stageFor(status: string): GenerationStage | undefined {
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  return undefined;
}
