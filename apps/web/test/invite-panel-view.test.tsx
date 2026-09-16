import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { InvitePanel } from '../src/components/InvitePanel.tsx';

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
  invitedByEmail: 'chris@drummond.com',
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
        { email: 'new@example.com', created: true, reinstated: false },
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
