import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readBanRefusal } from '../src/access/access-client.ts';
import {
  confirmsEmail,
  describeAuditEntry,
  describePlan,
  fetchAdminUser,
  parseOverrideField,
  postAdminAction,
  readAdminUser,
} from '../src/admin/admin-users-client.ts';
import {
  adminUserIdFromPath,
  adminUserPath,
  isAdminArea,
  isAdminPath,
} from '../src/admin/route.ts';
import { describeGift } from '../src/billing/billing-client.ts';
import type { BillingStatus } from '../src/billing/billing-client.ts';

/**
 * The browser half of the admin controls over one account
 * (docs/decisions.md D73): where the page lives, how the route's answers
 * are read, and what the page and the billing panel say.
 */

const USER = 'user_2abc123';

describe('the account page’s address', () => {
  it('is the Clerk user id under /admin/users, never an email', () => {
    assert.equal(adminUserPath(USER), `/admin/users/${USER}`);
    assert.equal(adminUserIdFromPath(`/admin/users/${USER}`), USER);
    assert.equal(adminUserIdFromPath(`/admin/users/${USER}/`), USER);
    assert.equal(adminUserIdFromPath('/admin/users/someone@example.com'), null);
    // A self-hosted copy's ids (D123): the owner, and a Cloudflare Access id.
    assert.equal(adminUserIdFromPath('/admin/users/owner'), 'owner');
    assert.equal(
      adminUserIdFromPath('/admin/users/7335d417-61da-459d-899c-0a01c76a2f94'),
      '7335d417-61da-459d-899c-0a01c76a2f94',
    );
    assert.equal(adminUserIdFromPath('/admin/users/%3Cscript%3E'), null);
    assert.equal(adminUserIdFromPath('/admin/users/'), null);
    assert.equal(adminUserIdFromPath(`/admin/users/${USER}/x`), null);
  });

  it('is part of the admin area, and is not the tools page', () => {
    assert.equal(isAdminArea(`/admin/users/${USER}`), true);
    assert.equal(isAdminArea('/admin'), true);
    assert.equal(isAdminArea('/p/project'), false);
    // The tools page's own rule is unchanged (`admin-route.test.ts`).
    assert.equal(isAdminPath(`/admin/users/${USER}`), false);
  });
});

const DETAIL = {
  userId: USER,
  email: 'target@example.com',
  createdAt: 1_700_000_000_000,
  lastSignInAt: null,
  clerkBanned: false,
  plan: {
    tier: 'ship',
    gifted: true,
    subscriptionTier: 'build',
    currentPeriodEnd: null,
    gift: {
      tier: 'ship',
      endsAt: '2026-12-31T23:59:59.999Z',
      grantedBy: 'admin@vibld.com',
      reason: null,
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
    monthlyAllowanceMicroUsd: 40_000_000,
    tierMonthlyAllowanceMicroUsd: 40_000_000,
    trial: false,
  },
  spend: { monthMicroUsd: 1_000, creditRemainingMicroUsd: 0 },
  suspended: false,
  ban: null,
  deletion: null,
  projects: [
    { id: 'p1', name: 'Bakery', archived: false, updatedAt: 'x', site: null },
  ],
  runs: [
    {
      runId: 'r1',
      projectName: 'Bakery',
      state: 'failed',
      startedAt: 'x',
      stop: 'provider-error',
    },
  ],
  audit: [
    {
      id: 1,
      at: '2026-09-29T00:00:00.000Z',
      adminEmail: 'admin@vibld.com',
      action: 'gift',
      targetUserId: USER,
      target: null,
      reason: 'Partner',
      detail: { tier: 'ship', endsAt: '2026-12-31T23:59:59.999Z' },
    },
    { nonsense: true },
  ],
};

describe('reading the account', () => {
  it('reads the route’s answer and drops rows it cannot read', () => {
    const user = readAdminUser(DETAIL);
    assert.ok(user);
    assert.equal(user.plan.tier, 'ship');
    assert.equal(user.plan.gift?.tier, 'ship');
    assert.equal(user.audit.length, 1);
    assert.equal(user.runs[0]?.stop, 'provider-error');
  });

  it('refuses an answer with no plan rather than guessing one', () => {
    assert.equal(readAdminUser({ userId: USER }), null);
    assert.equal(readAdminUser([]), null);
  });

  it('asks by user id or by email', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(DETAIL));
    }) as unknown as typeof fetch;
    const token = async () => null;
    assert.equal(
      (await fetchAdminUser({ userId: USER }, fetchImpl, token)).ok,
      true,
    );
    await fetchAdminUser({ email: 'a+b@example.com' }, fetchImpl, token);
    assert.deepEqual(urls, [
      `/api/admin/user/detail?userId=${USER}`,
      '/api/admin/user/detail?email=a%2Bb%40example.com',
    ]);
  });

  it('carries a refusal’s own sentence', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'Not authorized.' }), {
        status: 403,
      })) as unknown as typeof fetch;
    assert.deepEqual(
      await postAdminAction(
        '/api/admin/user/ban',
        { userId: USER },
        fetchImpl,
        async () => null,
      ),
      { ok: false, error: 'Not authorized.' },
    );
  });
});

