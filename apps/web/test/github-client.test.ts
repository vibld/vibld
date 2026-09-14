import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  beginConnect,
  bindRepository,
  claimHandoff,
  clearHandoff,
  completeClaimedConnect,
  completeConnect,
  forgetHandoffClaim,
  fetchGitHubStatus,
  readHandoff,
  rememberState,
  takeRememberedState,
} from '../src/github/github-client.ts';

/** A `sessionStorage` that behaves, for the cases where it does. */
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
}

/** One that refuses, as a private window or blocked site data does. */
function hostileStorage(): Storage {
  return {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
    clear() {},
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TOKEN = async () => 'clerk-token';

describe('reading what GitHub put on the URL', () => {
  it('reads the code, state and installation out of the fragment', () => {
    assert.deepEqual(
      readHandoff('#github=the-code&state=the-state&installation=42'),
      { code: 'the-code', state: 'the-state', installation: '42' },
    );
  });

  it('works without an installation', () => {
    assert.deepEqual(readHandoff('#github=c&state=s'), {
      code: 'c',
      state: 's',
    });
  });

  it('is nothing when the fragment is not a return from GitHub', () => {
    for (const hash of ['', '#', '#something=else', '#state=only']) {
      assert.equal(readHandoff(hash), null);
    }
  });

  it('is nothing when the callback reported an incomplete link', () => {
    assert.equal(readHandoff('#github=incomplete'), null);
  });
});

/**
 * The defence that only exists here.
 *
 * Completing the exchange from the app is what makes the callback reachable
 * at all, and it opens a door the server cannot close by itself: a crafted
 * link can hand somebody else's `code` to a signed-in user, and completing
 * it would offer them a stranger's repositories to push their own work into.
 * The browser refusing a `state` it never issued is the whole of the fix.
 */
describe('refusing a connection this browser did not start', () => {
  const HANDOFF = { code: 'the-code', state: 'the-state' };

  it('completes one it did start', async () => {
    const store = storage();
    rememberState('the-state', store);
    const result = await completeConnect(
      HANDOFF,
      (async () =>
        json({ repositories: [], ticket: 'tkt' })) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, true);
  });

  it('refuses one carrying a state it never issued', async () => {
    const store = storage();
    rememberState('the-state-we-issued', store);
    let called = false;
    const result = await completeConnect(
      { code: 'somebody-elses-code', state: 'their-state' },
      (async () => {
        called = true;
        return json({ repositories: [], ticket: 'tkt' });
      }) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, false);
    assert.equal(called, false, 'the code was sent anyway');
  });

  it('refuses when nothing was remembered at all', async () => {
    let called = false;
    const result = await completeConnect(
      HANDOFF,
      (async () => {
        called = true;
        return json({ repositories: [], ticket: 'tkt' });
      }) as unknown as typeof fetch,
      TOKEN,
      storage(),
    );
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  it('refuses rather than proceeding when storage is blocked', async () => {
    // A private window must fail closed. Treating "cannot remember" as
    // "nothing to check" would turn the defence off exactly where it is
    // hardest to notice.
    const store = hostileStorage();
    rememberState('the-state', store);
    let called = false;
    const result = await completeConnect(
      HANDOFF,
      (async () => {
        called = true;
        return json({ repositories: [], ticket: 'tkt' });
      }) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  it('spends the remembered state, so a second link cannot reuse it', async () => {
    const store = storage();
    rememberState('the-state', store);
    assert.equal(takeRememberedState(store), 'the-state');
    assert.equal(takeRememberedState(store), null);
  });

  it('does not leave the state behind after completing', async () => {
    const store = storage();
    rememberState('the-state', store);
    await completeConnect(
      HANDOFF,
      (async () =>
        json({ repositories: [], ticket: 'tkt' })) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(takeRememberedState(store), null);
  });
});

describe('starting a connection', () => {
  it('remembers the state before handing back where to go', async () => {
    const store = storage();
    const result = await beginConnect(
      (async () =>
        json({
          url: 'https://github.com/x',
          state: 'issued',
        })) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, true);
    // Stored before the caller navigates, because a state stored after the
    // browser leaves is never stored at all.
    assert.equal(takeRememberedState(store), 'issued');
  });

  it('reports a deployment that cannot connect', async () => {
    const result = await beginConnect(
      (async () =>
        json(
          { error: 'Connecting a GitHub repository is not configured here.' },
          503,
        )) as unknown as typeof fetch,
      TOKEN,
      storage(),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not configured/);
  });

  it('does not remember anything when the call fails', async () => {
    const store = storage();
    await beginConnect(
      (async () => json({ error: 'nope' }, 500)) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(takeRememberedState(store), null);
  });
});

describe('carrying the server’s answer back to the person', () => {
  it('keeps the install flag so the panel can say what to do', async () => {
    const store = storage();
    rememberState('s', store);
    const result = await completeConnect(
      { code: 'c', state: 's' },
      (async () =>
        json(
          { error: 'Not installed anywhere.', install: true },
          409,
        )) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.install, true);
      assert.match(result.error, /Not installed/);
    }
  });

  it('passes a policy refusal through without inventing a remedy', async () => {
    const store = storage();
    rememberState('s', store);
    const result = await completeConnect(
      { code: 'c', state: 's' },
      (async () =>
        json(
          {
            error:
              'GitHub refused access to that installation. Check your organisation settings, then try again.',
          },
          409,
        )) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.install, undefined);
      assert.match(result.error, /organisation settings/);
    }
  });
});

describe('binding the chosen repository', () => {
  it('sends the ticket with the choice', async () => {
    const sent: unknown[] = [];
    const result = await bindRepository(
      'the-ticket',
      { owner: 'acme', repo: 'site' },
      (async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return json({ owner: 'acme', repo: 'site' });
      }) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(sent[0], {
      ticket: 'the-ticket',
      owner: 'acme',
      repo: 'site',
    });
  });

  it('surfaces the server’s sentence when it refuses', async () => {
    const result = await bindRepository(
      'stale',
      { owner: 'acme', repo: 'site' },
      (async () =>
        json(
          { error: 'That connection attempt has expired. Start again.' },
          400,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /expired/);
  });
});

describe('the status the panel reads', () => {
  it('passes the two capabilities through', async () => {
    const status = await fetchGitHubStatus(
      (async () =>
        json({
          configured: true,
          canPush: true,
          canConnect: false,
        })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(status?.canPush, true);
    assert.equal(status?.canConnect, false);
  });

  it('is nothing rather than an error when it cannot be read', async () => {
    // Nobody asked for this, so a panel that renders nothing is the right
    // outcome, the same rule `fetchBillingStatus` follows.
    const status = await fetchGitHubStatus(
      (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(status, null);
  });
});

describe('taking the handoff off the URL', () => {
  it('does not throw where there is no history to rewrite', () => {
    // Runs in the test runner, which has no document. The panel calls this
    // on mount, so throwing here would take the builder down with it.
    assert.doesNotThrow(() => clearHandoff());
  });
});

/**
 * React runs effects twice in StrictMode, which development builds enable.
 *
 * Two separate hazards, and fixing only the first leaves the second. A plain
 * read would have the first pass clear the fragment and the replay find
 * nothing, so the connection stalls with no error anywhere. And two passes
 * both completing would have the first spend the stored state and the second
 * fail its own check, reporting that the connection did not come from this
 * browser when it did.
 */
describe('surviving an effect that runs twice', () => {
  it('gives the same handoff to a second read of a cleared URL', () => {
    forgetHandoffClaim();
    const first = claimHandoff('#github=the-code&state=the-state');
    // The replay sees an empty fragment, because the first pass cleared it.
    const second = claimHandoff('');
    assert.deepEqual(first, { code: 'the-code', state: 'the-state' });
    assert.deepEqual(second, first);
  });

  it('is still nothing when there was never a handoff', () => {
    forgetHandoffClaim();
    assert.equal(claimHandoff(''), null);
  });

  it('spends the state once however many passes complete', async () => {
    forgetHandoffClaim();
    const store = storage();
    rememberState('the-state', store);
    const handoff = { code: 'c', state: 'the-state' };

    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      return json({ repositories: [], ticket: 'tkt' });
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      completeClaimedConnect(handoff, doFetch, TOKEN, store),
      completeClaimedConnect(handoff, doFetch, TOKEN, store),
    ]);

    assert.equal(a.ok, true);
    assert.equal(b.ok, true, 'the second pass failed its own check');
    assert.equal(calls, 1, 'the exchange ran twice');
  });

  it('does not start a second exchange after the first finished', async () => {
    forgetHandoffClaim();
    const store = storage();
    rememberState('the-state', store);
    const handoff = { code: 'c', state: 'the-state' };
    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      return json({ repositories: [], ticket: 'tkt' });
    }) as unknown as typeof fetch;

    await completeClaimedConnect(handoff, doFetch, TOKEN, store);
    const again = await completeClaimedConnect(handoff, doFetch, TOKEN, store);
    assert.equal(again.ok, true);
    assert.equal(calls, 1);
  });
});
