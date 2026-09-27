/**
 * Slug validation for the Cloudflare auto-publish primary path (ADR-0010).
 *
 * A slug becomes `<slug>.vibld-preview.dev` -- a DNS label, not a
 * free-text name -- so it is checked against DNS label rules (RFC 1035,
 * lowercase since DNS is case-insensitive but a mixed-case slug would be
 * confusing to type) plus a short reserved list so a published project can
 * never claim a hostname this Worker or a neighboring one already gives
 * meaning to.
 */

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * `share` is apps/preview's own reserved label on the neighboring
 * `vibld-preview.dev` zone (share-token.ts) -- reserved here too in case
 * the two Workers ever end up sharing a route. `www`/`api`/`admin`/
 * `internal`/`status` are reserved on general precedent: a published
 * project's slug should never be mistaken for Vibld's own infrastructure.
 */
const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'admin',
  'internal',
  'status',
  'share',
  'published',
]);

/**
 * The shapes apps/preview answers itself on the same domain: a sandbox
 * preview, `{port}-{sandboxId}-{token}` with a 4-5 digit port first, and a
 * share origin, `sh-<uuid>`. apps/preview hands a host to this Worker only
 * when it is neither (apps/preview/worker/publish-route.ts), so a slug in
 * either shape could never be reached.
 */
export function isPreviewShaped(slug: string): boolean {
  return /^\d{4,5}-/.test(slug) || slug.startsWith('sh-');
}

export function isValidSlug(slug: string): boolean {
  return (
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug) &&
    !isPreviewShaped(slug)
  );
}