describe('what the account page says', () => {
  it('says a plan is gifted, until when, and what is paid for underneath', () => {
    const user = readAdminUser(DETAIL)!;
    assert.equal(
      describePlan(user.plan),
      'Ship, gifted until Dec 31, 2026; pays for Build',
    );
    assert.equal(
      describePlan({
        ...user.plan,
        gifted: false,
        gift: null,
        subscriptionTier: null,
        tier: 'free',
      }),
      'Free',
    );
  });

  it('describes an audit row without an email other than the admin’s', () => {
    const user = readAdminUser(DETAIL)!;
    const line = describeAuditEntry(user.audit[0]!);
    assert.match(line, /Gave a plan/);
    assert.match(line, /Ship until Dec 31, 2026/);
    assert.match(line, /"Partner"/);
    assert.match(line, /by admin@vibld\.com/);
    assert.doesNotMatch(line, /target@example\.com/);
  });

  it('wakes the delete button only for the account’s own address', () => {
    assert.equal(
      confirmsEmail('Target@Example.com ', 'target@example.com'),
      true,
    );
    assert.equal(
      confirmsEmail('other@example.com', 'target@example.com'),
      false,
    );
    assert.equal(confirmsEmail('', 'target@example.com'), false);
    assert.equal(confirmsEmail('x@example.com', null), false);
  });

  it('reads an override field: blank for the plan, a number, or nothing', () => {
    assert.deepEqual(parseOverrideField('', 'count'), {
      ok: true,
      value: null,
    });
    assert.deepEqual(parseOverrideField('5', 'count'), { ok: true, value: 5 });
    assert.deepEqual(parseOverrideField('2.5', 'count'), { ok: false });
    assert.deepEqual(parseOverrideField('-1', 'usd'), { ok: false });
    assert.deepEqual(parseOverrideField('12.34', 'usd'), {
      ok: true,
      value: 1234,
    });
  });
});

describe('the billing panel', () => {
  const base: BillingStatus = {
    tier: 'build',
    allowanceMicroUsd: 10_000_000,
    spentMicroUsd: 0,
    topupRemainingMicroUsd: 0,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasStripeCustomer: false,
    billingConfigured: true,
  };

  it('says a plan is gifted and until when', () => {
    assert.equal(
      describeGift({
        ...base,
        planTier: 'free',
        gift: {
          tier: 'build',
          endsAt: '2026-12-31T23:59:59.999Z',
          inUse: true,
        },
      }),
      'Build plan gifted until Dec 31, 2026.',
    );
    assert.equal(
      describeGift({
        ...base,
        gift: { tier: 'build', endsAt: null, inUse: false },
      }),
      'Build plan gifted with no end date, alongside the plan you pay for.',
    );
  });

  it('says nothing without a gift, or to a Worker that sends none', () => {
    assert.equal(describeGift(base), null);
    assert.equal(describeGift({ ...base, gift: null }), null);
  });
});

describe('the shell and a banned account', () => {
  it('recognises the ban refusal and keeps its sentence', () => {
    assert.deepEqual(
      readBanRefusal(403, {
        reason: 'account-banned',
        error: 'This account has been banned from vibld.',
      }),
      { message: 'This account has been banned from vibld.' },
    );
  });

  it('does not take any other refusal for one', () => {
    assert.equal(readBanRefusal(403, { reason: 'deletion-scheduled' }), null);
    assert.equal(readBanRefusal(401, { reason: 'account-banned' }), null);
    assert.equal(readBanRefusal(403, null), null);
  });
});
