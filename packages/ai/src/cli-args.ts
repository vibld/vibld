/**
 * Argument parsing for the CLIs that spend real tokens.
 *
 * In its own module because every run of those CLIs spends money, and a
 * misparsed flag is a wasted generation: a `--base` swallowed into the prompt
 * would quietly run a fresh generation while reporting an iteration.
 *
 * One scanner, two callers. `parseMockupArgs` was very nearly a second copy
 * of the loop below with one name changed, which is the shape of mistake the
 * #189 review kept finding: two places that must agree about where a prompt
 * ends.
 */

export interface PlanArgs {
  prompt: string;
  out?: string;
  base?: string;
}

export interface MockupArgs {
  prompt: string;
  out?: string;
  style?: string;
  /**
   * Override the output ceiling for one run.
   *
   * Exists to measure rather than to configure: `MOCKUP_OUTPUT_TOKENS` was a
   * flat 18,000 chosen from a description of what three sketches ought to
   * be, and the first real run against a model overran it (#190). A number
   * to replace it with should come from watching what a model actually
   * emits, not from a second description.
   */
  maxTokens?: string;
}

/**
 * The prompt is everything before the first flag; the flags are whatever the
 * caller declares. Returns the flag values by name, absent where unset, so a
 * caller can tell `--out` given empty from `--out` not given at all.
 */
function parse(
  argv: string[],
  flags: readonly string[],
): { prompt: string; values: Record<string, string | undefined> } {
  const values: Record<string, string | undefined> = {};
  let promptEnd = argv.length;
  for (const name of flags) {
    const at = argv.indexOf(name);
    if (at === -1) continue;
    values[name] = argv[at + 1];
    promptEnd = Math.min(promptEnd, at);
  }
  return { prompt: argv.slice(0, promptEnd).join(' ').trim(), values };
}

export function parsePlanArgs(argv: string[]): PlanArgs {
  const { prompt, values } = parse(argv, ['--out', '--base']);
  return {
    prompt,
    ...(values['--out'] === undefined ? {} : { out: values['--out'] }),
    ...(values['--base'] === undefined ? {} : { base: values['--base'] }),
  };
}

export function parseMockupArgs(argv: string[]): MockupArgs {
  const { prompt, values } = parse(argv, ['--out', '--style', '--max-tokens']);
  return {
    prompt,
    ...(values['--out'] === undefined ? {} : { out: values['--out'] }),
    ...(values['--style'] === undefined ? {} : { style: values['--style'] }),
    ...(values['--max-tokens'] === undefined
      ? {}
      : { maxTokens: values['--max-tokens'] }),
  };
}
