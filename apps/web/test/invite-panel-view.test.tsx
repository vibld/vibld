import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  InvitePanel,
  billingSentence,
  clerkSentence,
} from '../src/components/InvitePanel.tsx';

/**
 * The panel an operator uses to let somebody in.
 *
 * Everything asserted here is about not overstating what happened. The list
 * this panel edits is the thing that decides who can use the product, so a
 * confirmation that does not correspond to a row that moved is worse than no
 * confirmation: it is read once and believed.
 */

interface Recorded {
  url: string;
  method: string;
  body: string;
}

function harness(answers: Record<string, unknown[]>) {
  const seen: Recorded[] = [];
  const queues: Record<string, unknown[]> = { ...answers };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const queue = queues[url] ?? [];
    // The last answer repeats. A queue that runs dry mid-test would answer
    // a refresh with a 404 and make the assertion below about the wrong
    // thing.
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return seen;
}

async function open() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<InvitePanel />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const summary = container.querySelector('summary');
  assert.ok(summary, 'no panel to open');
  await act(async () => {
    const details = container.querySelector('details');
    if (details) details.open = true;
    details?.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    text: () => container.textContent ?? '',
    press: async (label: RegExp) => {
      const button = [...container.querySelectorAll('button')].find((node) =>
        label.test(node.textContent ?? ''),
      );
      assert.ok(button, `no control matching ${label}`);
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    // Scoped to a row, because the same words label the control beside the
    // field. A search over the whole panel finds that one first and, when
    // the field is empty, presses a disabled button and asserts nothing.
    pressRow: async (label: RegExp) => {
      const button = [
        ...container.querySelectorAll('.invites__row button'),
      ].find((node) => label.test(node.textContent ?? ''));
      assert.ok(button, `no row control matching ${label}`);
      await act(async () => {
        (button as HTMLButtonElement).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    type: async (value: string) => {
      const input = container.querySelector('input');
      assert.ok(input, 'no field');
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

const WAITING = {
  email: 'waiting@example.com',
  invitedByEmail: 'sam@example.com',
  invitedAt: '2026-09-16T00:00:00.000Z',
  redeemedByUserId: null,
  redeemedAt: null,
  revokedAt: null,
};

describe('the invite panel', () => {
  it('shows the list once it is opened', async () => {
    harness({ '/api/admin/invites': [{ invites: [WAITING] }] });
    const view = await open();
    assert.match(view.text(), /waiting@example\.com/);
    assert.match(view.text(), /waiting/);
  });

  it('does not report an invite that was already there as a new one', async () => {
    // The route answers `created: false, reinstated: false` for an address
    // already on the list. Saying "Invited" there is how somebody believes
    // they have just let a person in who has been waiting a week.
    harness({
      '/api/admin/invites': [{ invites: [WAITING] }],
      '/api/admin/invite': [
        { email: 'waiting@example.com', created: false, reinstated: false },
      ],
    });
    const view = await open();
    await view.type('waiting@example.com');
    await view.press(/^Invite$/);

    assert.match(view.text(), /already invited\. Nothing changed/i);
    assert.doesNotMatch(
      view.text(),
      /^Invited waiting@example\.com\.$/m,
      'claimed a new invite that was not made',
    );
  });

  it('does not call a row on this list a sign-in', async () => {
    // Clerk is in Waitlist mode, so a row here lets somebody past the gate
    // and does not let them create a session. Unapproved in Clerk they
    // cannot sign in at all, and never reach the gate to be admitted by it.
    // "Invited" on its own is a claim this panel cannot make, and an
    // operator who believes it stops looking when the person says the
    // product will not let them in.
    harness({
      '/api/admin/invites': [{ invites: [] }],
      '/api/admin/invite': [
        {
          email: 'new@example.com',
          created: true,
          reinstated: false,
          // What a deployment with no Clerk key answers. The invite is
          // real and the other half of letting them in has not happened.
          clerk: { admitted: false, reason: 'unconfigured' },
        },
      ],
    });
    const view = await open();

    // Said whatever was last pressed, because it is true of the list.
    assert.match(view.text(), /waitlisted in Clerk/i);
    const link = view.container.querySelector(
      'a[href="https://dashboard.clerk.com/~/users/waitlist"]',
    );
    assert.ok(link, 'no way to reach the place the other half happens');

    await view.type('new@example.com');
    await view.press(/^Invite$/);

    assert.match(view.text(), /on the invite list/i);
    assert.match(
      view.text(),
      /approve them in clerk/i,
      'reported an invite as though it were access',
    );
  });

  it('does not report a withdrawal that did not happen', async () => {
    // `revoked: false` is an address with no invite to withdraw, or one
    // already withdrawn. Either way nothing moved, and telling an operator
    // their access is gone when it is not is the dangerous direction.
    harness({
      '/api/admin/invites': [{ invites: [WAITING] }],
      '/api/admin/invite/revoke': [
        { email: 'waiting@example.com', revoked: false },
      ],
    });
    const view = await open();
    await view.pressRow(/Withdraw/);

    assert.match(view.text(), /had no invite to withdraw/i);
    assert.doesNotMatch(view.text(), /Withdrew/);
  });

  it('reloads the list after something changed', async () => {
    // The panel's own confirmation is one sentence. The row beside it has to
    // agree, or the next thing the operator does is act on a state that
    // stopped being true when they pressed the button.
    const seen = harness({
      '/api/admin/invites': [
        { invites: [WAITING] },
        { invites: [{ ...WAITING, revokedAt: '2026-09-16T02:00:00.000Z' }] },
      ],
      '/api/admin/invite/revoke': [
        { email: 'waiting@example.com', revoked: true },
      ],
    });
    const view = await open();
    await view.pressRow(/Withdraw/);

    assert.match(view.text(), /withdrawn/i);
    assert.match(view.text(), /Invite again/);
    assert.equal(
      seen.filter((call) => call.url === '/api/admin/invites').length,
      2,
      'never asked the list what it looks like now',
    );
  });

  it('says when the list is not all of it', async () => {
    // The rows are capped. Presenting 200 of them as the list is a claim
    // nothing established, and it is the claim that makes the next failure
    // invisible.
    harness({
      '/api/admin/invites': [{ invites: [WAITING], truncated: true }],
    });
    const view = await open();
    assert.match(view.text(), /more invites than are shown/i);
  });

  it('can withdraw an address the list does not show', async () => {
    // The consequence of the cap, and the reason the note above is not
    // enough on its own: the per-row control is the only one a row has, so
    // an invite past the cap would have no way to be withdrawn at all.
    const seen = harness({
      '/api/admin/invites': [{ invites: [WAITING], truncated: true }],
      '/api/admin/invite/revoke': [{ email: 'far@example.com', revoked: true }],
    });
    const view = await open();
    await view.type('far@example.com');
    await view.press(/Withdraw/);

    const revokes = seen.filter(
      (call) => call.url === '/api/admin/invite/revoke',
    );
    assert.equal(revokes.length, 1, 'never reached the route');
    assert.deepEqual(JSON.parse(revokes[0]?.body ?? '{}'), {
      email: 'far@example.com',
    });
    assert.match(view.text(), /Withdrew far@example\.com/);
  });

  it('does not take away an address typed while the invite was in flight', async () => {
    // The field stays editable during the request, and the operator's next
    // address is usually typed into it. Clearing on the answer throws that
    // away, and the comparison that was supposed to prevent it read the
    // value from the render that started the request, which is by
    // definition the one just submitted.
    let release: (() => void) | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/invite') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(
          JSON.stringify({
            email: 'first@example.com',
            created: true,
            reinstated: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ invites: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const view = await open();
    await view.type('first@example.com');
    await act(async () => {
      const button = [...view.container.querySelectorAll('button')].find(
        (node) => /^Invite$/.test(node.textContent ?? ''),
      );
      button?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await view.type('second@example.com');
    await act(async () => {
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const field = view.container.querySelector('input');
    assert.equal(
      field?.value,
      'second@example.com',
      'threw away what was being typed',
    );
  });

  it('leaves the rows up when a refresh fails', async () => {
    // Clearing them would read as an empty invite list, which is a much
    // louder claim than "this could not be reloaded" and the wrong one.
    let asked = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/invites') {
        asked += 1;
        return asked === 1
          ? new Response(JSON.stringify({ invites: [WAITING] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(JSON.stringify({ error: 'D1 is unavailable.' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
      }
      return new Response(
        JSON.stringify({ email: 'waiting@example.com', revoked: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const view = await open();
    await view.pressRow(/Withdraw/);

    // Asserted on the rows, not on the page text. The confirmation sentence
    // names the same address, so matching the text passed with the rows
    // cleared: the first version of this test proved nothing.
    const rows = view.container.querySelectorAll('.invites__row');
    assert.equal(rows.length, 1, 'dropped the rows it already had');
    assert.match(rows[0]?.textContent ?? '', /waiting@example\.com/);
    assert.doesNotMatch(view.text(), /Nobody has been invited yet/);
    assert.match(view.text(), /D1 is unavailable/);
  });
});

describe('what the panel says about Clerk', () => {
  it('claims they can sign in only when Clerk said so', async () => {
    // The strongest claim this panel makes, and the one that decides whether
    // somebody is actually let in. It is made on Clerk's own answer read
    // back, never on a request having been sent.
    assert.match(clerkSentence({ admitted: true }), /can sign in/);
  });

  it('says they cannot sign in yet when Clerk took nothing', async () => {
    // An answer rather than a failure, and the difference matters: this one
    // is not worth trying again, it is worth going to Clerk.
    const said = clerkSentence({
      admitted: false,
      reason: 'still-waiting',
      status: 'pending',
      invited: false,
    });

    assert.match(said, /cannot sign in yet/);
    assert.match(said, /pending/);
    assert.doesNotMatch(said, /could not be asked/);
  });

  it('sends somebody to look when Clerk contradicts itself', async () => {
    // Clerk took the invitation and still lists the person as waiting. Which
    // of those governs is the one thing this deployment cannot establish, so
    // it must not claim either. What is true under both readings is that
    // somebody should go and look.
    const said = clerkSentence({
      admitted: false,
      reason: 'still-waiting',
      status: 'pending',
      invited: true,
    });

    // It must not claim either way. "whether they can sign in" is the
    // question being handed over, not an answer to it, so the assertion is
    // on the claim rather than on the words.
    assert.match(said, /check in Clerk/);
    assert.doesNotMatch(said, /Approved in Clerk/);
    assert.doesNotMatch(said, /they cannot sign in/);
  });

  it('says Clerk was not asked when this deployment cannot ask it', async () => {
    const said = clerkSentence({ admitted: false, reason: 'unconfigured' });

    assert.match(said, /not set up/);
    assert.doesNotMatch(said, /can sign in\./);
  });

  it('says it could not tell, rather than either answer', async () => {
    const said = clerkSentence({
      admitted: false,
      reason: 'error',
      error: 'Could not reach Clerk to invite them.',
    });

    assert.match(said, /could not be asked/);
    assert.doesNotMatch(said, /can sign in\./);
    assert.doesNotMatch(said, /still has them/);
  });

  it('warns when the answer could not be read at all', async () => {
    // A gap rather than a silence, and the difference is the whole reason
    // the two are separate values. An operator told nothing concludes the
    // invite was the whole job, which is how somebody is left unable to
    // sign in with everybody believing they were let in.
    const said = clerkSentence(null);

    assert.match(said, /not known/);
    assert.doesNotMatch(said, /can sign in\./);
  });
});

describe('the standing Clerk line, once inviting approves there too', () => {
  it('does not tell an operator to redo what the invite just did', async () => {
    // It used to end "approve people in Clerk as well", which was true until
    // inviting started doing that. Left alone, a successful approval sits
    // directly above a standing instruction to go and do the thing that has
    // just been done, and the way somebody follows that instruction is by
    // revoking and reissuing an invitation that was already working.
    harness({
      '/api/admin/invites': [{ invites: [] }],
      '/api/admin/invite': [
        {
          email: 'new@example.com',
          created: true,
          reinstated: false,
          clerk: { admitted: true },
        },
      ],
    });
    const view = await open();
    await view.type('new@example.com');
    await view.press(/^Invite$/);

    assert.match(view.text(), /Approved in Clerk/i);
    assert.doesNotMatch(
      view.text(),
      /approve people at/i,
      'still standing instruction to do it by hand',
    );
    // The link stays, for the outcomes where somebody does have to look.
    assert.ok(
      view.container.querySelector(
        'a[href="https://dashboard.clerk.com/~/users/waitlist"]',
      ),
      'no way to reach Clerk when the automatic attempt did not work',
    );
  });
});

describe('what the panel says about a withdrawn subscriber', () => {
  it('leads with the date, because that is the whole decision', async () => {
    // At period end, not immediately: they keep what they paid for and are
    // not charged again. An operator needs the date to answer the question
    // the person will ask them.
    const said = billingSentence({
      scheduled: true,
      endsAt: '2026-10-01T00:00:00.000Z',
    });
    assert.match(said, /set to end/i);
    assert.match(said, /2026/);
    assert.match(said, /not charged again/i);
  });

  it('does not claim a subscription is cancelled', async () => {
    // Nothing has stopped yet. "Cancelled" would tell an operator the
    // charging is over when the next invoice may be weeks away, and that is
    // the sentence they would repeat to the person.
    const said = billingSentence({ scheduled: true, endsAt: null });
    assert.doesNotMatch(said, /cancell?ed/i);
  });

  it('warns rather than reassures when the answer could not be read', async () => {
    // The dangerous default. Silence reads as "handled", and the thing not
    // handled is somebody's money.
    const said = billingSentence(null);
    assert.match(said, /not known/i);
    assert.match(said, /Stripe/);
    assert.doesNotMatch(said, /not charged again/i);
  });

  it('sends somebody to Stripe when Stripe could not be asked', async () => {
    const said = billingSentence({
      scheduled: false,
      reason: 'error',
      error: 'Stripe would not schedule the cancellation.',
    });
    assert.match(said, /still being charged/i);
    assert.doesNotMatch(said, /nothing to stop/i);
  });

  it('tells an unused invite apart from an account that never paid', async () => {
    const untaken = billingSentence({
      scheduled: false,
      reason: 'never-signed-in',
    });
    const unpaid = billingSentence({
      scheduled: false,
      reason: 'nothing-to-stop',
    });
    assert.notEqual(untaken, unpaid);
    assert.match(untaken, /Nobody ever signed in/i);
    assert.match(unpaid, /no live subscription/i);
  });

  it('says so when this deployment has no Stripe to ask', async () => {
    const said = billingSentence({ scheduled: false, reason: 'unconfigured' });
    assert.match(said, /not set up/i);
    assert.match(said, /yourself/i);
  });

  it('puts the sentence on the withdrawal an operator just made', async () => {
    harness({
      '/api/admin/invites': [{ invites: [] }],
      '/api/admin/invite/revoke': [
        {
          email: 'sam@example.com',
          revoked: true,
          billing: { scheduled: true, endsAt: '2026-10-01T00:00:00.000Z' },
        },
      ],
    });
    const view = await open();
    await view.type('sam@example.com');
    await view.press(/^Withdraw$/);

    assert.match(view.text(), /Withdrew sam@example\.com/);
    assert.match(view.text(), /set to end/i);
  });
});
