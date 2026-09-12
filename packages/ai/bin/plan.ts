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
 * With --base <dir> the request carries an existing project, which is the
 * only way to exercise iteration against a real model. It prints what the
 * follow-up did to the project it was given -- and specifically what it
 * removed, because the generation machine replaces the file set with
 * whatever comes back, so a file the model leaves out is deleted.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PlanProvider } from '../src/plan-provider.ts';
import { createPlanClient, resolveModel } from '../src/select-client.ts';
import { ProviderError } from '../src/errors.ts';
import { parsePlanArgs } from '../src/cli-args.ts';
import { diffProjects, readProject } from '../src/read-project.ts';
import type { PlanUsage } from '../src/client.ts';

const { prompt, out, base } = parsePlanArgs(process.argv.slice(2));

if (!prompt) {
  console.error(
    'Usage: pnpm --filter @vibld/ai plan "<prompt>" [--out <dir>] [--base <dir>]',
  );
  process.exit(2);
}

let usage: PlanUsage | undefined;
// Which service answers is configuration, not a constant: VIBLD_PROVIDER
// picks, or the single key that is set does. An unset VIBLD_MODEL falls back
// to the chosen provider's own model, never the other one's.
const provider = new PlanProvider(createPlanClient(process.env), {
  model: resolveModel(process.env),
  onUsage: (reported) => {
    usage = reported;
  },
});

try {
  const startedAt = Date.now();
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
      `\ntokens: ${usage.inputTokens} in / ${usage.outputTokens} out` +
        (usage.cacheReadInputTokens
          ? ` (${usage.cacheReadInputTokens} cached)`
          : ''),
    );
  }

  if (baseProject) {
    const diff = diffProjects(baseProject, plan);
    console.log(
      `\nagainst the project it was given: ${diff.kept.length} kept, ` +
        `${diff.changed.length} changed, ${diff.added.length} added, ` +
        `${diff.removed.length} removed`,
    );
    if (diff.removed.length > 0) {
      // Not a warning to skim past. A removed file is a deleted file: the
      // machine promotes exactly the set the model returned.
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
    console.error(`\n${error.name}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
