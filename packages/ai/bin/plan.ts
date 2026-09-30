/**
 * Run one real generation from a checkout and print the result, with one
 * provider key and nothing else: no account, database or Cloudflare. CI and
 * the test suite use the deterministic fake; this calls the model.
 *
 *   ANTHROPIC_API_KEY=... pnpm generate "a landing page for ..." --out ./site
 *
 * (`pnpm generate` at the root is `pnpm --filter @vibld/ai plan`.)
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
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BoundedPlanProvider } from '../src/bounded-build.ts';
import { createPlanClient, resolveModel } from '../src/select-client.ts';
import { ProviderError } from '../src/errors.ts';
import { checkDesign } from '../src/design-checks.ts';
import { keepingRecordOf, repairPromptFor } from '../src/repair.ts';
import { buildEnvironment, parsePlanArgs } from '../src/cli-args.ts';
import { isStylePresetId } from '../src/style-presets.ts';
import { diffProjects, readProject } from '../src/read-project.ts';
import type { PlanUsage } from '../src/client.ts';
import type { ProjectFile, RunStepTrace } from '@vibld/core';

const args = parsePlanArgs(process.argv.slice(2));
const { prompt, style } = args;

// Relative paths are read from the checkout's root, not from packages/ai.
// pnpm runs this script in packages/ai whether it was started as `pnpm
// generate` or as `pnpm --filter @vibld/ai plan`, so `--out ./my-site` used
// to land in packages/ai/my-site. pnpm puts the workspace root in INIT_CWD
// (measured: started from docs/, it names the root); run directly with
// node, there is none and the working directory is used.
const startedIn = process.env.INIT_CWD || process.cwd();
const out = args.out === undefined ? undefined : resolve(startedIn, args.out);
const base =
  args.base === undefined ? undefined : resolve(startedIn, args.base);

if (!prompt) {
  console.error(
    'Usage: pnpm generate "<prompt>" [--out <dir>] [--build] [--base <dir>] [--style <preset id>]',
  );
  process.exit(2);
}
if (args.build && !out) {
  console.error(
    '--build installs and builds what --out wrote, so it needs --out.',
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
const client = createPlanClient(process.env, model);
const provider = new BoundedPlanProvider(client, {
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
      `editing ${baseProject.files.length} existing files from ${base}`,
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
    await writeProject(out, plan.files);
    console.log(`\nwrote ${plan.files.length} files to ${out}`);
    if (args.build) {
      const built = await buildAndRepair(out, plan.files);
      if (!built) process.exit(1);
    }
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

/**
 * `files` written under `root`, and any file of `previous` that `files` no
 * longer has removed, so the directory holds exactly the project.
 */
async function writeProject(
  root: string,
  files: readonly ProjectFile[],
  previous: readonly ProjectFile[] = [],
): Promise<void> {
  const inside = (path: string): string => {
    // The staged paths are still untrusted here. resolve() collapses any
    // traversal, and anything landing outside the target directory is
    // refused rather than written.
    const target = resolve(join(root, path));
    if (target !== root && !target.startsWith(root + '/')) {
      throw new Error(
        `Refusing to write outside the output directory: ${path}`,
      );
    }
    return target;
  };
  const kept = new Set(files.map((file) => file.path));
  for (const file of previous) {
    if (!kept.has(file.path)) await rm(inside(file.path), { force: true });
  }
  for (const file of files) {
    const target = inside(file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

/** The most of a failed build's output a repair is shown: its end. */
const BUILD_OUTPUT_CHARS = 12_000;

/**
 * `npm install` then `npm run build` in `root`, with their output, and with
 * no credential in their environment (`buildEnvironment`).
 */
function build(root: string): { ok: boolean; output: string } {
  const env = buildEnvironment(process.env);
  let output = '';
  for (const step of [
    ['install', '--no-audit', '--no-fund'],
    ['run', 'build'],
  ]) {
    const run = spawnSync('npm', step, { cwd: root, encoding: 'utf8', env });
    output += `$ npm ${step.join(' ')}\n${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.status !== 0) return { ok: false, output };
  }
  return { ok: true, output };
}

/**
 * What the hosted builder does after a build (internal issue 194): install and build the
 * project, and when it does not build, ask once for a repair with the
 * compiler's words and the design checks' findings, then build again. The
 * repair keeps the project's spec and is the product's own
 * (`repairPromptFor`, `keepingRecordOf`). Resolves true when the project
 * builds, first time or after the repair.
 */
async function buildAndRepair(
  root: string,
  files: readonly ProjectFile[],
): Promise<boolean> {
  console.log(`\nbuilding ${root} with npm`);
  const first = build(root);
  if (first.ok) {
    console.log('built: the project installs and builds with plain npm');
    return true;
  }
  const error = first.output.slice(-BUILD_OUTPUT_CHARS);
  console.log(
    `\nthe build failed:\n${error.split('\n').slice(-25).join('\n')}`,
  );
  console.log('\nasking for one repair with the compiler output');

  const repairStartedAt = Date.now();
  let repairUsage: PlanUsage | undefined;
  const repairer = keepingRecordOf(
    files,
    new BoundedPlanProvider(client, {
      model,
      keepSpec: true,
      ...(style !== undefined && isStylePresetId(style) ? { style } : {}),
      onUsage: (reported) => {
        repairUsage = reported;
      },
      onStep: (label) => {
        const at = ((Date.now() - repairStartedAt) / 1000)
          .toFixed(0)
          .padStart(4);
        console.log(`[${at}s] repair: ${label}`);
      },
    }),
  );
  const repaired = await repairer.generate({
    prompt: repairPromptFor(error, checkDesign([...files]), false),
    base: { revision: 'r-generated', files: [...files] },
  });
  if (repairUsage) {
    console.log(
      `repair tokens: ${repairUsage.inputTokens} in / ${repairUsage.outputTokens} out` +
        reasoningNote(repairUsage),
    );
  }
  await writeProject(root, repaired.files, files);
  console.log(`rewrote the project: ${repaired.files.length} files`);

  const second = build(root);
  if (second.ok) {
    console.log(
      'built after one repair: the project installs and builds with plain npm',
    );
    return true;
  }
  console.error(
    `\nstill does not build after one repair:\n${second.output.slice(-BUILD_OUTPUT_CHARS).split('\n').slice(-25).join('\n')}`,
  );
  return false;
}
