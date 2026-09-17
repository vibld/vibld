import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  GATED_METHODS,
  GATED_PATHS,
  UNGATED_PATHS,
  isGated,
} from '../worker/access-gate.ts';

/**
 * The rule that keeps the gate honest.
 *
 * A gate applied inside each handler fails silently: the next endpoint that
 * spends money and forgets the call is open, and nothing says so. This reads
 * the router's own source, takes every route literal it dispatches on, and
 * fails on any that appears in neither list.
 *
 * Adding a route therefore forces a decision about it, and the decision is
 * written down next to a reason rather than implied by an omission.
 */

const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));

async function routedPaths(): Promise<string[]> {
  const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
  return [
    ...new Set(
      [...source.matchAll(/pathname === '(\/api\/[^']+)'/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}

describe('the invite gate', () => {
  it('classifies every route the worker dispatches on', async () => {
    const paths = await routedPaths();
    assert.ok(paths.length > 15, `only found ${paths.length} routes`);

    const unclassified = paths.filter(
      (path) =>
        !GATED_PATHS.includes(path) &&
        !(path in GATED_METHODS) &&
        !(path in UNGATED_PATHS),
    );
    assert.deepEqual(
      unclassified,
      [],
      `these routes are behind no decision at all: ${unclassified.join(', ')}`,
    );
  });

  it('gates everything that spends money or writes somewhere else', async () => {
    // Named individually rather than by prefix. A prefix rule would quietly
    // absorb a future sibling route, which is the failure this file exists
    // to prevent.
    for (const path of [
      '/api/plan',
      '/api/preview',
      '/api/publish',
      '/api/github/push',
      '/api/billing/checkout',
    ]) {
      assert.ok(isGated(path, 'POST'), `${path} is not gated`);
    }
  });

  it('lets a revoked owner stop and withdraw what they already started', async () => {
    // Revocation is not deletion. Starting new work is what an invite buys;
    // stopping a running sandbox, pulling a public link and handing back a
    // repository grant are things the owner must always be able to do, or
    // the gate leaves their sandbox running and their code public with no
    // way to reach either.
    assert.equal(isGated('/api/preview', 'POST'), true, 'start is open');
    assert.equal(isGated('/api/preview', 'DELETE'), false, 'cannot stop it');

    assert.equal(isGated('/api/preview/share', 'POST'), true, 'share is open');
    assert.equal(
      isGated('/api/preview/share', 'DELETE'),
      false,
      'cannot pull the link',
    );
    assert.equal(
      isGated('/api/preview/share', 'GET'),
      false,
      'cannot see what is exposed',
    );

    assert.equal(isGated('/api/github/connect', 'POST'), true);
    assert.equal(
      isGated('/api/github/disconnect', 'POST'),
      false,
      'cannot hand the grant back',
    );
  });

  it('leaves a revoked account able to read what it already did', () => {
    // The balance and the run history are the same argument: somebody who
    // was invited, spent money, and then lost access still gets to see what
    // happened to it. Gating either turns revocation into the record being
    // taken away, and neither read grants or starts anything.
    assert.equal(isGated('/api/billing/status', 'GET'), false);
    assert.equal(isGated('/api/runs', 'GET'), false);
  });

  it('gates every method of a route that only ever starts work', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(isGated('/api/plan', method), true, method);
    }
  });

  it('never lists a route as both gated and ungated', async () => {
    const both = [...GATED_PATHS, ...Object.keys(GATED_METHODS)].filter(
      (path) => path in UNGATED_PATHS,
    );
    assert.deepEqual(both, []);
  });

  it('gives every ungated route a reason', () => {
    // "Why is this open" is the question somebody will ask in six months,
    // and an empty string is how it stops being answerable.
    for (const [path, reason] of Object.entries(UNGATED_PATHS)) {
      assert.ok(reason.trim().length > 10, `${path} has no real reason`);
    }
  });

  it('leaves the webhook open, because Stripe has no invite', () => {
    // Gating it would drop deliveries for uninvited accounts, which is how a
    // payment that succeeded ends up unmirrored.
    assert.equal(isGated('/api/stripe/webhook', 'POST'), false);
  });

  it('leaves the shell able to render its own refusal', () => {
    assert.equal(isGated('/api/config', 'POST'), false);
    assert.equal(isGated('/api/access/status', 'POST'), false);
  });

  it('runs the gate before the router dispatches anything', async () => {
    // The half the route table cannot prove. A complete table is a fact about
    // two lists; whether the router consults it before dispatching is what
    // decides if an uninvited account can spend money.
    //
    // This reads the source rather than driving the Worker, because
    // `worker/index.ts` imports `cloudflare:workers` and cannot be loaded
    // under `node --test` at all. The repository's own answer to that is to
    // split the pure half out (see `generation-run.ts` beside
    // `generation-workflow.ts`), which the router has not had done to it yet.
    // Until it does, this is a structural check and not a behavioural one,
    // and it is worth having precisely because it is the ordering that
    // matters: a gate after the first dispatch is not a gate.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');

    const gate = source.indexOf('if (isGated(pathname, request.method))');
    assert.ok(gate > 0, 'the router does not call the gate at all');

    const firstDispatch = source.indexOf("if (pathname === '/api/");
    assert.ok(firstDispatch > 0, 'no route dispatch found to compare against');

    assert.ok(
      gate < firstDispatch,
      'a route is dispatched before the invite gate runs',
    );
  });

  it('resolves a principal inside the gate, so an uninvited and an unauthenticated caller differ', async () => {
    // Two different problems, and only one of them is the caller's to fix.
    // A gate that refused before identity would answer 403 to somebody who
    // simply has not signed in.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const gate = source.slice(
      source.indexOf('if (isGated(pathname, request.method))'),
      source.indexOf("if (pathname === '/api/"),
    );
    assert.match(gate, /resolvePrincipal/);
    assert.match(gate, /decideAccessFor/);
  });
});

