import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  beginConnect,
  beginInstall,
  bindRepository,
  disconnectRepository,
  onConnectionChanged,
  pushSnapshot,
  claimHandoff,
  clearHandoff,
  completeClaimedConnect,
  completeConnect,
  forgetHandoffClaim,
  holdHandoff,
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
      { owner: 'acme', repo: 'site', defaultBranch: 'main' },
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

  it('hands back what was bound, so no second request is needed', async () => {
    // The write has already landed by this point. A caller that had to fetch
    // the status to know what it connected would show nothing at all when
    // that second request failed, which is how somebody ends up unable to
    // tell whether their repository connected.
    const result = await bindRepository(
      'the-ticket',
      { owner: 'ACME', repo: 'Site', defaultBranch: 'main' },
      (async () =>
        json({
          owner: 'acme',
          repo: 'site',
          defaultBranch: 'trunk',
          expiresAt: '2026-12-13T00:00:00.000Z',
        })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      // GitHub's spelling, from the server, not the request's.
      assert.deepEqual(result.bound, {
        owner: 'acme',
        repo: 'site',
        defaultBranch: 'trunk',
        expiresAt: '2026-12-13T00:00:00.000Z',
      });
    }
  });

  it('still reports what it asked for when the reply cannot be read', async () => {
    // An unreadable reply does not undo a write that succeeded.
    const result = await bindRepository(
      'the-ticket',
      { owner: 'acme', repo: 'site', defaultBranch: 'main' },
      (async () =>
        new Response('not json', { status: 200 })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bound.owner, 'acme');
      assert.equal(result.bound.repo, 'site');
    }
  });

  it('keeps the chosen repository’s branch when the reply cannot be read', async () => {
    // The finding: the fallback said `main` for a repository on `trunk`. The
    // offer already carried the authoritative branch and the narrowed
    // parameter threw it away, so the fallback added to keep a success
    // visible showed it wrongly, and a failed refresh left that on screen.
    const result = await bindRepository(
      'the-ticket',
      { owner: 'acme', repo: 'site', defaultBranch: 'trunk' },
      (async () =>
        new Response('not json', { status: 200 })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.bound.defaultBranch, 'trunk');
  });

  it('keeps it when the reply names no branch at all', async () => {
    const result = await bindRepository(
      'the-ticket',
      { owner: 'acme', repo: 'site', defaultBranch: 'trunk' },
      (async () =>
        json({ owner: 'acme', repo: 'site' })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.bound.defaultBranch, 'trunk');
  });

  it('surfaces the server’s sentence when it refuses', async () => {
    const result = await bindRepository(
      'stale',
      { owner: 'acme', repo: 'site', defaultBranch: 'main' },
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
describe('pushing an accepted checkpoint', () => {
  const SNAPSHOT = {
    revision: 'r7',
    files: [{ path: 'index.html', content: '<p>hi</p>' }],
  };

  /** Where the button believed it was pushing when it was clicked. */
  const TO = { owner: 'acme', repo: 'site' };

  it('sends the revision and the files the route keys on', async () => {
    const sent: unknown[] = [];
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return json({ branch: 'vibld/r7', commitSha: 'abc', created: true });
      }) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    // The destination travels with it. The route reads the binding when the
    // request arrives, so a push that does not say where it meant to go is
    // asking for whatever is connected by then, which is how a button
    // labelled one repository writes to another.
    assert.deepEqual(sent[0], { ...SNAPSHOT, owner: 'acme', repo: 'site' });
  });

  it('reads back what was written', async () => {
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json({
          branch: 'vibld/r7',
          commitSha: 'abc',
          created: true,
          pullRequestUrl: 'https://github.com/acme/site/pull/1',
        })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.pushed, {
        branch: 'vibld/r7',
        commitSha: 'abc',
        created: true,
        pullRequestUrl: 'https://github.com/acme/site/pull/1',
      });
    }
  });

  it('keeps "the branch was already there" as its own answer', async () => {
    // What a retry looks like when the first reply was lost. Reporting it as
    // a fresh push sends somebody looking for a commit nothing just made.
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json({
          branch: 'vibld/r7',
          commitSha: 'abc',
          created: false,
        })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.pushed.created, false);
  });

  it('reads an absent `created` as a push rather than as a no-op', async () => {
    // The route always sends it, so absence means an older deployment. Of
    // the two ways to be wrong, claiming a push found nothing to do is the
    // more misleading.
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json({
          branch: 'vibld/r7',
          commitSha: 'abc',
        })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.pushed.created, true);
  });

  it('carries `reconnect` rather than folding it into the sentence', async () => {
    // A lost grant and a rate limit want different remedies, and the route
    // already separates them. Collapsing that here is the mistake this
    // feature has made more than any other.
    const lost = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json(
          { error: 'Vibld’s access was withdrawn.', reconnect: true },
          409,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(lost.ok, false);
    if (!lost.ok) assert.equal(lost.reconnect, true);

    const limited = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json(
          { error: 'Too many pushes. Try again shortly.' },
          429,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.equal(limited.reconnect, undefined);
  });

  it('reports an unreadable success rather than inventing a branch', async () => {
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () => json({ ok: true })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, false);
  });

  it('reports being unable to reach Vibld as that', async () => {
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Could not reach Vibld/);
  });

  it('carries a conflict with both shas rather than its sentence alone', async () => {
    // `docs/push-and-deploy-plan.md` promises a conflict is surfaced with
    // both shas, and the sentence the route writes names the branch and
    // neither of them. This reply is the only place they exist.
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json(
          {
            error:
              'The branch vibld/r7 already exists and points somewhere else.',
            conflict: {
              branch: 'vibld/r7',
              existingSha: 'a'.repeat(40),
              attemptedTreeSha: 'b'.repeat(40),
            },
          },
          409,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.conflict, {
        branch: 'vibld/r7',
        existingSha: 'a'.repeat(40),
        attemptedTreeSha: 'b'.repeat(40),
      });
    }
  });

  it('drops a conflict missing a sha rather than showing a blank one', async () => {
    // The sentence that carries a conflict promises both. Half of one draws
    // that sentence around an empty space, which reads as a branch pointing
    // at nothing.
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json(
          {
            error:
              'The branch vibld/r7 already exists and points somewhere else.',
            conflict: { branch: 'vibld/r7', existingSha: 'a'.repeat(40) },
          },
          409,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.conflict, undefined);
      // The sentence still gets through.
      assert.match(result.error, /already exists/);
    }
  });

  it('carries "your destination has moved" as its own answer', async () => {
    // A third remedy beside reconnecting and retrying, and neither of those
    // two. The connection is fine; this browser's idea of it is not, and
    // the same request would be refused the same way.
    const moved = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json(
          {
            error:
              'Vibld is connected to acme/other, which is not where this push was for.',
            destinationMoved: true,
          },
          409,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(moved.ok, false);
    if (!moved.ok) {
      assert.equal(moved.destinationMoved, true);
      // Not a lost grant. Offering a reconnection would be a loop.
      assert.equal(moved.reconnect, undefined);
    }

    const other = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        json(
          { error: 'Too many pushes. Try again shortly.' },
          429,
        )) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.destinationMoved, undefined);
  });

  it('says a success it cannot parse is unreadable rather than hanging', async () => {
    // A rejection here is not an error anybody sees: the caller has already
    // gone busy and is awaiting this, so the button would stay disabled
    // until the page was reloaded.
    const result = await pushSnapshot(
      SNAPSHOT,
      TO,
      (async () =>
        new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
      TOKEN,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /could not read/);
  });
});

