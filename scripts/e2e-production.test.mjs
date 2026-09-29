import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHEAP_MODELS,
  chooseModel,
  chooseTestUser,
  fapiFromPublishableKey,
  isThrowaway,
  leftoverThrowaways,
  maskEmail,
  redact,
  retryDelayMs,
  spendable,
  spentBetween,
  THROWAWAY_KEY,
  throwawayEmail,
  throwawayUserBody,
} from './e2e-production.mjs';

const user = (id, email, extra = {}) => ({
  id,
  primary_email_address_id: `idn_${id}`,
  email_addresses: [{ id: `idn_${id}`, email_address: email }],
  created_at: 1_790_000_000_000,
  ...extra,
});

test('a throwaway account is made marked, passwordless, on vibld.com', () => {
  const email = throwawayEmail('20260929T1300', 'A1b2');
  assert.equal(email, 'e2e-throwaway-20260929t1300-a1b2@vibld.com');
  const body = throwawayUserBody({ email, runId: '42', now: 't' });
  assert.deepEqual(body.email_address, [email]);
  assert.equal(body.skip_password_requirement, true);
  assert.deepEqual(body.private_metadata[THROWAWAY_KEY], {
    run: '42',
    createdAt: 't',
  });
  assert.equal(isThrowaway({ private_metadata: body.private_metadata }), true);
});

test('only an account carrying the mark counts as a throwaway', () => {
  assert.equal(isThrowaway(user('a', 'e2e@vibld.com')), false);
  assert.equal(
    isThrowaway(
      user('b', 'b@vibld.com', { public_metadata: { [THROWAWAY_KEY]: {} } }),
    ),
    false,
  );
  assert.equal(
    isThrowaway(
      user('c', 'c@vibld.com', { private_metadata: { [THROWAWAY_KEY]: true } }),
    ),
    false,
  );
});

test('only old throwaways are cleared as leftovers', () => {
  const now = 1_790_000_000_000;
  const mark = { private_metadata: { [THROWAWAY_KEY]: { run: '1' } } };
  const users = [
    user('old', 'o@vibld.com', { ...mark, created_at: now - 3 * 3_600_000 }),
    user('new', 'n@vibld.com', { ...mark, created_at: now - 60_000 }),
    user('chris', 'chris@vibld.com', { created_at: now - 10 * 3_600_000 }),
  ];
  assert.deepEqual(
    leftoverThrowaways(users, now).map((u) => u.id),
    ['old'],
  );
});

test('a named user wins, by id or by address', () => {
  const users = [
    user('user_1', 'a+clerk_test@vibld.com'),
    user('user_2', 'b+clerk_test@vibld.com'),
  ];
  assert.equal(chooseTestUser(users, 'user_2').user.id, 'user_2');
  assert.equal(
    chooseTestUser(users, 'A+Clerk_Test@vibld.com').user.id,
    'user_1',
  );
  assert.equal(chooseTestUser(users, 'user_9').ok, false);
});

test('the cheapest granted model is chosen, and nothing dearer unless named', () => {
  const config = (ids, defaultModel = ids[0]) => ({
    models: ids.map((id) => ({ id })),
    defaultModel,
  });
  assert.equal(
    chooseModel(config(['claude-opus', 'deepseek-flash', 'gpt-6-luna'])).model,
    CHEAP_MODELS[0],
  );
  assert.equal(
    chooseModel(config(['claude-opus', 'deepseek-flash'])).model,
    'deepseek-flash',
  );
  assert.equal(chooseModel(config(['claude-opus'])).ok, false);
  assert.equal(chooseModel(config(['claude-opus']), 'claude-opus').ok, true);
  assert.equal(chooseModel(config(['gpt-6-luna']), 'claude-opus').ok, false);
  // One model is not listed in the picker, and is still the one used.
  assert.equal(
    chooseModel({ models: [], defaultModel: 'gpt-6-luna' }).model,
    'gpt-6-luna',
  );
});

test('spend is the allowance used plus the credit drawn down', () => {
  const before = {
    allowanceMicroUsd: 5_000_000,
    spentMicroUsd: 4_900_000,
    topupRemainingMicroUsd: 1_000_000,
  };
  const after = {
    allowanceMicroUsd: 5_000_000,
    spentMicroUsd: 5_000_000,
    topupRemainingMicroUsd: 750_000,
  };
  assert.equal(spendable(before), 1_100_000);
  assert.equal(spentBetween(before, after), 350_000);
  // A month that rolls over mid-run is not money back.
  assert.equal(
    spentBetween(before, { ...after, spentMicroUsd: 10_000 }),
    250_000,
  );
});

test('the Frontend API host is read from a publishable key', () => {
  const key = `pk_live_${Buffer.from('clerk.vibld.com$').toString('base64')}`;
  assert.equal(fapiFromPublishableKey(key), 'clerk.vibld.com');
  assert.equal(fapiFromPublishableKey(''), null);
  assert.equal(fapiFromPublishableKey('sk_live_abc'), null);
});

test('credentials are blanked before anything is logged', () => {
  const token = 'abcdefghijklmnop';
  const text = [
    `https://clerk.vibld.com/v1/client?__clerk_testing_token=${token}&x=1`,
    'Authorization: Bearer abc.def.ghi',
    'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJl',
    `https://app.vibld.com/s/${'a'.repeat(43)}`,
    'sk_live_SECRET123',
    `minted ${token}`,
  ].join('\n');
  const out = redact(text, [token]);
  assert.ok(!out.includes(token));
  assert.ok(!out.includes('abc.def.ghi'));
  assert.ok(!out.includes('eyJzdWIi'));
  assert.ok(!out.includes('a'.repeat(43)));
  assert.ok(!out.includes('SECRET123'));
});

test('an address is shown without giving it away', () => {
  assert.equal(maskEmail('chris+clerk_test@vibld.com'), 'ch…@vibld.com');
  assert.equal(maskEmail(''), '(no address)');
});

test('a 429 waits what Retry-After asks, or a doubling two seconds, at most twenty', () => {
  assert.equal(retryDelayMs('3', 0), 3000);
  assert.equal(retryDelayMs(null, 0), 2000);
  assert.equal(retryDelayMs(null, 2), 8000);
  assert.equal(retryDelayMs('600', 0), 20_000);
  assert.equal(retryDelayMs('soon', 1), 4000);
});
