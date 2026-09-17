import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { SiteTakedown } from '../src/components/SiteTakedown.tsx';

/**
 * The operator's takedown (#172), as it is actually wired.
 *
 * This acts on work that is not the operator's, which is what makes the two
 * presses and the required reason load-bearing rather than ceremony.
 */

interface Call {
  url: string;
  body?: Record<string, unknown>;
}

function serving(answer: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      ...(init?.body
        ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
        : {}),
    });
    return answer();
  }) as typeof fetch;
  return calls;
}

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function press(button: Element | null | undefined, what: string) {
  assert.ok(button instanceof window.HTMLButtonElement, `no ${what}`);
  await act(async () => {
    button.click();
  });
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<SiteTakedown />);
  });

  function labelled(text: RegExp): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find((button) =>
      text.test(button.textContent ?? ''),
    );
  }

  async function type(id: 0 | 1, value: string) {
    const input = container.querySelectorAll('input')[id];
    assert.ok(input, 'no field');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  return {
    container,
    labelled,
    slug: (value: string) => type(0, value),
    reason: (value: string) => type(1, value),
    confirming: () =>
      container.querySelector('[aria-label="Confirm takedown"]') !== null,
    askHold: () => press(labelled(/Take it down/), 'take-down button'),
    askRelease: () => press(labelled(/Lift a hold/), 'release button'),
    confirm: () =>
      press(
        container
          .querySelector('[aria-label="Confirm takedown"]')
          ?.querySelector('button'),
        'confirm button',
      ),
    cancel: () =>
      press(
        [
          ...(container
            .querySelector('[aria-label="Confirm takedown"]')
            ?.querySelectorAll('button') ?? []),
        ].at(-1),
        'cancel button',
      ),
    text: () => container.textContent ?? '',
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('taking somebody else"s site down', () => {
  it('refuses without a slug, and asks nothing of the server', async () => {
    const calls = serving(() => reply({}));
    const view = await mount();
    await view.askHold();

    assert.deepEqual(calls, []);
    assert.match(view.text(), /Name the site by its slug/);
    view.unmount();
  });

  it('refuses without a reason', async () => {
    // Auditable is not something that can be added afterwards: a hold with
    // no reason is one nobody can review later.
    const calls = serving(() => reply({}));
    const view = await mount();
    await view.slug('acme');
    await view.askHold();

    assert.deepEqual(calls, []);
    assert.match(view.text(), /Say why this site is being taken down/);
    view.unmount();
  });

  it('sends nothing on the first press', async () => {
    const calls = serving(() => reply({}));
    const view = await mount();
    await view.slug('acme');
    await view.reason('phishing report 41');
    await view.askHold();

    assert.equal(view.confirming(), true, 'it did not ask');
    assert.deepEqual(calls, [], 'one press took somebody"s site down');
    view.unmount();
  });

  it('names the site, and says the owner cannot undo it', async () => {
    serving(() => reply({}));
    const view = await mount();
    await view.slug('acme');
    await view.reason('phishing report 41');
    await view.askHold();

    const said = view.text();
    assert.match(said, /acme/);
    assert.match(said, /stops working for everyone/);
    assert.match(said, /owner cannot put it back/);
    view.unmount();
  });

  it('takes nothing down when the decision is declined', async () => {
    const calls = serving(() => reply({}));
    const view = await mount();
    await view.slug('acme');
    await view.reason('phishing report 41');
    await view.askHold();
    await view.cancel();

    assert.deepEqual(calls, []);
    assert.ok(view.labelled(/Take it down/), 'the control did not come back');
    view.unmount();
  });

  it('sends the slug and the reason when it is taken', async () => {
    const calls = serving(() => reply({ slug: 'acme', state: 'held' }));
    const view = await mount();
    await view.slug('  acme  ');
    await view.reason('  phishing report 41  ');
    await view.askHold();
    await view.confirm();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/api/admin/publish/hold');
    assert.deepEqual(calls[0]?.body, {
      slug: 'acme',
      reason: 'phishing report 41',
    });
    assert.match(view.text(), /acme is off the web and held/);
    view.unmount();
  });

  it('says a released site stays down when its owner had taken it down', async () => {
    // Lifting a hold returns the decision to whoever else has a say, and
    // reporting "live again" here would be a lie the operator acts on.
    serving(() => reply({ slug: 'acme', state: 'down' }));
    const view = await mount();
    await view.slug('acme');
    await view.askRelease();
    await view.confirm();

    const said = view.text();
    assert.match(said, /no longer held/);
    assert.match(said, /stays off the web/);
    assert.doesNotMatch(said, /live again/);
    view.unmount();
  });

  it('says a released site is serving again when it is', async () => {
    serving(() => reply({ slug: 'acme', state: 'live' }));
    const view = await mount();
    await view.slug('acme');
    await view.askRelease();
    await view.confirm();

    assert.match(view.text(), /acme is live again/);
    view.unmount();
  });

  it('needs no reason to lift a hold', async () => {
    const calls = serving(() => reply({ slug: 'acme', state: 'live' }));
    const view = await mount();
    await view.slug('acme');
    await view.askRelease();

    assert.equal(view.confirming(), true, 'it demanded a reason to release');
    await view.confirm();
    assert.deepEqual(calls[0]?.body, { slug: 'acme' });
    view.unmount();
  });

  it('reports a refusal rather than claiming it worked', async () => {
    serving(() => reply({ error: 'No such published site.' }, 404));
    const view = await mount();
    await view.slug('never');
    await view.reason('phishing');
    await view.askHold();
    await view.confirm();

    assert.match(view.text(), /No such published site/);
    assert.doesNotMatch(view.text(), /off the web and held/);
    view.unmount();
  });

  it('does not claim a hold on a reply that never said so', async () => {
    serving(() => reply({ slug: 'acme' }));
    const view = await mount();
    await view.slug('acme');
    await view.reason('phishing');
    await view.askHold();
    await view.confirm();

    assert.match(view.text(), /unexpected response/);
    assert.doesNotMatch(view.text(), /off the web and held/);
    view.unmount();
  });
});
