/**
 * The repository name "Create a new repository" suggests for a project
 * (D72): the project's name, made into something GitHub accepts.
 *
 * Lower case, runs of anything GitHub would not keep collapsed to one
 * hyphen, no hyphen or dot at either end, and at most 100 characters,
 * which is GitHub's own limit. A name with nothing usable in it (all
 * punctuation, or a script GitHub does not allow in a name) falls back to
 * a fixed one rather than to nothing, because an empty field is not a
 * suggestion.
 *
 * Only a suggestion: the field is editable, and the Worker checks whatever
 * is sent with its own rule (`repositoryNameProblem`) before GitHub sees it.
 */
export const FALLBACK_REPOSITORY_NAME = 'vibld-project';

export function repositoryNameFor(projectName: string): string {
  const slug = projectName
    .normalize('NFKD')
    // Accents come apart from their letters under NFKD; the marks go and
    // the letters stay, so "Café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
    .replace(/[-.]+$/g, '');
  return slug || FALLBACK_REPOSITORY_NAME;
}
