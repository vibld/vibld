/**
 * Whether `wrangler secret list --format json`, on stdin, names a secret.
 *
 * Exits 0 when it does, 1 when it does not, and 2 when the list cannot be
 * read. The deploy creates VIBLD_KEY_ENCRYPTION_KEY only on a 1 (D132):
 * creating it again over one that exists would leave every provider key
 * stored under it unreadable, so anything unclear is a 2, never a 1.
 *
 * Dependency-free on purpose: it runs in the deploy before anything is
 * built.
 */

import { pathToFileURL } from 'node:url';

/** 0 named, 1 not named, 2 unreadable. */
export function hasSecret(text, secret) {
  if (!secret) return 2;
  // Wrangler may print lines before the JSON, and one of them may hold a
  // '[' of its own: try each '[' until one starts a list of secrets.
  for (
    let start = text.indexOf('[');
    start >= 0;
    start = text.indexOf('[', start + 1)
  ) {
    let list;
    try {
      list = JSON.parse(text.slice(start));
    } catch {
      continue;
    }
    if (
      !Array.isArray(list) ||
      !list.every((entry) => entry && typeof entry.name === 'string')
    ) {
      continue;
    }
    return list.some((entry) => entry.name === secret) ? 0 : 1;
  }
  return 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.exit(hasSecret(input, process.argv[2]));
  });
}
