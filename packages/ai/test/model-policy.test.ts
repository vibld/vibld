import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allowedModels,
  grantedIds,
  parseModelPolicy,
} from '../src/model-policy.ts';
import { MODEL_CATALOGUE } from '../src/model-catalogue.ts';

const ALL = MODEL_CATALOGUE;
const ids = (models: { id: string }[]) => models.map((m) => m.id).sort();

const POLICY = JSON.stringify({
  default: ['deepseek-flash'],
  users: { 'Chris@Drummond.com': ['claude-opus-5', 'deepseek-v4-pro'] },
  domains: { 'drummond.com': ['deepseek-flash', 'deepseek-v4-pro'] },
});

describe('parseModelPolicy', () => {
  it('treats an absent policy as no policy, not as an error', () => {
    // A deployment that wants no policy must not have to configure one.
    assert.equal(parseModelPolicy(undefined), null);
    assert.equal(parseModelPolicy(null), null);
    assert.equal(parseModelPolicy('   '), null);
  });

  it('accepts a well-formed policy', () => {
    const parsed = parseModelPolicy(POLICY);
    assert.equal(parsed?.ok, true);
    if (parsed?.ok) {
      assert.deepEqual(parsed.policy.default, ['deepseek-flash']);
      // Identities are compared lower-cased; nobody types their own address
      // the same way twice.
      assert.ok(parsed.policy.users?.['chris@drummond.com']);
    }
  });

  it('requires a default, so "everyone else" is never accidental', () => {
    const parsed = parseModelPolicy(JSON.stringify({ users: {} }));
    assert.equal(parsed?.ok, false);
    if (parsed && !parsed.ok)
      assert.match(parsed.reason, /"default" is required/);
  });

  it('reports malformed input rather than throwing', () => {
    for (const raw of [
      '{not json',
      '[]',
      '"a string"',
      JSON.stringify({ default: 'not-a-list' }),
      JSON.stringify({ default: [1, 2] }),
      JSON.stringify({ default: [], users: 'nope' }),
      JSON.stringify({ default: [], users: { a: 'nope' } }),
      JSON.stringify({ default: [], domains: [] }),
    ]) {
      const parsed = parseModelPolicy(raw);
      assert.equal(parsed?.ok, false, raw);
    }
  });
});

describe('grantedIds', () => {
  const policy = parseModelPolicy(POLICY);
  const p = policy?.ok ? policy.policy : null;

  it('matches a user exactly, whatever the casing', () => {
    assert.deepEqual(grantedIds(p!, 'chris@drummond.com'), [
      'claude-opus-5',
      'deepseek-v4-pro',
    ]);
    assert.deepEqual(grantedIds(p!, '  CHRIS@DRUMMOND.COM '), [
      'claude-opus-5',
      'deepseek-v4-pro',
    ]);
  });

  it('falls to the domain when no user matches', () => {
    assert.deepEqual(grantedIds(p!, 'someone@drummond.com'), [
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
  });

  it('prefers the user rule over the domain rule', () => {
    // Otherwise a domain grant would silently widen a named person's access.
    assert.equal(
      grantedIds(p!, 'chris@drummond.com').includes('claude-opus-5'),
      true,
    );
    assert.equal(
      grantedIds(p!, 'someone@drummond.com').includes('claude-opus-5'),
      false,
    );
  });

  it('accepts a domain written with or without the @', () => {
    const withAt = parseModelPolicy(
      JSON.stringify({ default: [], domains: { '@example.com': ['x'] } }),
    );
    assert.ok(withAt?.ok);
    if (withAt?.ok) {
      assert.deepEqual(grantedIds(withAt.policy, 'a@example.com'), ['x']);
    }
  });

  it('falls to the default for anyone unmatched', () => {
    assert.deepEqual(grantedIds(p!, 'stranger@elsewhere.com'), [
      'deepseek-flash',
    ]);
    // A principal with no domain at all must not crash the lookup.
    assert.deepEqual(grantedIds(p!, 'service-account'), ['deepseek-flash']);
    assert.deepEqual(grantedIds(p!, ''), ['deepseek-flash']);
  });
});

describe('allowedModels', () => {
  it('offers everything when no policy is configured', () => {
    assert.deepEqual(
      ids(allowedModels(null, 'anyone@example.com', ALL)),
      ids([...ALL]),
    );
  });

  it('grants only what the policy names', () => {
    const parsed = parseModelPolicy(POLICY);
    assert.deepEqual(ids(allowedModels(parsed, 'chris@drummond.com', ALL)), [
      'claude-opus-5',
      'deepseek-v4-pro',
    ]);
    assert.deepEqual(ids(allowedModels(parsed, 'stranger@x.com', ALL)), [
      'deepseek-flash',
    ]);
  });

  it('never surfaces a granted model the deployment cannot serve', () => {
    // A policy naming Opus on a deployment with no Anthropic key would
    // otherwise offer a run that fails after the user waited for it.
    const deepseekOnly = ALL.filter((m) => m.provider === 'deepseek');
    const parsed = parseModelPolicy(
      JSON.stringify({ default: ['claude-opus-5', 'deepseek-flash'] }),
    );
    assert.deepEqual(ids(allowedModels(parsed, 'a@b.com', deepseekOnly)), [
      'deepseek-flash',
    ]);
  });

  it('grants nothing when the policy names nothing', () => {
    const parsed = parseModelPolicy(JSON.stringify({ default: [] }));
    assert.deepEqual(allowedModels(parsed, 'a@b.com', ALL), []);
  });

  it('degrades a malformed policy to the cheapest, never to everything', () => {
    // Escalating on a typo would hand the most expensive model to everyone.
    // Failing to nothing would take a working product down. Cheapest does
    // neither, which is the same safe direction the spend ceiling follows.
    const broken = parseModelPolicy('{not json');
    const allowed = allowedModels(broken, 'chris@drummond.com', ALL);
    assert.equal(allowed.length, 1);
    // Asserted as a property rather than as an id: which model is cheapest
    // moves whenever the catalogue does, and pinning the id turns that into a
    // failure that says nothing about what actually broke.
    const lowestOutput = Math.min(...ALL.map((m) => m.outputMicroUsd));
    assert.equal(allowed[0]!.outputMicroUsd, lowestOutput);
    const lowestInputAtThatOutput = Math.min(
      ...ALL.filter((m) => m.outputMicroUsd === lowestOutput).map(
        (m) => m.inputMicroUsd,
      ),
    );
    assert.equal(allowed[0]!.inputMicroUsd, lowestInputAtThatOutput);
  });

  it('grants nothing on a malformed policy when nothing is deployable', () => {
    assert.deepEqual(
      allowedModels(parseModelPolicy('{bad'), 'a@b.com', []),
      [],
    );
  });
});
