import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
} from '@vibld/core';
import type {
  GenerationPlan,
  GenerationRequest,
  ModelProvider,
  ProjectFile,
} from '@vibld/core';
import { checkDesign, repairPromptFor } from '@vibld/ai';

import { CASES, stubPlan } from '../src/cases.ts';
import { createEvalValidator } from '../src/validator.ts';
import { repairCandidate, repairPrompt } from '../src/repair.ts';

/**
 * The bakeoff's repair turn is the product's repair turn, or its figure
 * means nothing. These check what it sends against what the product sends,
 * with a provider that records its requests and answers from a script: no
 * model is called.
 */

const testCase = CASES.find((entry) => entry.id === 'vibld-marketing')!;
const ERROR =
  "npm run build failed (exit 2): src/App.tsx(3,10): error TS1484: 'ReactNode' is a type and must be imported using a type-only import";

/** A provider that answers `plans` in turn and keeps every request. */
function recording(plans: GenerationPlan[]): ModelProvider & {
  requests: GenerationRequest[];
} {
  const inner = new FakeModelProvider(plans);
  const requests: GenerationRequest[] = [];
  return {
    id: 'recording',
    requests,
    generate: (request) => {
      requests.push(structuredClone(request));
      return inner.generate(request);
    },
  };
}

/** The candidate as the eval accepted it, and the revision it recorded. */
async function generated(): Promise<{
  files: ProjectFile[];
  revision: string;
}> {
  const store = new InMemoryGenerationStore();
  const result = await new DurableGenerationRunner(store).run(
    { prompt: testCase.prompt, projectId: 'p', runId: 'r' },
    new FakeModelProvider([stubPlan(testCase)]),
    createEvalValidator(),
  );
  return { files: result.accepted!.files, revision: result.accepted!.revision };
}

function fixed(files: ProjectFile[]): GenerationPlan {
  return {
    summary: 'fixed',
    files: files.map((file) =>
      file.path === 'src/App.tsx'
        ? { ...file, content: `${file.content}\n// fixed\n` }
        : file,
    ),
  };
}

describe('the repair request', () => {
  it('is one call, sent the product prompt and the candidate as the prior state', async () => {
    const { files, revision } = await generated();
    const provider = recording([fixed(files)]);
    await repairCandidate({
      testCase,
      files,
      error: ERROR,
      provider,
      projectId: 'm:vibld-marketing#1',
      revision,
    });

    assert.equal(provider.requests.length, 1);
    const [request] = provider.requests;
    // What `verifyAndRepair` asks for a project that did not build: the
    // error, the design findings, and `built` false.
    assert.equal(
      request!.prompt,
      repairPromptFor(ERROR, checkDesign(files), false),
    );
    assert.ok(request!.prompt.includes(ERROR), 'the error, verbatim');
    // The prior state as the product hands it over: the accepted revision,
    // loaded from the store by the runner, as `request.base`.
    assert.deepEqual(request!.base, { revision, files });
  });

  it("keeps the candidate's DESIGN.md, as the product's repair does", async () => {
    const { files, revision } = await generated();
    const plan = fixed(files);
    const provider = recording([
      {
        ...plan,
        files: plan.files.map((file) =>
          file.path === 'DESIGN.md'
            ? { ...file, content: '# A different spec\n' }
            : file,
        ),
      },
    ]);
    const { project } = await repairCandidate({
      testCase,
      files,
      error: ERROR,
      provider,
      projectId: 'p',
      revision,
    });
    assert.equal(
      project!.files.find((file) => file.path === 'DESIGN.md')!.content,
      files.find((file) => file.path === 'DESIGN.md')!.content,
    );
  });

  it('holds the repaired project to the checks the first attempt passed', async () => {
    const { files, revision } = await generated();
    const passing = await repairCandidate({
      testCase,
      files,
      error: ERROR,
      provider: recording([fixed(files)]),
      projectId: 'p',
      revision,
    });
    assert.equal(passing.result.outcome, 'accepted');
    assert.ok(passing.project);
    assert.notEqual(passing.project.revision, revision);

    // A repair that drops a required file has not repaired the project.
    const dropped = await repairCandidate({
      testCase,
      files,
      error: ERROR,
      provider: recording([
        {
          summary: 'dropped',
          files: files.filter((file) => file.path !== 'src/styles.css'),
        },
      ]),
      projectId: 'p',
      revision,
    });
    assert.equal(dropped.result.outcome, 'failed-expectations');
    assert.ok(
      dropped.result.problems.includes(
        'expected file src/styles.css is missing',
      ),
    );
  });

  it('writes nothing for a repair that failed validation', async () => {
    // The store still holds the first attempt then, and handing that back
    // as the repair would credit the repair with the original's build.
    const { files, revision } = await generated();
    const out = await repairCandidate({
      testCase,
      files,
      error: ERROR,
      provider: recording([
        {
          summary: 'escaping',
          files: [...files, { path: '../escaped.txt', content: 'x' }],
        },
      ]),
      projectId: 'p',
      revision,
    });
    assert.equal(out.result.outcome, 'failed-validation');
    assert.equal(out.project, undefined);
  });

  it('refuses, without a call, a candidate that is not the one generated', async () => {
    const { files } = await generated();
    const provider = recording([fixed(files)]);
    const out = await repairCandidate({
      testCase,
      files,
      error: ERROR,
      provider,
      projectId: 'p',
      revision: 'r00000000',
    });
    assert.equal(provider.requests.length, 0);
    assert.equal(out.result.outcome, 'failed-validation');
    assert.match(
      out.result.problems[0]!,
      /not the r00000000 the eval generated/,
    );
  });

  it('asks what the product asks, named on its own', () => {
    const files = stubPlan(testCase).files;
    assert.equal(
      repairPrompt(files, ERROR),
      repairPromptFor(ERROR, checkDesign(files), false),
    );
  });
});
