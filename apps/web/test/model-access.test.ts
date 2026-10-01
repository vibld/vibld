import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODEL_CATALOGUE } from '@vibld/ai/model-catalogue';
import {
  DRAFT_MODEL,
  FREE_PLAN_MODELS_NOTE,
  TIER_MODELS,
  decideModel,
  unservableConfiguredModel,
  draftModelFor,
  grantedFor,
  planWithholdsModels,
} from '../worker/model-access.ts';

/**
 * Every model a key serves. The local model is configured by an address
 * rather than a key (D124), and is tested in local-model.test.ts.
 */
const KEYED_MODELS = MODEL_CATALOGUE.filter((m) => m.provider !== 'local');

/** Every provider keyed, so "everything configured" really means everything. */
const ALL_KEYED = {
  ANTHROPIC_API_KEY: 'a',
  DEEPSEEK_API_KEY: 'd',
  OPENAI_API_KEY: 'o',
};
const POLICY = JSON.stringify({
  default: ['deepseek-flash'],
  users: { 'sam@example.com': ['claude-opus-5', 'deepseek-v4-pro'] },
});

describe('grantedFor', () => {
  it('offers everything configured when no policy is set', () => {
    const granted = grantedFor(ALL_KEYED, 'anyone@example.com', 'build');
    // Asserted against the catalogue rather than a literal: the count moves
    // whenever a model is added, and a hard-coded number turns that into a
    // failure that says nothing about what actually changed.
    assert.equal(granted.length, KEYED_MODELS.length);
    assert.ok(granted.length >= 6);
  });

  it('applies both filters: deployable, then granted', () => {
    // A policy naming Opus on a DeepSeek-only deployment must not offer it.
    const granted = grantedFor(
      {
        DEEPSEEK_API_KEY: 'd',
        VIBLD_MODEL_POLICY: JSON.stringify({
          default: ['claude-opus-5', 'deepseek-flash'],
        }),
      },
      'a@b.com',
      'build',
    );
    assert.deepEqual(
      granted.map((m) => m.id),
      ['deepseek-flash'],
    );
  });
});

