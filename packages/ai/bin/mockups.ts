/**
 * Run one real mockup set and print what came back.
 *
 * This exists because #189 shipped the feature with no real-model evidence
 * at all. Every test of `/api/mockups`, of `MockupProvider` and of the
 * routes around them uses a fake client, and that gap is not hypothetical:
 * it is exactly why the sixth review round found that every client
 * hard-coded the *plan's* schema, so a mockup run could not succeed on
 * Anthropic or OpenAI and was being argued with on DeepSeek. Five rounds of
 * review passed over it, because the one thing never exercised was whether
 * a real client asks for what the provider is about to validate.
 *
 * So the point of this CLI is the round trip, not the output: a real client,
 * asked for `MOCKUP_OUTPUT`, returning something `MockupSetSchema` accepts.
 *
 *   DEEPSEEK_API_KEY=... pnpm --filter @vibld/ai mockups "a bakery"
 *
 * `--style <preset>` sends a chosen direction, the way the builder does once
 * somebody has picked one. `--out <dir>` writes the three documents so they
 * can be opened; without it this is a dry read.
 *
 * About a tenth of a build (#185): roughly 18,000 tokens against 252,000.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MockupProvider } from '../src/mockup-provider.ts';
import { createPlanClient, resolveModel } from '../src/select-client.ts';
import { ProviderError } from '../src/errors.ts';
import { parseMockupArgs } from '../src/cli-args.ts';
import { STYLE_PRESETS, isStylePresetId } from '../src/style-presets.ts';
import type { PlanUsage } from '../src/client.ts';

const { prompt, out, style } = parseMockupArgs(process.argv.slice(2));

if (!prompt) {
  console.error(
    'Usage: pnpm --filter @vibld/ai mockups "<prompt>" [--out <dir>] [--style <preset>]',
  );
  process.exit(2);
}

// Checked before the request rather than after it. An unknown preset is a
// typo, and finding out from the reply costs a run.
if (style !== undefined && !isStylePresetId(style)) {
  console.error(`"${style}" is not a style preset. One of:`);
  for (const preset of STYLE_PRESETS) console.error(`  ${preset.id}`);
  process.exit(2);
}

let usage: PlanUsage | undefined;
let progressChars = 0;
let sentChars: number | undefined;

const model = resolveModel(process.env);
const provider = new MockupProvider(createPlanClient(process.env, model), {
  model,
  ...(style ? { style } : {}),
  onUsage: (reported) => {
    usage = reported;
  },
  onProgress: ({ characters }) => {
    progressChars = characters;
  },
  onPromptChars: (characters) => {
    sentChars = characters;
  },
});

try {
  const startedAt = Date.now();
  const set = await provider.generate({ prompt });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n${provider.id} -- ${elapsed}s`);
  if (style) console.log(`style: ${style}`);

  for (const [index, mockup] of set.mockups.entries()) {
    console.log(`\n${index + 1}. ${mockup.label}`);
    console.log(`   ${mockup.rationale}`);
    console.log(`   ${mockup.html.length} characters of HTML`);
  }

  // Reported rather than assumed, and each of these is a claim some earlier
  // version of this feature made without the code behind it (#189 review).
  if (sentChars !== undefined) {
    console.log(`\nprompt actually sent: ${sentChars} characters`);
  }
  if (progressChars > 0) {
    console.log(`progress reported: ${progressChars} characters streamed`);
  }
  if (usage) {
    console.log(
      `tokens: ${usage.inputTokens} in / ${usage.outputTokens} out` +
        (usage.cacheReadInputTokens
          ? ` (${usage.cacheReadInputTokens} cached)`
          : ''),
    );
  }

  if (out) {
    const root = resolve(out);
    await mkdir(root, { recursive: true });
    for (const [index, mockup] of set.mockups.entries()) {
      // The label is model output. It names the file, so it is reduced to
      // something that cannot leave the directory rather than trusted.
      const slug =
        mockup.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'direction';
      const target = join(root, `${index + 1}-${slug}.html`);
      await writeFile(target, mockup.html, 'utf8');
      console.log(`wrote ${target}`);
    }
  }
} catch (error) {
  if (error instanceof ProviderError) {
    console.error(`\n${error.name}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
