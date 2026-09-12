import type { ProjectSnapshot, ValidationResult, Validator } from '@vibld/core';
import { findContrastFailures } from '@vibld/ai/contrast';

export interface ValidationLimits {
  maxFiles: number;
  maxFileBytes: number;
  requiredPaths: string[];
}

export const DEFAULT_LIMITS: ValidationLimits = {
  maxFiles: 60,
  maxFileBytes: 128 * 1024,
  requiredPaths: ['package.json', 'index.html', 'src/main.tsx', 'src/App.tsx'],
};

/**
 * Reject a path that is not a canonical, relative, in-root project path.
 *
 * ADR-0007 requires canonical paths and file limits before a staged snapshot
 * can be promoted. Path traversal, absolute paths and Windows drive letters
 * are rejected here rather than at write time.
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

const encoder = new TextEncoder();

/**
 * The stylesheets worth checking for contrast. `src/styles.css` is the one
 * the system prompt names, but a project that split its tokens into a second
 * file should not escape the check for being tidy.
 */
function stylesheets(snapshot: ProjectSnapshot) {
  return snapshot.files.filter((file) => file.path.endsWith('.css'));
}

/**
 * Contrast findings for a staged project, as warnings rather than errors.
 *
 * UX BASELINE has asked for 4.5:1 since it was written and nothing checked
 * it, so the requirement lived only in the prompt: a model that ignored it
 * was never contradicted. This contradicts it.
 *
 * Deliberately not an error. A page whose muted text sits at 4.2:1 is a real
 * defect and still a working project, and failing the run would cost the
 * user the generation and what it cost to produce, to fix something they can
 * see and decide about themselves. The honest thing is to say so and hand it
 * over.
 */
export function contrastWarnings(snapshot: ProjectSnapshot): string[] {
  const warnings: string[] = [];
  for (const file of stylesheets(snapshot)) {
    for (const finding of findContrastFailures(file.content)) {
      warnings.push(
        `${file.path}: ${finding.foreground} (${finding.foregroundValue}) on ${finding.background} (${finding.backgroundValue}) is ${finding.ratio.toFixed(2)}:1, below the 4.5:1 needed for body text`,
      );
    }
  }
  return warnings;
}

export function validateSnapshot(
  snapshot: ProjectSnapshot,
  limits: ValidationLimits = DEFAULT_LIMITS,
): ValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();

  if (snapshot.files.length === 0) {
    errors.push('The staged project contains no files');
  }
  if (snapshot.files.length > limits.maxFiles) {
    errors.push(
      `The staged project has ${snapshot.files.length} files, above the limit of ${limits.maxFiles}`,
    );
  }

  for (const file of snapshot.files) {
    const problem = pathProblem(file.path);
    if (problem) {
      errors.push(problem);
      continue;
    }
    if (seen.has(file.path)) {
      errors.push(`"${file.path}" is staged more than once`);
      continue;
    }
    seen.add(file.path);

    const bytes = encoder.encode(file.content).length;
    if (bytes > limits.maxFileBytes) {
      errors.push(
        `"${file.path}" is ${bytes} bytes, above the limit of ${limits.maxFileBytes}`,
      );
    }
  }

  for (const required of limits.requiredPaths) {
    if (!seen.has(required)) {
      errors.push(`The staged project is missing "${required}"`);
    }
  }

  const warnings = contrastWarnings(snapshot);
  return {
    ok: errors.length === 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function createValidator(
  limits: ValidationLimits = DEFAULT_LIMITS,
): Validator {
  return async (snapshot) => validateSnapshot(snapshot, limits);
}
