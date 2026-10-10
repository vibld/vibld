/**
 * Which requests on the preview domain belong to a published site.
 *
 * Published sites live one label under the preview domain,
 * `<slug>.vibld-preview.dev`, because Cloudflare's free Universal SSL
 * certificate covers the zone apex and one level of subdomain only: the
 * earlier `<slug>.published.vibld-preview.dev` could not get a certificate
 * without the paid Advanced Certificate Manager. This Worker owns the
 * zone's one wildcard route, so it hands every host that is not its own to
 * apps/publish over the `PUBLISH` service binding.
 *
 * Its own hosts are the ones it gives meaning to: `share`, a share origin
 * (`sh-<uuid>`, share-route.ts), and a sandbox preview
 * (`{port}-{sandboxId}-{token}`, minted by `exposePort` with a 4-5 digit
 * port first). apps/publish refuses a slug in any of those shapes
 * (apps/publish/worker/slug.ts), so no published site can be shadowed by a
 * preview, and no preview can be taken by a published site.
 *
 * Pure: `index.ts` does the forwarding.
 */
export function isPublishedHost(
  hostname: string,
  previewHostname: string | undefined,
): boolean {
  if (!previewHostname) return false;
  const suffix = `.${previewHostname}`;
  if (!hostname.endsWith(suffix)) return false;
  const label = hostname.slice(0, -suffix.length);
  if (label === '' || label.includes('.')) return false;
  if (label === 'share' || label.startsWith('sh-')) return false;
  return !/^\d{4,5}-/.test(label);
}

/**
 * A host that is not the preview domain's at all: an owner's own domain,
 * connected to their published site through Cloudflare for SaaS (D189).
 * Such a request only reaches this Worker once Cloudflare has activated
 * the domain as a custom hostname on the zone, and only through the
 * zone's catch-all route; apps/publish then finds the site by hostname.
 *
 * Off unless `customHostnames` is set, because elsewhere the hosts this
 * Worker sees that are not the preview domain's are its own (Docker's
 * service name, `internal.invalid` over a service binding), and those
 * must keep reaching `/internal/` here rather than a published site.
 */
export function isCustomHost(
  hostname: string,
  previewHostname: string | undefined,
  customHostnames: string | undefined,
): boolean {
  if (customHostnames !== 'on' || !previewHostname) return false;
  const host = hostname.toLowerCase();
  if (host === previewHostname || host.endsWith(`.${previewHostname}`)) {
    return false;
  }
  return host !== 'internal.invalid' && !host.includes(':');
}
