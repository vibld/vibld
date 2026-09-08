/**
 * Run one real generation and print the result. Nothing else in the repo makes
 * a live model call: CI, the builder shell and the test suite all use the
 * deterministic fake.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @vibld/ai plan "a landing page for ..."
 *
 * Writes the generated project to disk only when --out is given, so the
 * default is a dry read of what the model produced.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AnthropicModelProvider } from '../src/anthropic-provider.ts';
import { createAnthropicPlanClient } from '../src/anthropic-client.ts';
import { ProviderError } from '../src/errors.ts';
import type { PlanUsage } from '../src/client.ts';

function parseArgs(argv: string[]): { prompt: string; out?: string } {
  const out = argv.indexOf('--out');
  if (out === -1) return { prompt: argv.join(' ').trim() };
  return {
    prompt: argv.slice(0, out).join(' ').trim(),
    out: argv[out + 1],
  };
}

const { prompt, out } = parseArgs(process.argv.slice(2));

if (!prompt) {
  console.error('Usage: pnpm --filter @vibld/ai plan "<prompt>" [--out <dir>]');
  process.exit(2);
}

let usage: PlanUsage | undefined;
const provider = new AnthropicModelProvider(createAnthropicPlanClient(), {
  onUsage: (reported) => {
    usage = reported;
  },
});

try {
  const startedAt = Date.now();
  const plan = await provider.generate({ prompt });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n${provider.id} — ${elapsed}s`);
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
