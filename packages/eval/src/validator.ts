import type { ProjectSnapshot, ValidationResult, Validator } from '@vibld/core';
import { checkPortability } from './portability.ts';

/**
 * Reject a path that is not a canonical, relative, in-root project path.
 *
 * Duplicated rather than imported: the builder shell owns the copy the product
 * uses, and it lives in an application rather than a library. When it moves
 * into @vibld/core this should import that one instead of keeping a second
 * copy in step by hand.
 */
export function pathProblem(path: string): string | undefined {
  if (path.length === 0) return 'A staged file has an empty path';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return `"${path}" must be a relative path`;
  }
  if (path.includes('\\')) return `"${path}" must use forward slashes`;
  if (path.includes('\0')) return `"${path}" contains an invalid character`;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..')) {
    return `"${path}" escapes the project root`;
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return `"${path}" is not a canonical path`;
  }
  return undefined;
}

/**
 * The bar a generated project must clear to be accepted here: safe to write,
 * and independent enough to hand to someone else. A run that produces an
 * unportable project has not succeeded, whatever it managed to render.
 */
export function createEvalValidator(): Validator {
  return async (snapshot: ProjectSnapshot): Promise<ValidationResult> => {
    const errors: string[] = [];
    const seen = new Set<string>();

    if (snapshot.files.length === 0) {
      errors.push('The staged project contains no files');
    }

    for (const file of snapshot.files) {
      const problem = pathProblem(file.path);
      if (problem) errors.push(problem);
      if (seen.has(file.path)) {
        errors.push(`"${file.path}" is staged more than once`);
      }
      seen.add(file.path);
    }

    for (const problem of checkPortability(snapshot)) {
      errors.push(`${problem.check}: ${problem.detail}`);
    }

    return errors.length === 0
      ? { ok: true, errors: [] }
      : { ok: false, errors };
  };
}
