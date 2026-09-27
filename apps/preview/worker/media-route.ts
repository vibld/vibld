import { isMediaPath } from '@vibld/core';

/**
 * Which preview a `/media/<name>` request is for, read from its hostname.
 *
 * The same parse `@cloudflare/sandbox`'s `proxyToSandbox` does (it does
 * not export it): `{port}-{sandboxId}-{token}.{domain}`, split at the first
 * hyphen for the port and the last for the token, because sandbox ids may
 * contain hyphens and tokens may not. Nothing here is trusted. The token
 * is checked by the sandbox itself (`validatePortToken`) before a byte is
 * served, exactly as it is for every other request to the preview.
 *
 * `null` for anything that is not a media request to a preview URL, which
 * then goes on to `proxyToSandbox` as before.
 */
export function previewMediaRoute(
  url: URL,
): { port: number; sandboxId: string; token: string; path: string } | null {
  const path = url.pathname.replace(/^\/+/, '');
  if (!isMediaPath(path)) return null;

  const dot = url.hostname.indexOf('.');
  if (dot === -1) return null;
  const subdomain = url.hostname.slice(0, dot);
  const firstHyphen = subdomain.indexOf('-');
  if (firstHyphen === -1) return null;
  const portText = subdomain.slice(0, firstHyphen);
  if (!/^\d{4,5}$/.test(portText)) return null;
  const rest = subdomain.slice(firstHyphen + 1);
  const lastHyphen = rest.lastIndexOf('-');
  if (lastHyphen === -1) return null;
  const sandboxId = rest.slice(0, lastHyphen);
  const token = rest.slice(lastHyphen + 1);
  if (!/^[a-z0-9_]{1,63}$/.test(token)) return null;
  if (sandboxId.length === 0 || sandboxId.length > 63) return null;
  if (!/^[a-z0-9-]+$/.test(sandboxId)) return null;
  return { port: Number(portText), sandboxId, token, path };
}
