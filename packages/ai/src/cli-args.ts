/**
 * Argument parsing for the plan CLI.
 *
 * In its own module because every run of that CLI spends real tokens, and a
 * misparsed flag is a wasted generation: a `--base` swallowed into the prompt
 * would quietly run a fresh generation while reporting an iteration.
 */

export interface PlanArgs {
  prompt: string;
  out?: string;
  base?: string;
}

const FLAGS = ['--out', '--base'] as const;

export function parsePlanArgs(argv: string[]): PlanArgs {
  const values: Record<string, string | undefined> = {};
  // The prompt is everything before the first flag, whichever comes first.
  let promptEnd = argv.length;
  for (const name of FLAGS) {
    const at = argv.indexOf(name);
    if (at === -1) continue;
    values[name] = argv[at + 1];
    promptEnd = Math.min(promptEnd, at);
  }
  return {
    prompt: argv.slice(0, promptEnd).join(' ').trim(),
    ...(values['--out'] === undefined ? {} : { out: values['--out'] }),
    ...(values['--base'] === undefined ? {} : { base: values['--base'] }),
  };
}
