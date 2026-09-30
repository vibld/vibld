import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { AccountDeletion } from '../src/components/AccountDeletion.tsx';
import { AccessGate } from '../src/components/AccessGate.tsx';
import { DeletionsPanel } from '../src/components/DeletionsPanel.tsx';

/**
 * Deleting an account from the builder (docs/decisions.md L32), as it is
 * actually wired.
 *
 * The confirmation is the part a view model cannot hold: that it happens in
 * the page rather than in `confirm()`, that it says what stops, what goes
 * in 30 days and what is kept, and that nothing is sent until the phrase is
 * typed.
 */

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function serving(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      ...(init?.body
        ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
        : {}),
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

const SCHEDULED = {
  scheduled: true,
  requestedAt: '2026-09-28T12:00:00.000Z',
  purgeAfter: '2026-10-28T12:00:00.000Z',
  steps: {
    subscription: true,
    preview: true,
    sites: true,
    github: true,
    referrals: true,
  },
  errors: [],
  cancellable: true,
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await settle();
  });
  const button = (text: RegExp) =>
    [...container.querySelectorAll('button')].find((b) =>
      text.test(b.textContent ?? ''),
    );
  return {
    container,
    text: () => container.textContent ?? '',
    button,
    async press(text: RegExp) {
      const target = button(text);
      assert.ok(target instanceof window.HTMLButtonElement, `no ${text}`);
      await act(async () => {
        target.click();
        await settle();
      });
    },
    async type(value: string) {
      const input = container.querySelector('input');
      assert.ok(input, 'no field to type into');
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the delete account control', () => {
  it('asks nothing of the server until somebody presses it', async () => {
    const calls = serving(() => reply(SCHEDULED));
    const view = await render(<AccountDeletion onDone={() => undefined} />);
    assert.equal(calls.length, 0);
    assert.ok(view.button(/^Delete account$/));
    view.unmount();
  });

  it('confirms in the page, not with a browser dialog, and explains what happens', async () => {
    const calls = serving(() => reply(SCHEDULED));
    let dialogs = 0;
    window.confirm = () => {
      dialogs += 1;
      return true;
    };
    const view = await render(<AccountDeletion onDone={() => undefined} />);
    await view.press(/^Delete account$/);

    assert.equal(dialogs, 0, 'a browser dialog was used');
    assert.ok(
      view.container.querySelector('[aria-label="Confirm account deletion"]'),
    );
    const text = view.text();
    // What stops immediately.
    assert.match(text, /What stops now/);
    assert.match(text, /subscription is canceled straight away/);
    assert.match(text, /published site goes offline/);
    // What goes after 30 days.
    assert.match(text, /deleted after 30 days/);
    assert.match(text, /project/);
    // What is kept, and why.
    assert.match(text, /What is kept, and why/);
    assert.match(text, /accounting records we have to keep/);
    assert.match(text, /12 months/);
    assert.equal(calls.length, 0, 'opening the confirmation sent something');
    view.unmount();
  });

  it('will not send until the phrase is typed', async () => {
    const calls = serving(() => reply(SCHEDULED));
    const view = await render(<AccountDeletion onDone={() => undefined} />);
    await view.press(/^Delete account$/);

    const confirm = () => view.button(/^Delete my account$/);
    assert.equal(confirm()?.disabled, true);
    await view.type('delete my acc');
    assert.equal(confirm()?.disabled, true);
    await view.type('yes');
    assert.equal(confirm()?.disabled, true);
    await view.type('Delete my account ');
    assert.equal(confirm()?.disabled, false);
    assert.equal(calls.length, 0);

    await view.press(/^Delete my account$/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/api/account/delete');
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(calls[0]?.body, { confirm: 'Delete my account ' });
    view.unmount();
  });

  it('says when the account will be deleted, and what has not stopped yet', async () => {
    serving(() =>
      reply({
        ...SCHEDULED,
        steps: { ...SCHEDULED.steps, subscription: false },
        errors: ['Your subscription could not be canceled yet.'],
      }),
    );
    let done = 0;
    const view = await render(<AccountDeletion onDone={() => (done += 1)} />);
    await view.press(/^Delete account$/);
    await view.type('delete my account');
    await view.press(/^Delete my account$/);

    assert.match(view.text(), /scheduled for deletion on/);
    assert.match(view.text(), /2026/);
    assert.match(view.text(), /subscription could not be canceled yet/);
    await view.press(/^Continue$/);
    assert.equal(done, 1);
    view.unmount();
  });

  it('claims nothing when the server refuses', async () => {
    serving(() =>
      reply(
        { error: 'Your request could not be recorded. Nothing was deleted.' },
        503,
      ),
    );
    const view = await render(<AccountDeletion onDone={() => undefined} />);
    await view.press(/^Delete account$/);
    await view.type('delete my account');
    await view.press(/^Delete my account$/);
    assert.match(view.text(), /Nothing was deleted/);
    assert.doesNotMatch(view.text(), /scheduled for deletion on/);
    view.unmount();
  });

  it('can be backed out of before anything is sent', async () => {
    const calls = serving(() => reply(SCHEDULED));
    const view = await render(<AccountDeletion onDone={() => undefined} />);
    await view.press(/^Delete account$/);
    await view.press(/^Keep my account$/);
    assert.ok(view.button(/^Delete account$/));
    assert.equal(calls.length, 0);
    view.unmount();
  });
});

describe('the screen an account scheduled for deletion sees', () => {
  function gate(onStatus: () => Response, calls: Call[] = []) {
    return serving((call) => {
      calls.push(call);
      if (call.url === '/api/access/status') return onStatus();
      if (call.url === '/api/account/delete') {
        return reply({
          ...SCHEDULED,
          errors: ['Your published site is still online.'],
        });
      }
      if (call.url === '/api/account/delete/cancel') {
        return reply({ cancelled: true });
      }
      return reply({ error: 'unexpected' }, 500);
    });
  }

  async function mount() {
    let mounted = false;
    function Builder() {
      mounted = true;
      return <p>the builder</p>;
    }
    const view = await render(
      <AccessGate configured signOut={<button type="button">Sign out</button>}>
        <Builder />
      </AccessGate>,
    );
    await act(async () => {
      await settle();
    });
    return { ...view, mounted: () => mounted };
  }

  it('says so, with the date, rather than that the account could not be checked', async () => {
    gate(() =>
      reply(
        {
          error: 'This account is scheduled for deletion.',
          reason: 'deletion-scheduled',
          purgeAfter: SCHEDULED.purgeAfter,
        },
        403,
      ),
    );
    const view = await mount();
    assert.equal(view.mounted(), false);
    assert.match(view.text(), /scheduled for deletion/);
    assert.doesNotMatch(view.text(), /could not check/i);
    assert.doesNotMatch(view.text(), /waiting list/i);
    assert.match(view.text(), /published site is still online/);
    assert.ok(view.button(/Try those again/));
    view.unmount();
  });

  it('keeps the account, and lets it back in', async () => {
    let kept = false;
    const calls: Call[] = [];
    gate(
      () =>
        kept
          ? reply({ allowed: true, mode: 'open', message: null })
          : reply(
              {
                error: 'This account is scheduled for deletion.',
                reason: 'deletion-scheduled',
                purgeAfter: SCHEDULED.purgeAfter,
              },
              403,
            ),
      calls,
    );
    const view = await mount();
    kept = true;
    await view.press(/Keep my account/);
    await act(async () => {
      await settle();
    });
    assert.ok(
      calls.some(
        (call) =>
          call.url === '/api/account/delete/cancel' && call.method === 'POST',
      ),
    );
    assert.equal(view.mounted(), true);
    view.unmount();
  });

  it('retries the unfinished steps without asking for the phrase again', async () => {
    const calls: Call[] = [];
    gate(
      () =>
        reply(
          {
            error: 'This account is scheduled for deletion.',
            reason: 'deletion-scheduled',
            purgeAfter: SCHEDULED.purgeAfter,
          },
          403,
        ),
      calls,
    );
    const view = await mount();
    await view.press(/Try those again/);
    const retry = calls.find(
      (call) => call.url === '/api/account/delete' && call.method === 'POST',
    );
    assert.ok(retry, 'no retry was sent');
    view.unmount();
  });
});

describe('the operator list of pending deletions', () => {
  it('shows each account, when it purges, and a site that holds the purge', async () => {
    const calls = serving(() =>
      reply({
        pending: [
          {
            userId: 'user_leaver',
            requestedAt: '2026-09-28T12:00:00.000Z',
            purgeAfter: '2026-10-28T12:00:00.000Z',
            done: {
              subscription: '2026-09-28T12:00:00.000Z',
              preview: '2026-09-28T12:00:00.000Z',
              sites: null,
              github: '2026-09-28T12:00:00.000Z',
              referrals: '2026-09-28T12:00:00.000Z',
            },
            lastError: 'Your published site is still online.',
            attempts: 1,
            purgeStep: 0,
            liveSlug: 'leaver-site',
          },
        ],
        purged: 2,
      }),
    );
    const view = await render(<DeletionsPanel />);
    assert.equal(calls.length, 0, 'read before being opened');
    const details = view.container.querySelector('details');
    assert.ok(details);
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event('toggle', { bubbles: false }));
      await settle();
    });
    assert.equal(calls[0]?.url, '/api/admin/deletions');
    const text = view.text();
    assert.match(text, /user_leaver/);
    assert.match(text, /purges/);
    assert.match(text, /2026/);
    assert.match(text, /not yet done: sites/);
    assert.match(text, /leaver-site is still online/);
    assert.match(text, /2 deleted in the last 12 months/);
    view.unmount();
  });
});
