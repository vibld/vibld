import type { GenerationStage } from '../src/generation/session.ts';
import type { RunProgressState } from './generation-run.ts';

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
 * What is left is the states this can name honestly and nothing for the
 * rest. An absent stage is already a supported shape (`progress.ts`): the
 * line carries the clock alone, which stays true in every state.
 *
 * A third state arrived with the progress channel (#183), and it is not a
 * Workflow state at all: a reasoning model thinks before it writes, so a
 * run can be reporting thousands of characters of reasoning and none of
 * the answer. On the production provider that was between 57% and 68% of a
 * measured run's output tokens, which is most of the wait somebody is
 * staring at. "Building your project" for all of it would be true but
 * uninformative, and the count beside it would read zero.
 *
 * Derived from the report rather than asked of the Workflow, because the
 * Workflow does not know: `status` is `running` throughout. The condition is
 * exactly what it says -- thinking has started, the answer has not, and the
 * step that would write it has not left -- so the moment the first character
 * of the answer arrives this stops claiming it, without anything having to
 * decide that thinking is over.
 *
 * That third clause is a correction (#193 review, P2), and it is the same
 * mistake as the "Writing" one above, one state along. A completion that
 * refused, or was emptied, or was cut off, leaves a last report of
 * reasoning and no answer; the instance then reports `running` through
 * settlement and the trace write, retries included, for up to a minute
 * after the model call ended. Read from the report alone, the meter told
 * somebody a model that had stopped was still thinking. The step says when
 * it is done, and this believes it.
 *
 * A type-only import of the client's union, because a second copy of it
 * here is how the worker and the shell would come to disagree about what a
 * stage is. It is erased at build; no client code enters the worker bundle.
 */
/**
 * How often `handlePlan` checks its Workflow instance for a result.
 *
 * Here rather than in `index.ts`, where it used to be, because it is now
 * half of a pair: the generate step reports on `PROGRESS_REPORT_INTERVAL_MS`
 * and this loop reads on this one, and a reporter slower than the reader is
 * a meter that is stale every other poll. `index.ts` imports `cloudflare:
 * workers` and cannot be loaded under `node --test`, so a constant kept
 * there is a constant no test can compare.
 */
export const POLL_INTERVAL_MS = 1500;

export function stageFor(
  status: string,
  progress?: RunProgressState,
): GenerationStage | undefined {
  if (status === 'queued') return 'queued';
  if (status !== 'running') return undefined;
  const report = progress?.finished === false ? progress.report : undefined;
  if (report && report.characters === 0 && report.reasoningCharacters > 0) {
    return 'thinking';
  }
  return 'running';
}
