/**
 * The hosts previews, share links and published sites are served under.
 *
 * On Cloudflare that is a domain served over HTTPS, such as
 * `vibld-preview.dev`. Under Docker (docs/decisions.md D126) it is this
 * machine, `localhost:<port>`, served over plain HTTP: browsers send any
 * `*.localhost` name here. These two helpers keep both right in one place.
 */

/** Whether a configured host is this machine, and so served over HTTP. */
export function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '');
  return (
    name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1'
  );
}

/** The origin of `<label>.<host>`: https, except on this machine. */
export function subdomainOrigin(label: string, host: string): string {
  return `${isLocalHost(host) ? 'http' : 'https'}://${label}.${host}`;
}
