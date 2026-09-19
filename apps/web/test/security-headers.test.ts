import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { headersFile } from '@vibld/security-headers';

import { APP_ONLY_HEADERS } from '../src/crawling.ts';

/**
 * That app.vibld.com sends them, from both halves of itself (task #52).
 *
 * The app answers from two places and Cloudflare treats them differently: a
 * `_headers` file covers what the static asset store serves and never what
 * this Worker generates, and `run_worker_first` here is `/api/*` only. So
 * the shell needs the file, the API needs the wrapper, and fixing one half
 * leaves the other sending nothing -- which is where both halves were,
 * checked against the live origin.
 */

const WORKER_INDEX = fileURLToPath(
  new URL('../worker/index.ts', import.meta.url),
);
const HEADERS_FILE = fileURLToPath(
  new URL('../public/_headers', import.meta.url),
);

describe('what the shell sends', () => {
  it('ships the generated file, not a hand-edited one', async () => {
    // Checked in because Cloudflare reads it out of the build output,
    // generated because the Worker sends the same set from the same object.
    // Drift means the shell and the API disagree about a security header,
    // which is a worse state than either of them being absent.
    assert.equal(
      await readFile(HEADERS_FILE, 'utf8'),
      headersFile(APP_ONLY_HEADERS),
      'public/_headers has drifted -- run `pnpm --filter @vibld/web headers`',
    );
  });
});

describe('what the API sends', () => {
  /**
   * Read from the source rather than driven, because `worker/index.ts`
   * imports `cloudflare:workers` and cannot be loaded under `node --test` at
   * all -- the same constraint `access-gate.test.ts` works around for the
   * invite gate, and for the same kind of rule: what matters here is not
   * what one handler returns but that no handler can return without passing
   * through the wrapper.
   *
   * So the assertion is that `fetch` does nothing except delegate. A second
   * statement in it would be a way out that skips the headers, and that is
   * exactly what a later route added in the wrong place would look like.
   */
  it('has one exit, and it is wrapped', async () => {
    const source = await readFile(WORKER_INDEX, 'utf8');
    const body = source.slice(
      source.indexOf(
        '  ): Promise<Response> {',
        source.indexOf('async fetch('),
      ),
    );
    const statements = body
      .slice(body.indexOf('{') + 1, body.indexOf('\n  },'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // `securedApp` rather than `secured`: this host adds an indexing
    // directive the marketing site must not send (#192 review), and the
    // one-statement rule is what stops that being added inline here, where
    // a later route could return around it.
    assert.deepEqual(statements, [
      'return securedApp(await route(request, env, ctx));',
    ]);
  });

  it('routes everything through the function that fetch delegates to', async () => {
    // The other half of the same rule: `route` has to be where the dispatch
    // lives, or the assertion above is satisfied by a `fetch` that delegates
    // to something which does nothing.
    const source = await readFile(WORKER_INDEX, 'utf8');
    const route = source.indexOf('async function route(');
    assert.ok(route > 0, 'fetch delegates to a function that is not here');
    assert.ok(
      source.indexOf("if (pathname === '/api/") > route,
      'a route is dispatched outside the function fetch delegates to',
    );
  });
});
