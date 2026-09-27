import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  anthropicServedModel,
  compareServed,
  listedModels,
} from '../src/served-check.ts';
import type { ServedModel } from '../src/served-check.ts';
import { MODEL_CATALOGUE, findModel } from '../src/model-catalogue.ts';

/**
 * The served-models check, against the response shapes each provider's
 * API reference documents: `{ data: [{ id, ... }] }` from all three, and
 * Anthropic's model object with `max_input_tokens`, `max_tokens` and
 * `capabilities`.
 */

function anthropicItem(
  id: string,
  maxInput = 1_000_000,
  maxTokens = 128_000,
  effort = true,
) {
  return {
    type: 'model',
    id,
    display_name: id,
    created_at: '2026-09-01T00:00:00Z',
    max_input_tokens: maxInput,
    max_tokens: maxTokens,
    capabilities: {
      image_input: { supported: true },
      effort: { supported: effort, max: { supported: effort } },
    },
  };
}

/** What Anthropic serves for every Claude in the catalogue, at its limits. */
function anthropicServesCatalogue(): ServedModel[] {
  return MODEL_CATALOGUE.filter((model) => model.provider === 'anthropic').map(
    (model) =>
      anthropicServedModel(
        anthropicItem(
          model.id === 'claude-haiku-4-5'
            ? 'claude-haiku-4-5-20251001'
            : model.id,
          model.contextWindow,
          model.maxOutputTokens,
          model.supportsEffort,
        ),
      ),
  );
}

describe('reading the models lists', () => {
  it('reads the ids of an OpenAI or DeepSeek list', () => {
    assert.deepEqual(
      listedModels({
        object: 'list',
        data: [
          { id: 'gpt-6-sol', object: 'model', created: 1, owned_by: 'system' },
          { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
        ],
      }),
      [{ id: 'gpt-6-sol' }, { id: 'deepseek-v4-pro' }],
    );
  });

  it('refuses a body that is not a list, rather than reading it as empty', () => {
    assert.throws(() => listedModels({ error: { message: 'no' } }));
    assert.throws(() => listedModels({ data: [{ object: 'model' }] }));
  });

  it("reads Anthropic's limits and whether effort is accepted", () => {
    assert.deepEqual(
      anthropicServedModel(
        anthropicItem('claude-haiku-4-5-20251001', 200_000, 64_000, false),
      ),
      {
        id: 'claude-haiku-4-5-20251001',
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
        supportsEffort: false,
      },
    );
  });

  it('leaves out a limit the response does not give, rather than guessing it', () => {
    assert.deepEqual(anthropicServedModel({ id: 'claude-opus-5-5' }), {
      id: 'claude-opus-5-5',
    });
    assert.throws(() => anthropicServedModel({ max_tokens: 1 }));
  });
});

describe('comparing the catalogue with what is served', () => {
  it('finds nothing when every model is served at its limits', () => {
    assert.deepEqual(
      compareServed({ anthropic: anthropicServesCatalogue() }, MODEL_CATALOGUE),
      [],
    );
  });

  it('matches a dated snapshot to the alias the catalogue offers', () => {
    const haiku = findModel('claude-haiku-4-5')!;
    assert.deepEqual(
      compareServed(
        {
          anthropic: [
            anthropicServedModel(
              anthropicItem(
                'claude-haiku-4-5-20251001',
                200_000,
                64_000,
                false,
              ),
            ),
          ],
        },
        [haiku],
      ),
      [],
    );
  });

  it('reports a model offered here that the provider no longer lists', () => {
    const findings = compareServed(
      { openai: [{ id: 'gpt-6-astra' }, { id: 'gpt-6-luna' }] },
      MODEL_CATALOGUE,
    );
    assert.ok(
      findings.some(
        (f) =>
          f.kind === 'not-served' &&
          f.provider === 'openai' &&
          f.model === 'gpt-6-sol',
      ),
    );
    assert.ok(
      !findings.some(
        (f) => f.kind === 'not-served' && f.model === 'gpt-6-astra',
      ),
    );
  });

  it('says nothing about a provider whose list was not read', () => {
    const findings = compareServed(
      { anthropic: anthropicServesCatalogue() },
      MODEL_CATALOGUE,
    );
    assert.ok(!findings.some((f) => f.provider !== 'anthropic'));
  });

  it('reports each limit Anthropic serves differently', () => {
    const opus = findModel('claude-opus-5-5')!;
    const findings = compareServed(
      {
        anthropic: [
          anthropicServedModel(
            anthropicItem('claude-opus-5-5', 2_000_000, 64_000, false),
          ),
        ],
      },
      [opus],
    );
    assert.deepEqual(
      findings.map((f) =>
        f.kind === 'limit-differs' ? [f.field, f.catalogue, f.served] : [],
      ),
      [
        ['contextWindow', 1_000_000, 2_000_000],
        ['maxOutputTokens', 128_000, 64_000],
        ['supportsEffort', true, false],
      ],
    );
  });

  it('does not compare a limit the provider did not give', () => {
    const opus = findModel('claude-opus-5-5')!;
    assert.deepEqual(
      compareServed({ anthropic: [{ id: 'claude-opus-5-5' }] }, [opus]),
      [],
    );
  });

  it('reports a newer version of a family offered here, once', () => {
    const findings = compareServed(
      {
        anthropic: [
          ...anthropicServesCatalogue(),
          anthropicServedModel(anthropicItem('claude-opus-6')),
          anthropicServedModel(anthropicItem('claude-opus-6-20270101')),
        ],
        openai: [
          { id: 'gpt-6-astra' },
          { id: 'gpt-6-sol' },
          { id: 'gpt-6-luna' },
          { id: 'gpt-5.6-sol' },
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-5.6-luna' },
          { id: 'gpt-6.5-sol' },
        ],
      },
      MODEL_CATALOGUE,
    );
    assert.deepEqual(
      findings.map((f) =>
        f.kind === 'newer-version' ? [f.model, f.newestOffered] : [f.kind],
      ),
      [
        ['claude-opus-6', 'claude-opus-5-5'],
        ['gpt-6.5-sol', 'gpt-6-sol'],
      ],
    );
  });

  it('ignores older versions, other kinds of model and families not offered', () => {
    const findings = compareServed(
      {
        anthropic: [
          ...anthropicServesCatalogue(),
          anthropicServedModel(anthropicItem('claude-opus-4-1')),
          anthropicServedModel(anthropicItem('claude-mythos-5-1')),
        ],
        openai: [
          { id: 'gpt-6-astra' },
          { id: 'gpt-6-sol' },
          { id: 'gpt-6-luna' },
          { id: 'gpt-5.6-sol' },
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-5.6-luna' },
          { id: 'gpt-6-sol-2026-08-01' },
          { id: 'text-embedding-4-large' },
          { id: 'gpt-5-nova' },
          { id: 'gpt-7-nova' },
        ],
      },
      MODEL_CATALOGUE,
    );
    assert.deepEqual(findings, []);
  });
});
