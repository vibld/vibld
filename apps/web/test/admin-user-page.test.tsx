import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { AdminUserPage } from '../src/components/AdminUserPage.tsx';

/**
 * One account's admin page (docs/decisions.md D73), as it is wired: what
 * it shows, and the two controls that must not fire on a slip, the ban
 * (a reason first) and the deletion (the account's own email typed first).
 */

const USER = 'user_2abc123';

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DETAIL = (over: Record<string, unknown> = {}) => ({
  userId: USER,
  email: 'target@example.com',
  createdAt: 1_700_000_000_000,
  lastSignInAt: null,
  clerkBanned: false,
  plan: {
    tier: 'build',
    gifted: true,
    subscriptionTier: null,
    currentPeriodEnd: null,
    gift: {
      tier: 'build',
      endsAt: '2026-12-31T23:59:59.999Z',
      grantedBy: 'admin@vibld.com',
      reason: 'Partner',
      createdAt: '2026-09-29T00:00:00.000Z',
      revokedAt: null,
      revokedBy: null,
    },
  },
  gifts: [],
  overrides: null,
  limits: {
    activeProjects: null,
    tierActiveProjects: null,
    monthlyAllowanceMicroUsd: 10_000_000,
    tierMonthlyAllowanceMicroUsd: 10_000_000,
  },
  spend: { monthMicroUsd: 500_000, creditRemainingMicroUsd: 1_000_000 },
  suspended: false,
  ban: null,
  deletion: null,
  projects: [
    {
      id: 'p1',
      name: 'Bakery',
      archived: false,
      updatedAt: '2026-09-28T00:00:00.000Z',
      site: { slug: 'bakery', state: 'live' },
    },
  ],
  runs: [],
  audit: [],
  ...over,
});

function serving(detail: () => unknown) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return reply({
        ok: true,
        userId: USER,
        clerk: { ok: true },
        heldSites: ['bakery'],
      });
    }
    if (url.includes('/api/admin/user/detail')) return reply(detail());
    throw new Error(`nothing is serving ${url}`);
  }) as typeof fetch;
  return posts;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminUserPage isAdmin={true} userId={USER} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const button = (label: RegExp) => {
    const found = [...container.querySelectorAll('button')].find((each) =>
      label.test(each.textContent ?? ''),
    );
    assert.ok(found, `no button ${label}`);
    return found;
  };
  const group = (name: string) => {
    const found = container.querySelector(`[aria-label="${name}"]`);
    assert.ok(found, `no ${name} group`);
    return found;
  };
  async function fill(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  return {
    text: () => container.textContent ?? '',
    button,
    group,
    fill,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the account page', () => {
  it('shows the plan as gifted and until when, and the projects with their sites', async () => {
    serving(() => DETAIL());
    const view = await mount();
    assert.match(view.text(), /Build, gifted until 31 Dec 2026/);
    assert.match(view.text(), /Bakery/);
    assert.match(view.text(), /bakery \(live\)/);
    view.unmount();
  });

  it('will not ban without a reason', async () => {
    const posts = serving(() => DETAIL());
    const view = await mount();
    const ban = view.button(/^Ban account$/);
    assert.equal(ban.disabled, true);
    const reason = view
      .group('Ban')
      .querySelector<HTMLInputElement>('input[type="text"]')!;
    await view.fill(reason, 'Phishing');
    assert.equal(ban.disabled, false);
    await act(async () => {
      ban.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(posts[0], {
      url: '/api/admin/user/ban',
      body: { userId: USER, reason: 'Phishing' },
    });
    view.unmount();
  });

  it('will not delete until the account’s own email is typed', async () => {
    const posts = serving(() => DETAIL());
    const view = await mount();
    const remove = view.button(/^Delete account$/);
    const email = view
      .group('Delete')
      .querySelector<HTMLInputElement>('input[type="email"]')!;
    assert.equal(remove.disabled, true);
    await view.fill(email, 'someone@else.com');
    assert.equal(remove.disabled, true);
    await view.fill(email, 'TARGET@example.com');
    assert.equal(remove.disabled, false);
    await act(async () => {
      remove.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(posts[0]?.url, '/api/admin/user/delete');
    assert.equal(posts[0]?.body.confirmEmail, 'TARGET@example.com');
    view.unmount();
  });

  it('says that lifting a ban republishes nothing, and names what is still held', async () => {
    serving(() =>
      DETAIL({
        ban: {
          bannedAt: '2026-09-29T00:00:00.000Z',
          bannedBy: 'admin@vibld.com',
          reason: 'Spam',
          liftedAt: null,
          liftedBy: null,
        },
      }),
    );
    const view = await mount();
    assert.match(view.text(), /does not republish the sites the ban held/);
    await act(async () => {
      view.button(/^Lift ban$/).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.match(view.text(), /Still held, not republished: bakery/);
    view.unmount();
  });
});
