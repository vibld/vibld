import type { ModelProvider, ProjectFile } from '@vibld/core';
import { describeFindings } from './design-checks.ts';
import type { DesignReport } from './design-checks.ts';
import { DESIGN_MD_PATH } from './design-spec.ts';

/**
 * What a repair turn asks the model, and what it is allowed to change.
 *
 * Here rather than in the Worker that first used them, because the bakeoff
 * (`packages/eval`) measures how often one repair turn rescues a project
 * that does not build, and that figure is only worth anything if its repair
 * is the product's repair. Two copies of the prompt would be two repairs
 * that drift apart, and the bakeoff would go on reporting a number the
 * product no longer earns.
 */

/**
 * What to ask the model for, when its own project will not build.
 *
 * The compiler's words verbatim and nothing paraphrased: the whole reason
 * this is worth a second call is that the error names the file and the line,
 * and a summary would throw away the part that makes it fixable.
 *
 * Says what not to do as well as what to do. Left to itself a model asked to
 * "fix the build" will happily rewrite the project, and the reader asked for
 * the project, not for a second draft of it.
 */
export function repairPromptFor(
  error: string | undefined,
  design?: DesignReport,
  /** Whether the project is known to build; false when nothing judged it. */
  built = true,
): string {
  const findings = design ? describeFindings(design) : '';
  const parts: string[] = [];
  if (error !== undefined) {
    parts.push(`The project you just wrote does not build. This is the exact output:

${error}`);
  }
  if (findings) {
    parts.push(`${error !== undefined ? 'It also' : built ? 'The project you just wrote builds, but it' : 'The project you just wrote'} does not match its own spec (DESIGN.md) or the rules every page must hold. These checks failed:

${findings}`);
  }
  parts.push(`Fix ${parts.length > 1 ? 'all of it' : 'it'}, and change nothing else. Keep every file that is not implicated, keep
the design, the copy and the structure exactly as they are, and do not rename
or reorganise anything. Change only the files the fix needs: every other file
stays exactly as it is.`);
  return parts.join('\n\n');
}

/**
 * `files` with the design record (`DESIGN.md`) of `original`, so they are
 * checked against the spec `original` was held to. When `original` had
 * none, `files` are checked as they are.
 */
export function withRecordOf(
  original: readonly ProjectFile[],
  files: ProjectFile[],
): ProjectFile[] {
  const record = original.find((file) => file.path === DESIGN_MD_PATH);
  if (!record) return files;
  return [...files.filter((file) => file.path !== DESIGN_MD_PATH), record];
}

/** `provider`, with every plan it returns carrying `original`'s design record. */
export function keepingRecordOf(
  original: readonly ProjectFile[],
  provider: ModelProvider,
): ModelProvider {
  return {
    id: provider.id,
    generate: async (request) => {
      const plan = await provider.generate(request);
      return { ...plan, files: withRecordOf(original, plan.files) };
    },
  };
}
