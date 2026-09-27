#!/usr/bin/env node
/**
 * Print one `vars` entry from wrangler.jsonc.
 *
 * The deploy workflow reads `VIBLD_PROVIDER` from here to decide which model
 * key must exist before it will deploy. Two things it deliberately is not:
 * a grep, which would also match a commented-out entry; and a Node one-liner
 * inlined in YAML, where `$1` in the regex is in reach of the shell and gets
 * expanded before Node ever sees it.
 *
 * Usage: node --experimental-strip-types apps/web/scripts/wrangler-var.ts VIBLD_PROVIDER [fallback]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** wrangler.jsonc is JSON with comments and trailing commas. */
export function readConfig(raw: string): {
  vars?: Record<string, string>;
  ratelimits?: { name: string; namespace_id: string }[];
  durable_objects?: { bindings?: { name: string; class_name: string }[] };
  migrations?: { tag: string; new_sqlite_classes?: string[] }[];
} {
  const stripped = raw
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

export function readVars(raw: string): Record<string, string> {
  return readConfig(raw).vars ?? {};
}

/** Only when run directly: importing this for `readVars` must not exit. */
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [name, fallback = ''] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: wrangler-var.ts <NAME> [fallback]');
    process.exit(2);
  }
  const vars = readVars(
    readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8'),
  );
  process.stdout.write(String(vars[name] ?? fallback));
}
