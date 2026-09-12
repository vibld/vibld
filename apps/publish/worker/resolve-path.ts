/**
 * Static-hosting path resolution for a published project (ADR-0008's
 * "check static hosting behavior for deep links and missing routes"
 * requirement, applied here at serve time rather than at generation time).
 *
 * Ordered candidates for a request path, most specific first: the literal
 * path, then `path.html` (an extensionless route to a prerendered page),
 * then `path/index.html` (a route that is itself a directory-shaped
 * prerendered page). The public fetch handler serves the first one R2
 * actually has.
 */

export function candidatePaths(requestPath: string): string[] {
  const clean = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (clean === '') return ['index.html'];
  return [clean, `${clean}.html`, `${clean}/index.html`];
}