/**
 * Two components read the connection and each keeps its own copy.
 *
 * The panel in the header binds and disconnects; the push button in the Code
 * tab reads the same status and is a sibling rather than a child, so nothing
 * about a bind reaches it on its own. Published from the writes themselves,
 * because a second caller would otherwise have to remember to announce it,
 * and forgetting is silent.
 */
describe('telling the rest of the builder the connection moved', () => {
  const CHOICE = { owner: 'acme', repo: 'site', defaultBranch: 'main' };
  const bound = (async () =>
    json({
      owner: 'acme',
      repo: 'site',
      defaultBranch: 'main',
    })) as unknown as typeof fetch;

  it('tells a listener when a repository is bound', async () => {
    let told = 0;
    const stop = onConnectionChanged(() => {
      told += 1;
    });
    await bindRepository('t', CHOICE, bound, TOKEN);
    stop();
    assert.equal(told, 1);
  });

  it('tells a listener when the repository is disconnected', async () => {
    let told = 0;
    const stop = onConnectionChanged(() => {
      told += 1;
    });
    await disconnectRepository(
      (async () => json({ ok: true })) as unknown as typeof fetch,
      TOKEN,
    );
    stop();
    assert.equal(told, 1);
  });

  it('says nothing when the write did not land', async () => {
    // Nothing moved, so a refresh would read back exactly what is already on
    // screen and the second request is the only thing that happened.
    let told = 0;
    const stop = onConnectionChanged(() => {
      told += 1;
    });
    await bindRepository(
      't',
      CHOICE,
      (async () => json({ error: 'no' }, 409)) as unknown as typeof fetch,
      TOKEN,
    );
    stop();
    assert.equal(told, 0);
  });

  it('stops telling a listener that unsubscribed', async () => {
    let told = 0;
    const stop = onConnectionChanged(() => {
      told += 1;
    });
    stop();
    await bindRepository('t', CHOICE, bound, TOKEN);
    assert.equal(told, 0);
  });

  it('does not tell a listener subscribed while the news was going out', async () => {
    // Somebody reacting to this change is not asking to be told about it,
    // and calling them for the change they are already handling is a
    // refresh of something they have in hand.
    const heard: string[] = [];
    const stops: (() => void)[] = [];
    stops.push(
      onConnectionChanged(() => {
        heard.push('first');
        stops.push(onConnectionChanged(() => void heard.push('late')));
      }),
    );
    await bindRepository('t', CHOICE, bound, TOKEN);
    for (const stop of stops) stop();
    assert.deepEqual(heard, ['first']);
  });

  it('lets one listener throw without failing the write or silencing the next', async () => {
    // The write has already landed by the time this runs. Reporting a bind
    // that worked as a failure because something listening threw would be
    // the worst of both.
    const heard: string[] = [];
    const first = onConnectionChanged(() => {
      heard.push('first');
      throw new Error('listener');
    });
    const second = onConnectionChanged(() => void heard.push('second'));
    const result = await bindRepository('t', CHOICE, bound, TOKEN);
    first();
    second();
    assert.equal(result.ok, true);
    assert.deepEqual(heard, ['first', 'second']);
  });
});

