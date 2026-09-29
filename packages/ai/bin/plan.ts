/**
 * Run one real generation and print the result. Nothing else in the repo makes
 * a live model call: CI, the builder shell and the test suite all use the
 * deterministic fake.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @vibld/ai plan "a landing page for ..."
 *
 * Writes the generated project to disk only when --out is given, so the
 * default is a dry read of what the model produced.
 *
 * The build is the product's own: in bounded steps (`bounded-build.ts`), an
 * outline and then a few files per call, each step printed as it starts. So
 * this is the way to see the steps against a real model, and what they cost.
 *
 * With --base <dir> the request carries an existing project, which is the
 * only way to exercise iteration against a real model. A follow-up is a
 * patch: it prints what the patch kept, changed, added and removed, and
 * specifically what it removed, because a removed file is deleted.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BoundedPlanProvider } from '../src/bounded-build.ts';
import { createPlanClient, resolveModel } from '../src/select-client.ts';
import { ProviderError } from '../src/errors.ts';
import { parsePlanArgs } from '../src/cli-args.ts';
import { isStylePresetId } from '../src/style-presets.ts';
import { diffProjects, readProject } from '../src/read-project.ts';
import type { PlanUsage } from '../src/client.ts';
import type { RunStepTrace } from '@vibld/core';

const { prompt, out, base, style } = parsePlanArgs(process.argv.slice(2));

if (!prompt) {
  console.error(
    'Usage: pnpm --filter @vibld/ai plan "<prompt>" [--out <dir>] [--base <dir>] [--style <preset id>]',
  );
  process.exit(2);
}

// Refused rather than dropped: a run that silently built unstyled would be
// paid for and answer a different question from the one asked.
if (style !== undefined && !isStylePresetId(style)) {
  console.error(`"${style}" is not a style preset id.`);
  process.exit(2);
}

let usage: PlanUsage | undefined;
let measured: RunStepTrace[] = [];

/** Each call's time and output, so the slow step is named, not guessed. */
function printSteps(): void {
  if (measured.length === 0) return;
  console.log('\nsteps:');
  for (const step of measured) {
    console.log(
      `  ${step.name.padEnd(14)} ${(step.ms / 1000).toFixed(1).padStart(7)}s ` +
        `${String(step.outputTokens).padStart(7)} out` +
        (step.reasoningTokens !== undefined
          ? ` (${step.reasoningTokens} reasoning)`
          : ''),
    );
  }
}

function reasoningNote(reported: PlanUsage): string {
  return reported.reasoningTokens !== undefined
    ? `, ${reported.reasoningTokens} of it reasoning`
    : '';
}
// Which service answers is configuration, not a constant: VIBLD_PROVIDER
// picks, or the single key that is set does. An unset VIBLD_MODEL falls back
// to the chosen provider's own model, never the other one's.
//
// The model is resolved first and handed to the client, because a chosen
// model decides which service answers. Without it the two were read
// independently: the client from VIBLD_PROVIDER and the model from
// VIBLD_MODEL, so VIBLD_PROVIDER=openai with an Anthropic model id sent that
// id to OpenAI and got a 400 that reads like an outage. `providerForRequest`
// has always said the model wins, and the Worker has always behaved that way;
// this is the one caller that did not.
const model = resolveModel(process.env);
const startedAt = Date.now();
let steps = 0;
const provider = new BoundedPlanProvider(createPlanClient(process.env, model), {
  model,
  ...(style !== undefined && isStylePresetId(style) ? { style } : {}),
  onUsage: (reported) => {
    usage = reported;
  },
  onSteps: (steps) => {
    measured = steps;
  },
  // One line per step, with the time it started, so a slow step can be
  // told from a stuck one in the job log.
  onStep: (label) => {
    steps += 1;
    const at = ((Date.now() - startedAt) / 1000).toFixed(0).padStart(4);
    console.log(`[${at}s] ${label}`);
  },
  onUnexpectedError: (error) => {
    console.error('unexpected error from the model service:', error);
  },
});

try {
  const baseProject = base ? await readProject(base) : undefined;
  if (baseProject) {
    console.log(
      `editing ${baseProject.files.length} existing files from ${resolve(base!)}`,
    );
  }
  const plan = await provider.generate({
    prompt,
    ...(baseProject ? { base: baseProject } : {}),
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n${provider.id} -- ${elapsed}s`);
  console.log(`\n${plan.summary}\n`);
  for (const file of plan.files) {
    console.log(
      `  ${file.path.padEnd(40)} ${file.content.split('\n').length} lines`,
    );
  }
  if (usage) {
    console.log(
      `\ntokens over ${steps} steps: ${usage.inputTokens} in / ${usage.outputTokens} out` +
        reasoningNote(usage) +
        (usage.cacheReadInputTokens
          ? ` (${usage.cacheReadInputTokens} cached)`
          : ''),
    );
  }
  printSteps();

  if (baseProject) {
    const diff = diffProjects(baseProject, plan);
    console.log(
      `\nagainst the project it was given: ${diff.kept.length} kept, ` +
        `${diff.changed.length} changed, ${diff.added.length} added, ` +
        `${diff.removed.length} removed`,
    );
    if (diff.removed.length > 0) {
      // Not a warning to skim past. A removed file is a deleted file: the
      // patch named it, and the machine promotes exactly what is left.
      console.log('\nREMOVED -- these files would be deleted:');
      for (const path of diff.removed) console.log(`  ${path}`);
    }
  }

  if (out) {
    const root = resolve(out);
    for (const file of plan.files) {
      // The staged paths are still untrusted here. resolve() collapses any
      // traversal, and anything landing outside the target directory is
      // refused rather than written.
      const target = resolve(join(root, file.path));
      if (target !== root && !target.startsWith(root + '/')) {
        throw new Error(
          `Refusing to write outside the output directory: ${file.path}`,
        );
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }
    console.log(`\nwrote ${plan.files.length} files to ${root}`);
  }
} catch (error) {
  if (error instanceof ProviderError) {
    console.error(`\n${error.name} (${error.stop}): ${error.message}`);
    // A failed run was still billed for every step it made.
    if (usage) {
      console.error(
        `tokens spent over ${steps} steps: ${usage.inputTokens} in / ${usage.outputTokens} out${reasoningNote(usage)}`,
      );
    }
    printSteps();
    process.exit(1);
  }
  throw error;
}
