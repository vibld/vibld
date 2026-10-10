import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { CustomDomain } from '../src/components/CustomDomain.tsx';

/** A published site's own domain in the builder (docs/decisions.md D189). */

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function serving(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CustomDomain projectId="project-7" />);
  });
  await settle();
  return {
    container,
    text: () => container.textContent ?? '',
    button: (label: RegExp) =>
      [...container.querySelectorAll('button')].find((button) =>
        label.test(button.textContent ?? ''),
      ),
    async type(value: string) {
      const input = container.querySelector('input')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async submit() {
      await act(async () => {
        container
          .querySelector('form')!
          .dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
      });
      await settle();
    },
    async press(label: RegExp) {
      const target = this.button(label);
      assert.ok(target, `no ${label} button`);
      await act(async () => {
        target.click();
      });
      await settle();
    },
    unmount() {
      root.unmount();
      container.remove();
    },
  };
}

const PENDING = {
  hostname: 'www.bakery.com',
  status: 'pending',
  records: [
    {
      type: 'CNAME',
      name: 'www.bakery.com',
      value: 'domains.vibld-preview.dev',
    },
  ],
  errors: [],
};

describe('the custom domain controls (D189)', () => {
  it('shows nothing where the deployment has no custom domains', async () => {
    serving(() => reply({ configured: false, domain: null }));
    const view = await mount();
    assert.equal(view.text(), '');
    view.unmount();
  });

  it('tells the Free plan which plans have it', async () => {
    serving(() => reply({ configured: true, eligible: false, domain: null }));
    const view = await mount();
    assert.match(view.text(), /Build or Ship plan/);
    assert.equal(view.container.querySelector('input'), null);
    view.unmount();
  });

  it('connects a domain and shows the record to add', async () => {
    const calls = serving((call) =>
      call.method === 'POST'
        ? reply({ configured: true, eligible: true, domain: PENDING }, 201)
        : reply({ configured: true, eligible: true, domain: null }),
    );
    const view = await mount();
    await view.type('www.bakery.com');
    await view.submit();
    assert.deepEqual(calls[1], {
      url: '/api/projects/project-7/domain',
      method: 'POST',
      body: { hostname: 'www.bakery.com' },
    });
    assert.match(view.text(), /Waiting for DNS/);
    assert.match(view.text(), /domains\.vibld-preview\.dev/);
    await view.press(/Check again/);
    assert.equal(calls.at(-1)?.url, '/api/projects/project-7/domain?recheck=1');
    view.unmount();
  });

  it('asks before disconnecting, then disconnects', async () => {
    const calls = serving((call) =>
      call.method === 'DELETE'
        ? reply({ hostname: 'www.bakery.com' })
        : reply({
            configured: true,
            eligible: true,
            domain: { ...PENDING, status: 'active', records: [] },
          }),
    );
    const view = await mount();
    assert.match(view.text(), /Live/);
    await view.press(/Disconnect domain/);
    assert.equal(calls.length, 1, 'one press disconnected it');
    await view.press(/^Disconnect$/);
    assert.equal(calls[1]?.method, 'DELETE');
    assert.ok(view.container.querySelector('input'), 'no way to connect again');
    view.unmount();
  });

  it('shows the TXT record that proves the domain, then connects', async () => {
    let proven = false;
    const calls = serving((call) =>
      call.method === 'POST'
        ? proven
          ? reply({ configured: true, eligible: true, domain: PENDING }, 201)
          : reply(
              {
                error: 'Add this TXT record to show the domain is yours.',
                code: 'verify-ownership',
                record: {
                  type: 'TXT',
                  name: '_vibld.www.bakery.com',
                  value: 'vibld-verify=abc',
                },
              },
              409,
            )
        : reply({ configured: true, eligible: true, domain: null }),
    );
    const view = await mount();
    await view.type('www.bakery.com');
    await view.submit();
    assert.match(view.text(), /_vibld\.www\.bakery\.com/);
    assert.match(view.text(), /vibld-verify=abc/);
    assert.ok(view.button(/Verify and connect/));
    proven = true;
    await view.submit();
    assert.equal(calls.filter((call) => call.method === 'POST').length, 2);
    assert.match(view.text(), /Waiting for DNS/);
    view.unmount();
  });

  it('says so when vibld cannot be reached, and keeps the form usable', async () => {
    let offline = false;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (offline || init?.method === 'POST') throw new TypeError('offline');
      return reply({ configured: true, eligible: true, domain: null });
    }) as typeof fetch;
    const view = await mount();
    await view.type('www.bakery.com');
    await view.submit();
    assert.match(view.text(), /could not be reached/);
    const button = view.button(/Connect domain/);
    assert.ok(button && !button.disabled, 'the form is usable again');
    view.unmount();

    offline = true;
    const first = await mount();
    assert.match(first.text(), /could not be reached/);
    offline = false;
    await first.press(/Try again/);
    assert.ok(first.button(/Connect domain/), 'the form is back once online');
    assert.doesNotMatch(first.text(), /could not be reached/);
    first.unmount();
  });

  it('says what went wrong and keeps the form', async () => {
    serving((call) =>
      call.method === 'POST'
        ? reply(
            { error: 'www.bakery.com is already connected to a site.' },
            409,
          )
        : reply({ configured: true, eligible: true, domain: null }),
    );
    const view = await mount();
    await view.type('www.bakery.com');
    await view.submit();
    assert.match(view.text(), /already connected to a site/);
    assert.ok(view.container.querySelector('input'));
    view.unmount();
  });
});
