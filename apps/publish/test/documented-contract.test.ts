import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Whether the README still describes the request bodies this Worker
 * actually accepts.
 *
 * `/internal/*` has no browser in front of it and no schema anybody
 * generates a client from: what an operator or apps/web sends is whatever
 * the README says to send. So when `release` grew a required `by`, the
 * documented `{slug}` became a 400 for anyone following the page, and every
 * check in this repository stayed green, because nothing compared the two.
 *
 * The rule is one direction only. A handler may not require a field the
 * README does not name; the README may name a field the handler treats as
 * optional, which is a description rather than a contradiction.
 */

const README = join(import.meta.dirname, '..', 'README.md');
const WORKER = join(import.meta.dirname, '..', 'worker', 'index.ts');

/** `pathname === '/internal/hold'` ... `return handleHold(` */
function routes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern =
    /pathname === '(\/internal\/[a-z-]+)'[\s\S]{0,120}?return (handle[A-Za-z]+)\(/g;
  for (const match of source.matchAll(pattern)) {
    found.set(match[1], match[2]);
  }
  return found;
}

/** The body of one `async function handleX(...)`, up to the next one. */
function handlerBody(source: string, name: string): string {
  const from = source.indexOf(`async function ${name}(`);
  assert.notEqual(from, -1, `${name} is gone; this test is stale`);
  const next = source.indexOf('\nasync function ', from + 1);
  return source.slice(from, next === -1 ? source.length : next);
}

/** Every field the handler refuses the request without. */
function required(body: string): string[] {
  return [...body.matchAll(/'"([a-zA-Z]+)" is required/g)].map(
    (match) => match[1],
  );
}

/** ``POST /internal/hold` with `{slug, by, reason}`'', across line breaks. */
function documented(readme: string, path: string): string[] | undefined {
  const flat = readme.replace(/\s+/g, ' ');
  const pattern = new RegExp(`\`POST ${path}\` with \`\\{([^}]*)\\}\``);
  const match = pattern.exec(flat);
  return match?.[1].split(',').map((field) => field.trim());
}

describe('the request bodies the README advertises', () => {
  it('names every field the handler requires', async () => {
    const [readme, worker] = await Promise.all([
      readFile(README, 'utf8'),
      readFile(WORKER, 'utf8'),
    ]);
    const found = routes(worker);
    assert.ok(found.size > 0, 'no /internal routes found; this test is stale');

    const wrong: string[] = [];
    for (const [path, handler] of found) {
      const fields = documented(readme, path);
      // A route the README does not give a body for is out of scope here.
      // The rule is about the ones it does describe being right.
      if (fields === undefined) continue;
      for (const field of required(handlerBody(worker, handler))) {
        if (!fields.includes(field)) {
          wrong.push(`${path} requires "${field}", documented as {${fields}}`);
        }
      }
    }

    assert.deepEqual(wrong, []);
  });
});
