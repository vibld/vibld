import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideModel, grantedFor } from '../worker/model-access.ts';

const BOTH = { ANTHROPIC_API_KEY: 'a', DEEPSEEK_API_KEY: 'd' };
const POLICY = JSON.stringify({
  default: ['deepseek-v4-flash'],
  users: { 'chris@drummond.com': ['claude-opus-5', 'deepseek-v4-pro'] },
});

describe('grantedFor', () => {
  it('offers everything configured when no policy is set', () => {
    const granted = grantedFor(BOTH, 'anyone@example.com');
    assert.equal(granted.length, 3);
  });

  it('applies both filters: deployable, then granted', () => {
    // A policy naming Opus on a DeepSeek-only deployment must not offer it.
    const granted = grantedFor(
      {
        DEEPSEEK_API_KEY: 'd',
        VIBLD_MODEL_POLICY: JSON.stringify({
          default: ['claude-opus-5', 'deepseek-v4-flash'],
        }),
      },
      'a@b.com',
    );
    assert.deepEqual(
      granted.map((m) => m.id),
      ['deepseek-v4-flash'],
    );
  });
});

describe('decideModel', () => {
  const env = { ...BOTH, VIBLD_MODEL_POLICY: POLICY };

  it('honours a choice the principal is granted', () => {
    const decision = decideModel(
      env,
      'chris@drummond.com',
      'claude-opus-5',
      'deepseek-v4-flash',
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.model, 'claude-opus-5');
  });

  it('refuses a real, deployable model the principal is not granted', () => {
    // This is the whole feature. The picker hides it; this is what stops it
    // being used by anyone who edits the request.
    const decision = decideModel(
      env,
      'stranger@x.com',
      'claude-opus-5',
      'deepseek-v4-flash',
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      // The identity is named: a policy keyed on the wrong address is the
      // likeliest way to lock yourself out, and the error has to say which
      // address it matched on.
      assert.match(decision.error, /stranger@x\.com/);
    }
  });

  it('never falls back to a default the principal may not use', () => {
    // The deployment default is Opus here, but this person is only granted
    // Flash. Falling back to the default would hand them what the policy
    // withheld -- the exact failure this exists to prevent.
    const decision = decideModel(env, 'stranger@x.com', null, 'claude-opus-5');
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.model, 'deepseek-v4-flash');
  });

  it('uses the deployment default when the principal is granted it', () => {
    const decision = decideModel(
      env,
      'chris@drummond.com',
      null,
      'deepseek-v4-pro',
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.model, 'deepseek-v4-pro');
  });

  it('refuses everything when the principal is granted nothing', () => {
    const decision = decideModel(
      { ...BOTH, VIBLD_MODEL_POLICY: JSON.stringify({ default: [] }) },
      'nobody@x.com',
      null,
      'claude-opus-5',
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      assert.match(decision.error, /No model is available to nobody@x\.com/);
      assert.match(decision.error, /Check the policy/);
    }
  });

  it('degrades a malformed policy to the cheapest, for everyone', () => {
    // Escalating on a typo would hand Opus to every caller.
    const broken = { ...BOTH, VIBLD_MODEL_POLICY: '{not json' };
    for (const who of ['chris@drummond.com', 'stranger@x.com']) {
      const decision = decideModel(broken, who, null, 'claude-opus-5');
      assert.equal(decision.ok, true, who);
      if (decision.ok) assert.equal(decision.model, 'deepseek-v4-flash');
    }
    // And a chosen expensive model is still refused under a broken policy.
    const refused = decideModel(
      broken,
      'chris@drummond.com',
      'claude-opus-5',
      'x',
    );
    assert.equal(refused.ok, false);
  });

  it('is unaffected by how the caller cases their identity', () => {
    for (const who of ['CHRIS@DRUMMOND.COM', ' chris@Drummond.com ']) {
      const decision = decideModel(
        env,
        who,
        'claude-opus-5',
        'deepseek-v4-flash',
      );
      assert.equal(decision.ok, true, who);
    }
  });

  it('treats the unknown-identity bucket as an ordinary unnamed caller', () => {
    // requireAccess falls back to 'unknown' for a token with no email. That
    // must land on the default grant, never on a named user's.
    const decision = decideModel(
      env,
      'unknown',
      'claude-opus-5',
      'deepseek-v4-flash',
    );
    assert.equal(decision.ok, false);
  });
});
