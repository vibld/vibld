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