describe('what an ungated route is allowed to do', () => {
  /**
   * The gate exists to stop an uninvited account drawing the sign-up
   * credit. `/api/billing/status` was listed as ungated and described as a
   * read-only balance view, and it called `grantSignupCreditOnce`, so an
   * uninvited account could draw its dollar with one direct request
   * whatever the UI chose to render. The route table was wrong about the
   * route, so a rule that reads the route table would not have caught it.
   *
   * The grant now asks the access question itself, which is what makes the
   * property hold for callers nobody has written yet. This rule guards that
   * arrangement rather than any individual call site: move the check back
   * out to the callers and it fails.
   */
  it('leaves the signup grant to decide access for itself', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'worker', 'signup-credit.ts'),
      'utf8',
    );

    assert.ok(
      source.includes('decideAccessFor'),
      'the signup grant no longer asks whether the account has access',
    );

    const call = source.indexOf('decideAccessFor(');
    const write = source.indexOf('grantAdminCredit(');
    assert.ok(call > 0 && write > 0, 'expected both calls in this module');
    assert.ok(call < write, 'the grant is written before access is decided');
  });
});

describe('what an admin route requires', () => {
  /**
   * The invite panel is the only way anybody is let in, and every one of its
   * routes goes through `requireAdmin`. That check used to require
   * `CLERK_SECRET_KEY`, which buys exactly one thing: turning a typed email
   * into a Clerk user id, which only the two credit routes do. A deployment
   * with a perfectly good admin list and no credit tool therefore answered
   * 503 to every invite request and told the operator the credit tool was
   * missing, which is true and not what they were doing.
   *
   * Read from the source, because `worker/index.ts` imports
   * `cloudflare:workers` and cannot be loaded under `node --test` at all
   * (see the router-ordering rule above for the same constraint).
   */
  it('does not make letting somebody in depend on the credit tool', async () => {
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const start = source.indexOf('function adminConfigured(');
    assert.ok(start > 0, 'no adminConfigured to check');
    const body = source.slice(start, source.indexOf('}', start));

    assert.doesNotMatch(
      body,
      /clerkLookupConfigured/,
      'an invite route needs the admin credit tool configured',
    );
    assert.match(body, /VIBLD_PLATFORM_ADMINS/);
    assert.match(body, /env\.DB/);
  });

  it('tells an admin they are one even where nothing can be generated', async () => {
    // `/api/config` is what the shell asks to decide whether to offer the
    // admin panels, and it used to answer 403 when model generation was
    // unconfigured. The client reads any refusal as "nothing configured,
    // and you are not an admin", so a deployment whose invite routes work
    // perfectly (they need the admin list and D1, neither of which is what
    // generation is missing) showed its admin no way to invite anybody.
    //
    // The endpoint's job is to say what the deployment can do. "It cannot
    // generate" is an answer to that, not a reason to withhold one.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const start = source.indexOf("if (pathname === '/api/config')");
    assert.ok(start > 0, 'no config route');
    const block = source.slice(
      start,
      source.indexOf("if (pathname === '/api/plan')", start),
    );
    // Comments stripped before looking for the refusal, or the sentence
    // explaining why the 403 is gone counts as a 403.
    const code = block
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');

    assert.doesNotMatch(code, /403/, 'the config route refuses again');
    assert.match(code, /isAdmin:/, 'stopped reporting admin membership');

    // Identity first, so the answer is still per-person rather than served
    // to anybody who asks.
    const identified = code.indexOf('resolvePrincipal');
    const configured = code.indexOf('isConfigured(env)');
    assert.ok(identified > 0 && configured > 0);
    assert.ok(identified < configured, 'answers before knowing who asked');
  });

  it('still refuses the credit routes without it', async () => {
    // The requirement did not go away, it moved to the two routes that
    // actually have it. Dropping it entirely would let a credit request
    // reach a Clerk lookup that cannot be made.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
    for (const handler of ['handleAdminUser', 'handleAdminTopup']) {
      const start = source.indexOf(`async function ${handler}(`);
      assert.ok(start > 0, `no ${handler}`);
      const body = source.slice(start, source.indexOf('\n}', start));
      assert.match(body, /creditToolDenial\(env\)/, handler);
    }
  });
});
