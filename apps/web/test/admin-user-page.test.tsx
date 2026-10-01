import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import {
  describeAuditEntry,
  describeStopBuilds,
  formatMonth,
  readAdminUser,
} from '../src/admin/admin-users-client.ts';
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
  models: { plan: null, extra: null },
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
      site: {
        slug: 'bakery',
        state: 'live',
        url: 'https://bakery.vibld-preview.dev/',
      },
    },
  ],
  runs: [],
  running: [],
  canStopBuilds: true,
  spendByMonth: [
    { month: '2026-09', costMicroUsd: 1_250_000, runs: 3 },
    { month: '2026-07', costMicroUsd: 40_000, runs: 1 },
  ],
  github: {
    connection: {
      login: 'octo',
      connectedAt: '2026-09-02T00:00:00.000Z',
      revokedAt: null,
    },
    repositories: [
      {
        projectId: 'p1',
        projectName: 'Bakery',
        owner: 'octo',
        repo: 'bakery-site',
        defaultBranch: 'main',
        grantedAt: '2026-09-02T00:00:00.000Z',
        expiresAt: '2026-12-02T00:00:00.000Z',
        revokedAt: null,
      },
    ],
  },
  audit: [],
  ...over,
});

const MODEL_ACCESS = {
  catalog: [
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      provider: 'anthropic',
      deployable: true,
    },
    {
      id: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      provider: 'openai',
      deployable: true,
    },
    {
      id: 'deepseek-flash',
      label: 'DeepSeek Flash',
      provider: 'deepseek',
      deployable: false,
    },
  ],
  plans: { free: ['gpt-6-luna'], build: [], ship: [] },
  saved: null,
  policySet: true,
};

function serving(
  detail: () => unknown,
  answer: (url: string) => unknown = () => ({
    ok: true,
    userId: USER,
    clerk: { ok: true },
    heldSites: ['bakery'],
  }),
) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return reply(answer(url));
    }
    if (url.includes('/api/admin/user/detail')) return reply(detail());
    if (url === '/api/admin/models') return reply(MODEL_ACCESS);
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
    assert.match(view.text(), /Build, gifted until Dec 31, 2026/);
    assert.match(view.text(), /Bakery/);
    assert.match(view.text(), /bakery \(live\)/);
    view.unmount();
  });

  it('shows spend by month, GitHub, and links a live site', async () => {
    serving(() => DETAIL());
    const view = await mount();
    const spend = view.group('Spend by month');
    const cells = [...spend.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    );
    assert.deepEqual(cells, [
      ['Sep 2026', '3', '$1.25'],
      ['Jul 2026', '1', '$0.04'],
    ]);
    const github = view.group('GitHub').textContent ?? '';
    assert.match(github, /Signed in as octo Sep 2, 2026/);
    assert.match(
      github,
      /octo\/bakery-site \(main\) · Bakery · access expires Dec 2, 2026/,
    );
    const link = view.group('Projects (1)').querySelector('a');
    assert.equal(
      link?.getAttribute('href'),
      'https://bakery.vibld-preview.dev/',
    );
    view.unmount();
  });

  it('stops running builds, and only when something is running', async () => {
    const posts = serving(
      () =>
        DETAIL({
          running: [
            {
              runId: 'run_1',
              projectName: 'Bakery',
              state: 'building',
              startedAt: '2026-09-29T00:00:00.000Z',
            },
          ],
        }),
      () => ({
        ok: true,
        userId: USER,
        builds: { stopped: ['run_1'], failed: [] },
        audited: true,
      }),
    );
    const view = await mount();
    assert.match(
      view.group('Running builds (1)').textContent ?? '',
      /Bakery · building/,
    );
    await act(async () => {
      view.button(/^Stop builds$/).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(posts[0], {
      url: '/api/admin/user/stop-builds',
      body: { userId: USER, reason: '' },
    });
    assert.match(view.text(), /Stopped 1 build\./);
    view.unmount();

    serving(() => DETAIL());
    const idle = await mount();
    assert.equal(idle.button(/^Stop builds$/).disabled, true);
    idle.unmount();
  });

  it('draws no stop where the deployment runs no builds', async () => {
    serving(() => DETAIL({ canStopBuilds: false }));
    const view = await mount();
    assert.doesNotMatch(view.text(), /Stop builds/);
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

describe('what the deeper page says', () => {
  it('names a month, and what a stop did', () => {
    assert.equal(formatMonth('2026-01'), 'Jan 2026');
    assert.deepEqual(
      describeStopBuilds({ builds: { stopped: [], failed: [] } }),
      ['No builds were running.'],
    );
    assert.deepEqual(
      describeStopBuilds({ builds: { stopped: ['a', 'b'], failed: ['c'] } }),
      ['Stopped 2 builds.', 'Still running, try again: c.'],
    );
    assert.match(
      describeAuditEntry({
        id: 1,
        at: '2026-10-01T00:00:00.000Z',
        adminEmail: 'admin@example.com',
        action: 'stop-builds',
        targetUserId: USER,
        target: null,
        reason: 'Looping',
        detail: { stopped: 2, stillRunning: 1 },
      }),
      /^Stopped running builds \(user_2abc123\) · 2 stopped, 1 still running · "Looping" · by admin@example.com$/,
    );
  });

  it('drops a site address that is not https, and fields it cannot read', () => {
    const user = readAdminUser(
      DETAIL({
        projects: [
          {
            id: 'p1',
            name: 'Bakery',
            archived: false,
            updatedAt: '',
            site: { slug: 'bakery', state: 'live', url: 'javascript:alert(1)' },
          },
        ],
        spendByMonth: [{ month: 'September', costMicroUsd: 1 }],
        github: 'nope',
      }),
    )!;
    assert.equal(user.projects[0]!.site!.url, null);
    assert.deepEqual(user.spendByMonth, []);
    assert.deepEqual(user.github, { connection: null, repositories: [] });
  });
});

describe('an account’s extra models (D136)', () => {
  it('says what the plan includes and posts the ticked extras', async () => {
    const posts = serving(() =>
      DETAIL({
        models: {
          plan: ['gpt-6-luna'],
          extra: {
            models: ['deepseek-flash'],
            updatedBy: 'admin@example.com',
            updatedAt: '2026-10-01T05:00:00.000Z',
          },
        },
      }),
    );
    const view = await mount();
    const models = view.group('Models');
    assert.match(models.textContent ?? '', /plan includes: GPT-6 Luna\./);
    assert.match(
      models.textContent ?? '',
      /DeepSeek Flash \(no key, not offered\)/,
    );
    const boxes = [
      ...models.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    assert.deepEqual(
      boxes.map((box) => box.checked),
      [false, false, true],
    );
    await act(async () => {
      boxes[0]!.click();
    });
    await act(async () => {
      view.button(/^Save models$/).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(posts[0], {
      url: '/api/admin/user/models',
      body: {
        userId: USER,
        models: ['claude-sonnet-5', 'deepseek-flash'],
        reason: '',
      },
    });
    view.unmount();
  });

  it('says the policy decides while no plan models are saved', async () => {
    serving(() => DETAIL());
    const view = await mount();
    assert.match(
      view.group('Models').textContent ?? '',
      /VIBLD_MODEL_POLICY decides the Build plan's models/,
    );
    view.unmount();
  });
});