describe('decideModel', () => {
  const env = { ...ALL_KEYED, VIBLD_MODEL_POLICY: POLICY };

  it('honours a choice the principal is granted', () => {
    const decision = decideModel(
      env,
      'sam@example.com',
      'build',
      'claude-opus-5',
      'deepseek-flash',
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
      'build',
      'claude-opus-5',
      'deepseek-flash',
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
    const decision = decideModel(
      env,
      'stranger@x.com',
      'build',
      null,
      'claude-opus-5',
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.model, 'deepseek-flash');
  });

  it('falls back within the default family before anything else (#214 review)', () => {
    // A policy from when Opus 5 was the default: Opus 5 and Fable, not 5.5.
    // Fable is first in the catalogue, and is not what the default meant.
    const policy = JSON.stringify({
      default: ['claude-fable-5-1', 'claude-opus-5'],
    });
    const decision = decideModel(
      { ...ALL_KEYED, VIBLD_MODEL_POLICY: policy },
      'anyone@example.com',
      'build',
      null,
      'claude-opus-5-5',
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.model, 'claude-opus-5');
  });

  it('uses the deployment default when the principal is granted it', () => {
    const decision = decideModel(
      env,
      'sam@example.com',
      'build',
      null,
      'deepseek-v4-pro',
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.model, 'deepseek-v4-pro');
  });

  it('refuses everything when the principal is granted nothing', () => {
    const decision = decideModel(
      { ...ALL_KEYED, VIBLD_MODEL_POLICY: JSON.stringify({ default: [] }) },
      'nobody@x.com',
      'build',
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
    const broken = { ...ALL_KEYED, VIBLD_MODEL_POLICY: '{not json' };
    // Which model is cheapest moves whenever the catalogue does, so this
    // computes it the way allowedModels does rather than pinning an id.
    const lowestOutput = Math.min(...KEYED_MODELS.map((m) => m.outputMicroUsd));
    const cheapest = KEYED_MODELS.filter(
      (m) => m.outputMicroUsd === lowestOutput,
    ).sort((a, b) => a.inputMicroUsd - b.inputMicroUsd)[0]!;
    for (const who of ['sam@example.com', 'stranger@x.com']) {
      const decision = decideModel(broken, who, 'build', null, 'claude-opus-5');
      assert.equal(decision.ok, true, who);
      if (decision.ok) assert.equal(decision.model, cheapest.id);
    }
    // And a chosen expensive model is still refused under a broken policy.
    const refused = decideModel(
      broken,
      'sam@example.com',
      'build',
      'claude-opus-5',
      'x',
    );
    assert.equal(refused.ok, false);
  });

  it('is unaffected by how the caller cases their identity', () => {
    for (const who of ['SAM@EXAMPLE.COM', ' sam@example.com ']) {
      const decision = decideModel(
        env,
        who,
        'build',
        'claude-opus-5',
        'deepseek-flash',
      );
      assert.equal(decision.ok, true, who);
    }
  });

  it('treats the unknown-identity bucket as an ordinary unnamed caller', () => {
    // resolvePrincipal falls back to 'unknown' for a token with no verified
    // email. That must land on the default grant, never on a named user's.
    const decision = decideModel(
      env,
      'unknown',
      'build',
      'claude-opus-5',
      'deepseek-flash',
    );
    assert.equal(decision.ok, false);
  });
});

describe('a renamed model id reaching the endpoint', () => {
  it('grants and runs it, resolved to the id the provider has', () => {
    // Two failures in one: a deployment whose policy still names the old id
    // would 403 on every request, and a saved or bookmarked request naming it
    // would otherwise be sent to DeepSeek as a model that does not exist.
    const legacyPolicy = JSON.stringify({ default: ['deepseek-v4-flash'] });
    const env = { ...ALL_KEYED, VIBLD_MODEL_POLICY: legacyPolicy };

    const granted = grantedFor(env, 'sam@example.com', 'build');
    assert.deepEqual(
      granted.map((model) => model.id),
      ['deepseek-flash'],
    );

    const decision = decideModel(
      env,
      'sam@example.com',
      'build',
      'deepseek-v4-flash',
      'deepseek-flash',
    );
    assert.ok(decision.ok);
    assert.equal(decision.model, 'deepseek-flash');
  });

  it('still refuses a model the policy does not grant', () => {
    // The alias resolves ids; it must not widen what anyone may spend on.
    const env = {
      ...ALL_KEYED,
      VIBLD_MODEL_POLICY: JSON.stringify({ default: ['deepseek-v4-flash'] }),
    };
    const decision = decideModel(
      env,
      'sam@example.com',
      'build',
      'claude-opus-5',
      'deepseek-flash',
    );
    assert.equal(decision.ok, false);
  });
});

describe('draftModelFor', () => {
  // A build's draft is drawn by the cheapest page-writing model whatever
  // the build runs on (Chris, 2026-09-28), where the policy allows it.
  it('names DeepSeek Flash where it is deployed and granted', () => {
    assert.equal(DRAFT_MODEL, 'deepseek-flash');
    assert.equal(
      draftModelFor(ALL_KEYED, 'anyone@example.com', 'build'),
      DRAFT_MODEL,
    );
  });

  it('falls back to null where the policy withholds it', () => {
    const env = {
      ...ALL_KEYED,
      VIBLD_MODEL_POLICY: JSON.stringify({ default: ['gpt-6-sol'] }),
    };
    assert.equal(draftModelFor(env, 'anyone@example.com', 'build'), null);
  });

  it('falls back to null where DeepSeek is not deployed', () => {
    assert.equal(
      draftModelFor({ OPENAI_API_KEY: 'o' }, 'anyone@example.com', 'build'),
      null,
    );
  });
});

describe('a Free account (D66)', () => {
  // The production shape: every provider keyed, GPT-6 Sol the default, and
  // no policy, which used to mean everyone may use everything.
  const env = { ...ALL_KEYED, VIBLD_MODEL: 'gpt-6-sol' };

  it('is granted GPT-6 Luna and nothing else, with no policy set', () => {
    assert.deepEqual(TIER_MODELS.free, ['gpt-6-luna']);
    assert.deepEqual(
      grantedFor(env, 'anyone@example.com', 'free').map((m) => m.id),
      ['gpt-6-luna'],
    );
    assert.equal(planWithholdsModels(env, 'anyone@example.com', 'free'), true);
  });

  it('is refused Sol by name, and told what the plan includes', () => {
    // Refused, as every ungranted model is, rather than quietly run on Luna.
    const decision = decideModel(
      env,
      'anyone@example.com',
      'free',
      'gpt-6-sol',
      'gpt-6-sol',
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      assert.equal(decision.error, FREE_PLAN_MODELS_NOTE);
    }
  });

  it('runs on Luna when it names no model, not on the Sol default', () => {
    const decision = decideModel(
      env,
      'anyone@example.com',
      'free',
      null,
      'gpt-6-sol',
    );
    assert.ok(decision.ok);
    assert.equal(decision.model, 'gpt-6-luna');
  });

  it('cannot be widened by the policy, only narrowed', () => {
    const wide = JSON.stringify({ default: ['gpt-6-sol', 'gpt-6-luna'] });
    assert.deepEqual(
      grantedFor(
        { ...env, VIBLD_MODEL_POLICY: wide },
        'sam@example.com',
        'free',
      ).map((m) => m.id),
      ['gpt-6-luna'],
    );
    // A policy that already holds somebody to Luna leaves the plan nothing
    // to withhold, so the builder promises no upgrade that changes nothing.
    const narrow = JSON.stringify({ default: ['gpt-6-luna'] });
    assert.equal(
      planWithholdsModels(
        { ...env, VIBLD_MODEL_POLICY: narrow },
        'sam@example.com',
        'free',
      ),
      false,
    );
  });

  it('says so when the deployment cannot serve Luna at all', () => {
    const decision = decideModel(
      { ANTHROPIC_API_KEY: 'a' },
      'anyone@example.com',
      'free',
      null,
      'claude-opus-5-5',
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.match(decision.error, /GPT-6 Luna/);
  });

  it('draws its draft on Luna, since Flash is not its to use', () => {
    assert.equal(draftModelFor(env, 'anyone@example.com', 'free'), null);
    // null sends the draft through decideModel with the build's model.
    const decision = decideModel(
      env,
      'anyone@example.com',
      'free',
      'gpt-6-luna',
      'gpt-6-sol',
    );
    assert.ok(decision.ok);
    assert.equal(decision.model, 'gpt-6-luna');
  });

  it('leaves every paid tier with every model it had', () => {
    for (const tier of ['build', 'ship'] as const) {
      assert.equal(
        grantedFor(env, 'anyone@example.com', tier).length,
        KEYED_MODELS.length,
        tier,
      );
      const decision = decideModel(
        env,
        'anyone@example.com',
        tier,
        'gpt-6-sol',
        'gpt-6-sol',
      );
      assert.ok(decision.ok, tier);
      assert.equal(decision.model, 'gpt-6-sol');
      assert.equal(planWithholdsModels(env, 'anyone@example.com', tier), false);
      assert.equal(draftModelFor(env, 'anyone@example.com', tier), DRAFT_MODEL);
    }
  });

  it('is not held to Luna where the deployment sells no plans', () => {
    // `tierOf` answers null there: no paid plan exists to unlock anything.
    assert.equal(
      grantedFor(env, 'anyone@example.com', null).length,
      KEYED_MODELS.length,
    );
    assert.equal(planWithholdsModels(env, 'anyone@example.com', null), false);
  });
});

describe('a VIBLD_MODEL the deployment cannot serve (D91)', () => {
  const anthropicOnly = { ANTHROPIC_API_KEY: 'a', VIBLD_MODEL: 'gpt-6-sol' };

  it('refuses rather than falling back to the first model it can serve', () => {
    // It used to run on Claude Fable 5.1, the dearest Anthropic model.
    const decision = decideModel(
      anthropicOnly,
      'me@example.com',
      null,
      null,
      'gpt-6-sol',
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 503);
      assert.match(decision.error, /no OPENAI_API_KEY/);
      assert.match(decision.error, /VIBLD_MODEL/);
    }
  });

  it('refuses a model the catalogue does not know', () => {
    assert.match(
      unservableConfiguredModel({ ...ALL_KEYED, VIBLD_MODEL: 'gpt-99' }) ?? '',
      /not a model vibld knows/,
    );
  });

  it('says nothing when the model is served, or none is named', () => {
    assert.equal(
      unservableConfiguredModel({ ...ALL_KEYED, VIBLD_MODEL: 'gpt-6-sol' }),
      null,
    );
    assert.equal(unservableConfiguredModel({ ANTHROPIC_API_KEY: 'a' }), null);
    assert.equal(
      unservableConfiguredModel({ ANTHROPIC_API_KEY: 'a', VIBLD_MODEL: ' ' }),
      null,
    );
    const decision = decideModel(
      { ANTHROPIC_API_KEY: 'a' },
      'me@example.com',
      null,
      null,
      'claude-opus-5-5',
    );
    assert.equal(decision.ok, true);
  });

  it('still honours a model the person chose, whatever VIBLD_MODEL says', () => {
    const decision = decideModel(
      anthropicOnly,
      'me@example.com',
      null,
      'claude-opus-5-5',
      'gpt-6-sol',
    );
    assert.equal(decision.ok, true);
  });
});
