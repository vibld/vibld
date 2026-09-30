/**
 * Argument parsing for the CLIs that spend real tokens.
 *
 * In its own module because every run of those CLIs spends money, and a
 * misparsed flag is a wasted generation: a `--base` swallowed into the prompt
 * would quietly run a fresh generation while reporting an iteration.
 *
 * One scanner, two callers. `parseMockupArgs` was very nearly a second copy
 * of the loop below with one name changed, which is the shape of mistake the
 * internal PR 189 review kept finding: two places that must agree about where a prompt
 * ends.
 */

export interface PlanArgs {
  prompt: string;
  out?: string;
  base?: string;
  /**
   * A style preset id, as the builder sends one. Checked against the
   * catalogue by the caller, so a mistyped id is refused rather than
   * quietly building unstyled.
   */
  style?: string;
  /**
   * Install and build what was written, and when it does not build, ask
   * for one repair with the compiler's output, as the hosted builder does.
   * Needs `out`.
   */
  build?: boolean;
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
   * be, and the first real run against a model overran it (internal PR 190). A number
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

const PLAN_FLAGS = ['--out', '--base', '--style'] as const;

export function parsePlanArgs(argv: string[]): PlanArgs {
  // `--build` takes no value, so it is read on its own and the valued flags
  // from what is left. The prompt still ends at the first flag of either
  // kind: everything before `--build`, parsed, ends at whichever came first.
  const at = argv.indexOf('--build');
  const rest = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 1)];
  const { values } = parse(rest, PLAN_FLAGS);
  const { prompt } = parse(at === -1 ? argv : argv.slice(0, at), PLAN_FLAGS);
  return {
    prompt,
    ...(at === -1 ? {} : { build: true }),
    ...(values['--out'] === undefined ? {} : { out: values['--out'] }),
    ...(values['--base'] === undefined ? {} : { base: values['--base'] }),
    ...(values['--style'] === undefined ? {} : { style: values['--style'] }),
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

/**
 * A variable's name that says it holds a credential: an API key, a token, a
 * secret or a password, under any provider's prefix.
 */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/i;

/**
 * The environment `--build` gives `npm install` and `npm run build`: the
 * caller's own, less every variable named as a credential.
 *
 * The project being built was written by a model, and so were its
 * dependencies and its build config; either can run code, and the
 * provider key that paid for the generation is in the CLI's environment.
 * Nothing a build of a generated site does needs that key, so it is not
 * passed on.
 */
export function buildEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || SECRET_NAME.test(name)) continue;
    kept[name] = value;
  }
  return kept;
}