/**
 * Installing is a leg of the same flow, not a link out of it.
 *
 * GitHub carries a `state` through the installation flow only if one was
 * supplied. Without it the callback arrives with an `installation_id` and no
 * `state`, the worker turns that into `github=incomplete`, and the app
 * discards it: the installation happens and nothing hears about it. For an
 * account the read budget skipped, the id coming back is the entire point,
 * because a named installation is read directly and outside the budget.
 */
describe('sending somebody to install the app', () => {
  it('carries a state the browser has stored', async () => {
    const store = storage();
    const result = await beginInstall(
      (async () =>
        json({
          url: 'https://github.com/login/oauth/authorize?x=1',
          state: 'the-state',
        })) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const url = new URL(result.url);
      assert.equal(
        url.origin + url.pathname,
        'https://github.com/apps/vibld/installations/new',
      );
      assert.equal(url.searchParams.get('state'), 'the-state');
    }
    // Stored, or the comparison on the way back refuses its own state.
    assert.equal(takeRememberedState(store), 'the-state');
  });

  it('issues a fresh state rather than reusing a spent one', async () => {
    // The completion that produced the offer already spent the stored state,
    // so there is nothing to reuse: a state is good for one return trip.
    const store = storage();
    rememberState('already-spent', store);
    takeRememberedState(store);
    const result = await beginInstall(
      (async () =>
        json({
          url: 'https://github.com/x',
          state: 'brand-new',
        })) as unknown as typeof fetch,
      TOKEN,
      store,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(new URL(result.url).searchParams.get('state'), 'brand-new');
    }
    assert.equal(takeRememberedState(store), 'brand-new');
  });

  it('reports a deployment that cannot start one', async () => {
    const result = await beginInstall(
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
});

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

/**
 * How long that cache is allowed to live.
 *
 * Surviving the replay is the whole point of it, and surviving anything
 * longer is a bug with teeth. The panel mounts inside `Show when="signed-in"`,
 * so signing out unmounts it and signing in unmounts and mounts it again: a
 * cache that outlives the mount replays the previous person's repository
 * names to whoever signs in next on that browser, without a page load in
 * between. It also replays a spent ticket to the same person, which can only
 * fail by the time they click it.
 *
 * So it is held for as long as something is using it, and cleared when
 * nothing is. The clearing is deferred, because StrictMode's unmount and
 * remount happen with nothing in between, and a clear that ran there would
 * take the replay's handoff away, which is the bug this cache exists to
 * stop.
 */
describe('not outliving the mount that claimed it', () => {
  /** Runs the deferred clear by hand, so a test never waits on a timer. */
  function scheduler() {
    const queue: (() => void)[] = [];
    return {
      defer: (run: () => void) => {
        queue.push(run);
        return () => {
          const at = queue.indexOf(run);
          if (at !== -1) queue.splice(at, 1);
        };
      },
      settle() {
        const due = queue.splice(0);
        for (const run of due) run();
      },
      get pending() {
        return queue.length;
      },
    };
  }

  it('forgets the handoff once the last holder lets go', () => {
    forgetHandoffClaim();
    const clock = scheduler();
    const release = holdHandoff(clock.defer);
    claimHandoff('#github=the-code&state=the-state');

    release();
    clock.settle();

    assert.equal(
      claimHandoff(''),
      null,
      "a later mount was handed the previous mount's handoff",
    );
  });

  it('keeps it across an unmount the remount follows immediately', () => {
    // StrictMode: setup, cleanup, setup, with nothing in between. The
    // deferred clear has not run by the time the replay takes hold again,
    // and taking hold cancels it.
    forgetHandoffClaim();
    const clock = scheduler();
    const first = holdHandoff(clock.defer);
    const claimed = claimHandoff('#github=the-code&state=the-state');

    first();
    const second = holdHandoff(clock.defer);
    clock.settle();

    assert.deepEqual(claimHandoff(''), claimed);
    second();
  });

  it('keeps it while any other holder is still there', () => {
    forgetHandoffClaim();
    const clock = scheduler();
    const first = holdHandoff(clock.defer);
    const second = holdHandoff(clock.defer);
    claimHandoff('#github=the-code&state=the-state');

    first();
    assert.equal(clock.pending, 0, 'cleared while still in use');
    clock.settle();
    assert.ok(claimHandoff(''));

    second();
    clock.settle();
    assert.equal(claimHandoff(''), null);
  });

  it('counts one release per hold however often it is called', () => {
    // A cleanup that runs twice must not release somebody else's hold.
    forgetHandoffClaim();
    const clock = scheduler();
    const first = holdHandoff(clock.defer);
    const second = holdHandoff(clock.defer);
    claimHandoff('#github=the-code&state=the-state');

    first();
    first();
    clock.settle();

    assert.ok(claimHandoff(''), 'a repeated release freed a live hold');
    second();
  });

  it('starts a new exchange for the next mount rather than replaying one', async () => {
    forgetHandoffClaim();
    const clock = scheduler();
    const store = storage();
    rememberState('the-state', store);
    const handoff = { code: 'c', state: 'the-state' };
    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      return json({ repositories: [], ticket: `tkt-${calls}` });
    }) as unknown as typeof fetch;

    const release = holdHandoff(clock.defer);
    const first = await completeClaimedConnect(handoff, doFetch, TOKEN, store);
    release();
    clock.settle();

    // Whoever is signed in now: a fresh hold, and the same code offered
    // again. What must not happen is the previous answer coming back.
    holdHandoff(clock.defer);
    rememberState('the-state', store);
    const next = await completeClaimedConnect(handoff, doFetch, TOKEN, store);

    assert.equal(calls, 2, "the previous mount's offer was replayed");
    assert.equal(first.ok && first.offer.ticket, 'tkt-1');
    assert.equal(next.ok && next.offer.ticket, 'tkt-2');
  });
});
