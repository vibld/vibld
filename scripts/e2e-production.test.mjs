import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHEAP_MODELS,
  chooseModel,
  chooseTestUser,
  fapiFromPublishableKey,
  maskEmail,
  redact,
  spendable,
  spentBetween,
  testUserSignals,
} from './e2e-production.mjs';

const user = (id, email, extra = {}) => ({
  id,
  primary_email_address_id: `idn_${id}`,
  email_addresses: [{ id: `idn_${id}`, email_address: email }],
  created_at: 1_790_000_000_000,
  ...extra,
});

test('a +clerk_test address or test metadata is a strong mark, a word is a weak one', () => {
  assert.deepEqual(
    testUserSignals(user('a', 'chris+clerk_test@vibld.com')).strong,
    ['Clerk test address (+clerk_test)'],
  );
  assert.equal(
    testUserSignals(
      user('b', 'b@vibld.com', { private_metadata: { e2e: true } }),
    ).strong.length,
    1,
  );
  assert.equal(
    testUserSignals(
      user('c', 'c@vibld.com', { public_metadata: { role: 'test' } }),
    ).strong.length,
    1,
  );
  assert.deepEqual(testUserSignals(user('d', 'e2e-bot@vibld.com')).weak, [
    'address names it a test',
  ]);
  assert.deepEqual(
    testUserSignals(user('e', 'e@vibld.com', { first_name: 'Test' })).weak,
    ['name says test'],
  );
});

test('a word inside another word does not mark an account', () => {
  for (const email of [
    'contestant@vibld.com',
    'latest@vibld.com',
    'aqua@x.io',
  ]) {
    const { strong, weak } = testUserSignals(user('x', email));
    assert.deepEqual([...strong, ...weak], [], email);
  }
  const { strong } = testUserSignals(
    user('y', 'y@vibld.com', { private_metadata: { e2e: false } }),
  );
  assert.deepEqual(strong, []);
});

test('a banned or locked account is never chosen', () => {
  const { strong } = testUserSignals(
    user('z', 'z+clerk_test@vibld.com', { banned: true }),
  );
  assert.deepEqual(strong, []);
});

test('exactly one marked account is chosen; strong marks outrank weak ones', () => {
  const users = [
    user('user_1', 'chris@vibld.com'),
    user('user_2', 'qa@vibld.com'),
    user('user_3', 'robot+clerk_test@vibld.com'),
  ];
  const chosen = chooseTestUser(users);
  assert.equal(chosen.ok, true);
  assert.equal(chosen.user.id, 'user_3');

  const weakOnly = chooseTestUser([users[0], users[1]]);
  assert.equal(weakOnly.ok, true);
  assert.equal(weakOnly.user.id, 'user_2');
});

test('two candidates, or none, is not a choice', () => {
  const two = chooseTestUser([
    user('user_1', 'a+clerk_test@vibld.com'),
    user('user_2', 'b+clerk_test@vibld.com'),
  ]);
  assert.equal(two.ok, false);
  assert.equal(two.candidates.length, 2);
  assert.ok(two.candidates.every((c) => !c.email.startsWith('a+clerk')));

  const none = chooseTestUser([user('user_1', 'chris@vibld.com')]);
  assert.equal(none.ok, false);
  assert.match(none.problem, /No Clerk user/);
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
