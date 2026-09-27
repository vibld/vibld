import {
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
} from '@vibld/core';
import type { ModelProvider, ProjectFile, ProjectSnapshot } from '@vibld/core';
import { checkDesign, keepingRecordOf, repairPromptFor } from '@vibld/ai';
import type { EvalCase } from './cases.ts';
import { runCase } from './harness.ts';
import type { CaseResult } from './harness.ts';
import { createEvalValidator } from './validator.ts';

/**
 * One repair turn for a candidate that passed the eval's checks and did not
 * build, asked the way the product asks it.
 *
 * The product's repair (`verifyAndRepair` in
 * `apps/web/worker/generation-run.ts`) is a second run against a store that
 * already holds the first attempt as its accepted revision. `runGeneration`
 * reads that revision back and the runner hands it to the provider as
 * `request.base`, so the model is sent the build error, in
 * `repairPromptFor`'s words, with the project's current files as the prior
 * state; the plan provider puts those files into the prompt as the project
 * to edit. The provider is wrapped in `keepingRecordOf`, so the repair
 * cannot rewrite the DESIGN.md the project is checked against.
 *
 * This does the same things in the same order. The candidate is made the
 * store's accepted revision first, by running it through the runner as a
 * plan, which also recomputes its revision, so a caller can check that the
 * files it read back are the project that was generated. Then the repair is
 * `runCase` with the repair prompt in place of the case's, against that
 * store: the runner supplies the base exactly as it does in the product,
 * and the repaired project is held to exactly the checks the first attempt
 * was, the validator and the case's expectations.
 *
 * It never builds or runs anything. The candidate's files are text here,
 * and the caller holds model keys.
 */

export interface RepairInput {
  testCase: EvalCase;
  /** The candidate's files, in the order the eval recorded them. */
  files: ProjectFile[];
  /** The build error, as `buildErrorFor` words it. */
  error: string;
  provider: ModelProvider;
  projectId: string;
  /** The revision the eval recorded, to check the files against. */
  revision?: string;
}

export interface RepairOutput {
  result: CaseResult;
  /**
   * The repaired project, when the repair produced one that passed
   * validation. Present for a repair that failed the case's expectations
   * too, so it can be looked at, as the eval keeps such a first attempt.
   */
  project?: ProjectSnapshot;
}

/** What the model is sent, for a candidate whose build failed with `error`. */
export function repairPrompt(files: ProjectFile[], error: string): string {
  // The design findings as well as the error, and `built` false, because
  // that is how the product asks for a repair of a project that did not
  // build: it checks the files against their spec in the same step, and a
  // repair it pays for is told about both.
  return repairPromptFor(error, checkDesign(files), false);
}

export async function repairCandidate(
  input: RepairInput,
): Promise<RepairOutput> {
  const { testCase, files, error, provider, projectId } = input;
  const store = new InMemoryGenerationStore();

  // The candidate as the store's accepted revision, where the product's
  // store holds the first attempt when its repair begins.
  const seeded = await new DurableGenerationRunner(store).run(
    {
      prompt: testCase.prompt,
      projectId,
      runId: `${projectId}:generated`,
    },
    new FakeModelProvider([{ summary: 'as generated', files }]),
    createEvalValidator(),
  );
  const refused = (problem: string): RepairOutput => ({
    result: {
      id: testCase.id,
      outcome: 'failed-validation',
      durationMs: 0,
      problems: [problem],
      estimatedTokens: 0,
    },
  });
  if (seeded.state !== 'accepted' || !seeded.accepted) {
    return refused(
      `the candidate read back no longer passes validation: ${seeded.errors.join('; ')}`,
    );
  }
  if (
    input.revision !== undefined &&
    seeded.accepted.revision !== input.revision
  ) {
    return refused(
      `the candidate read back is revision ${seeded.accepted.revision}, not the ${input.revision} the eval generated`,
    );
  }

  const result = await runCase(testCase, keepingRecordOf(files, provider), {
    store,
    projectId,
    prompt: repairPrompt(files, error),
    runId: `${projectId}:repair`,
  });

  // Only a repair that passed validation was promoted. After one that did
  // not, the store still holds the first attempt, and writing that out as
  // the repair would build the original a second time and credit the
  // repair with the result.
  if (
    result.outcome !== 'accepted' &&
    result.outcome !== 'failed-expectations'
  ) {
    return { result };
  }
  const project = await store.loadAccepted(projectId);
  return project ? { result, project } : { result };
}
