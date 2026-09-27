import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MIN_REALISED_TOKENS,
  anthropicRealisedRates,
  billedRates,
  comparePublished,
  compareRealised,
  openaiLineItem,
  openaiRealisedRates,
  parsePublishedPrices,
  parsePublishedSnapshot,
  planMargin,
  worstCostRatio,
} from '../src/price-check.ts';
import type { PublishedPrice } from '../src/price-check.ts';
import { MODEL_CATALOGUE, findModel } from '../src/model-catalogue.ts';

/**
 * The pricing check, against recorded response shapes. The admin reports'
 * shapes are the ones each provider's API reference gives as its example
 * (read 2026-09-23); the published snapshot is the committed file the
 * pricing routine rewrites.
 */

function published(
  model: string,
  rates: PublishedPrice['rates'],
  provider: PublishedPrice['provider'] = 'anthropic',
): PublishedPrice {
  return { provider, model, rates, source: 'https://example.com/pricing' };
}

describe('comparing the catalogue with published prices', () => {
  it('finds nothing when every rate matches', () => {
    const opus = findModel('claude-opus-5-5')!;
    const rates = billedRates(opus);
    assert.deepEqual(
      comparePublished(
        [published('claude-opus-5-5', rates)],
        [opus],
        ['anthropic'],
      ),
      [],
    );
  });

  it('calls a provider price above ours under-billed, which is margin lost', () => {
    const sonnet = findModel('claude-sonnet-5')!;
    const [finding] = comparePublished(
      [published('claude-sonnet-5', { input: 2, output: 12 })],
      [sonnet],
      ['anthropic'],
    );
    assert.equal(finding?.kind, 'under-billed');
    assert.equal(finding?.tokenKind, 'output');
    assert.equal(finding?.billed, 10);
    assert.equal(finding?.cost, 12);
  });

  it('calls a provider price below ours over-billed, which people pay for', () => {
    // The case that started this: Fable 5.1 reads from cache at $0.25 and
    // was billed at $1.00.
    const fable = { ...findModel('claude-fable-5-1')! };
    delete fable.cacheReadMicroUsd;
    const [finding] = comparePublished(
      [
        published('claude-fable-5-1', {
          input: 10,
          output: 50,
          'cache-read': 0.25,
        }),
      ],
      [fable],
      ['anthropic'],
    );
    assert.equal(finding?.kind, 'over-billed');
    assert.equal(finding?.tokenKind, 'cache-read');
    assert.equal(finding?.billed, 1);
  });

  it('tolerates rounding but not a real difference', () => {
    const luna = findModel('gpt-6-luna')!;
    const within = comparePublished(
      [
        published(
          'gpt-6-luna',
          {
            input: 0.1015,
            output: 0.5,
            'cache-read': 0.01,
            'cache-write': 0.125,
          },
          'openai',
        ),
      ],
      [luna],
      ['openai'],
    );
    assert.deepEqual(within, []);
    const beyond = comparePublished(
      [
        published(
          'gpt-6-luna',
          {
            input: 0.103,
            output: 0.5,
            'cache-read': 0.01,
            'cache-write': 0.125,
          },
          'openai',
        ),
      ],
      [luna],
      ['openai'],
    );
    assert.equal(beyond.length, 1);
  });

  it('calls a billed rate missing from an offered entry incomplete (#213 review)', () => {
    // Every offered model is billed a cache write, so an entry without one
    // compared nothing for it: not a clean result.
    const sol = findModel('gpt-6-sol')!;
    const findings = comparePublished(
      [
        published(
          'gpt-6-sol',
          { input: 2, output: 10, 'cache-read': 0.2 },
          'openai',
        ),
      ],
      [sol],
      ['openai'],
    );
    assert.deepEqual(
      findings.map((f) => [f.kind, f.tokenKind]),
      [['rate-missing', 'cache-write']],
    );
  });

  it('does not count an entry under the wrong provider as publishing it (#213 review)', () => {
    const sol = findModel('gpt-6-sol')!;
    const findings = comparePublished(
      [
        published(
          'gpt-6-sol',
          { input: 2, output: 10, 'cache-read': 0.2, 'cache-write': 2.5 },
          'anthropic',
        ),
      ],
      [sol],
      ['anthropic', 'openai'],
    );
    assert.deepEqual(
      findings.map((f) => [f.kind, f.provider, f.model]).sort(),
      [
        ['not-offered', 'anthropic', 'gpt-6-sol'],
        ['not-published', 'openai', 'gpt-6-sol'],
      ],
    );
  });

  it('names a published model that is not offered', () => {
    const findings = comparePublished(
      [published('claude-opus-4-5', { input: 5, output: 25 })],
      [],
      ['anthropic'],
    );
    assert.deepEqual(
      findings.map((f) => [f.kind, f.model]),
      [['not-offered', 'claude-opus-4-5']],
    );
  });

  it('names an offered model missing from a page that was read, and only then', () => {
    const terra = findModel('gpt-5.6-terra')!;
    assert.deepEqual(
      comparePublished([], [terra], ['openai']).map((f) => f.kind),
      ['not-published'],
    );
    // Nobody read OpenAI's page, so it has not stopped listing anything.
    assert.deepEqual(comparePublished([], [terra], ['anthropic']), []);
  });
});

describe('the committed published-price snapshot', () => {
  const snapshot = parsePublishedSnapshot(
    JSON.parse(
      readFileSync(
        new URL('../published-prices.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const findings = comparePublished(snapshot.prices, MODEL_CATALOGUE, [
    'anthropic',
    'openai',
    'deepseek',
  ]);

  it('agrees with the catalogue on every rate of every model offered', () => {
    // The pricing routine rewrites the snapshot. When a provider moves a
    // price, this is what fails until the catalogue moves with it, so the
    // same change carries both.
    const mismatched = findings.filter(
      (f) =>
        f.kind === 'under-billed' ||
        f.kind === 'over-billed' ||
        f.kind === 'rate-missing',
    );
    assert.deepEqual(
      mismatched.map(
        (f) => `${f.model} ${f.tokenKind}: billed ${f.billed}, costs ${f.cost}`,
      ),
      [],
    );
  });

  it('lists exactly the offered models a provider no longer publishes', () => {
    // Kept on purpose: removing a model is a decision, not a price update.
    // A new entry here means another one left a pricing page.
    assert.deepEqual(
      findings
        .filter((f) => f.kind === 'not-published')
        .map((f) => f.model)
        .sort(),
      [],
    );
  });

  it('is dated no earlier than the catalogue it was checked against', async () => {
    const { CATALOGUE_VERIFIED_ON } = await import('../src/model-catalogue.ts');
    assert.ok(snapshot.readOn >= CATALOGUE_VERIFIED_ON);
  });
});

describe('reading published prices', () => {
  it('refuses an entry without a source to point back to', () => {
    assert.throws(
      () =>
        parsePublishedPrices([
          {
            provider: 'openai',
            model: 'gpt-6-sol',
            rates: { input: 2, output: 10 },
          },
        ]),
      /https source/,
    );
  });

  it('refuses a rate that is not a number', () => {
    assert.throws(
      () =>
        parsePublishedPrices([
          {
            provider: 'openai',
            model: 'gpt-6-sol',
            rates: { input: '$2.00', output: 10 },
            source: 'https://developers.openai.com/api/docs/pricing',
          },
        ]),
      /unusable input/,
    );
  });

  it('refuses a provider it does not know', () => {
    assert.throws(
      () =>
        parsePublishedPrices([
          {
            provider: 'mistral',
            model: 'x',
            rates: { input: 1, output: 1 },
            source: 'https://example.com',
          },
        ]),
      /known provider/,
    );
  });

  it('refuses an entry with no cache-read rate', () => {
    // The rate that was wrong on three models the first time anyone looked.
    // Without it the catalogue check would pass without comparing it.
    assert.throws(
      () =>
        parsePublishedPrices([
          {
            provider: 'openai',
            model: 'gpt-6-sol',
            rates: { input: 2, output: 10 },
            source: 'https://developers.openai.com/api/docs/pricing',
          },
        ]),
      /cache-read/,
    );
  });

  it('refuses a snapshot that leaves out a provider (#213 review)', () => {
    // Read as that provider not having been read, it would silently stop
    // every check on its models, and DeepSeek has no cost API to fall back on.
    const entry = (provider: string, model: string) => ({
      provider,
      model,
      rates: { input: 1, output: 2, 'cache-read': 0.1 },
      source: 'https://example.com/pricing',
    });
    assert.throws(
      () =>
        parsePublishedSnapshot({
          readOn: '2026-09-23',
          prices: [entry('anthropic', 'a'), entry('openai', 'b')],
        }),
      /no deepseek prices/,
    );
    assert.doesNotThrow(() =>
      parsePublishedSnapshot({
        readOn: '2026-09-23',
        prices: [
          entry('anthropic', 'a'),
          entry('openai', 'b'),
          entry('deepseek', 'c'),
        ],
      }),
    );
  });

  it('refuses a date that is not a date, or not yet (#213 review)', () => {
    const snapshot = (readOn: string) => ({
      readOn,
      prices: ['anthropic', 'openai', 'deepseek'].map((provider) => ({
        provider,
        model: provider,
        rates: { input: 1, output: 2, 'cache-read': 0.1 },
        source: 'https://example.com/pricing',
      })),
    });
    const today = new Date('2026-09-23T12:00:00Z');
    assert.throws(
      () => parsePublishedSnapshot(snapshot('2026-99-99'), today),
      /not a date/,
    );
    assert.throws(
      () => parsePublishedSnapshot(snapshot('2026-02-30'), today),
      /not a date/,
    );
    assert.throws(
      () => parsePublishedSnapshot(snapshot('2026-09-24'), today),
      /future/,
    );
    assert.doesNotThrow(() =>
      parsePublishedSnapshot(snapshot('2026-09-23'), today),
    );
  });

  it('refuses a snapshot with no date', () => {
    assert.throws(() => parsePublishedSnapshot({ prices: [] }), /readOn/);
  });
});

describe('realised Anthropic rates', () => {
  // The example shapes from Anthropic's Admin API reference.
  const costReport = {
    data: [
      {
        starting_at: '2026-09-22T00:00:00Z',
        ending_at: '2026-09-23T00:00:00Z',
        results: [
          {
            amount: '600',
            currency: 'USD',
            cost_type: 'tokens',
            description: 'Claude Opus 5.5 Usage - Input Tokens',
            model: 'claude-opus-5-5',
            token_type: 'uncached_input_tokens',
            service_tier: 'standard',
            inference_geo: 'global',
          },
          {
            amount: '1000',
            currency: 'USD',
            cost_type: 'tokens',
            model: 'claude-opus-5-5',
            token_type: 'output_tokens',
            service_tier: 'standard',
          },
          {
            // Batch is half price and not what this product pays.
            amount: '99999',
            currency: 'USD',
            cost_type: 'tokens',
            model: 'claude-opus-5-5',
            token_type: 'output_tokens',
            service_tier: 'batch',
          },
          {
            amount: '12.5',
            currency: 'USD',
            cost_type: 'web_search',
            model: 'claude-opus-5-5',
          },
        ],
      },
    ],
  };
  const usageReport = {
    data: [
      {
        results: [
          {
            model: 'claude-opus-5-5',
            service_tier: 'standard',
            inference_geo: 'global',
            uncached_input_tokens: 1_500_000,
            cache_read_input_tokens: 0,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 0,
            },
            output_tokens: 500_000,
          },
          {
            model: 'claude-opus-5-5',
            service_tier: 'batch',
            uncached_input_tokens: 9_000_000,
            output_tokens: 9_000_000,
          },
        ],
      },
    ],
  };

  it('divides cents billed by tokens counted, standard tier only', () => {
    const { rates, unread } = anthropicRealisedRates(costReport, usageReport);
    assert.deepEqual(unread, []);
    const byKind = Object.fromEntries(
      rates.map((r) => [r.kind, r.microUsdPerToken]),
    );
    // 600 cents over 1.5M tokens is $4 a million; 1000 cents over 500K is $20.
    assert.equal(byKind.input, 4);
    assert.equal(byKind.output, 20);
    assert.equal(rates.length, 2);
  });

  it('agrees with the catalogue at Opus 5.5 list price', () => {
    assert.deepEqual(
      compareRealised(
        anthropicRealisedRates(costReport, usageReport).rates,
        MODEL_CATALOGUE,
      ),
      [],
    );
  });

  it('finds a model the bill shows dearer than the catalogue', () => {
    const dearer = structuredClone(costReport);
    dearer.data[0]!.results[1]!.amount = '1250';
    const findings = compareRealised(
      anthropicRealisedRates(dearer, usageReport).rates,
      MODEL_CATALOGUE,
    );
    assert.deepEqual(
      findings.map((f) => [f.kind, f.tokenKind, f.cost]),
      [['under-billed', 'output', 25]],
    );
  });
});

describe('a bill read only in part (#213 review)', () => {
  it('names an Anthropic charge it has no token count for', () => {
    const { rates, unread } = anthropicRealisedRates(
      {
        data: [
          {
            results: [
              {
                amount: '500',
                currency: 'USD',
                cost_type: 'tokens',
                model: 'claude-sonnet-5',
                token_type: 'output_tokens',
                service_tier: 'standard',
              },
              {
                amount: '80',
                currency: 'USD',
                cost_type: 'tokens',
                model: 'claude-sonnet-5',
                token_type: 'cache_creation.ephemeral_1h_input_tokens',
                service_tier: 'standard',
              },
            ],
          },
        ],
      },
      { data: [] },
    );
    assert.deepEqual(rates, []);
    assert.deepEqual(unread, [
      'claude-sonnet-5 cache_creation.ephemeral_1h_input_tokens',
      'claude-sonnet-5 output_tokens',
    ]);
  });

  it('names an OpenAI charge with no token quantity rather than dropping it', () => {
    const { rates, unread } = openaiRealisedRates({
      data: [
        {
          results: [
            {
              amount: { value: 2, currency: 'usd' },
              line_item: 'gpt-6-sol, output',
              quantity: null,
              quantity_unit: null,
            },
            {
              // Says tokens, counts none: nothing to divide by.
              amount: { value: 1, currency: 'usd' },
              line_item: 'gpt-6-sol, input',
              quantity: 0,
              quantity_unit: 'tokens',
            },
            {
              // Container time is another product, not a token rate.
              amount: { value: 1, currency: 'usd' },
              line_item: 'containers',
              quantity: 3,
              quantity_unit: 'duration_hours',
            },
          ],
        },
      ],
    });
    assert.deepEqual(rates, []);
    assert.deepEqual(unread, ['gpt-6-sol, input', 'gpt-6-sol, output']);
  });
});

describe('realised OpenAI rates', () => {
  it('reads the four text-token charges and names what it could not read', () => {
    const { rates, unread } = openaiRealisedRates({
      data: [
        {
          results: [
            {
              amount: { value: 1, currency: 'usd' },
              line_item: 'gpt-6-luna, input',
              quantity: 10_000_000,
              quantity_unit: 'tokens',
            },
            {
              amount: { value: 5, currency: 'usd' },
              line_item: 'gpt-6-luna, output',
              quantity: 10_000_000,
              quantity_unit: 'tokens',
            },
            {
              amount: { value: 3, currency: 'usd' },
              line_item: 'gpt-6-luna, something new',
              quantity: 1,
              quantity_unit: 'tokens',
            },
            {
              amount: { value: 3, currency: 'usd' },
              line_item: 'web search',
              quantity: 300,
              quantity_unit: null,
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      rates.map((r) => [r.model, r.kind, r.microUsdPerToken]).sort(),
      [
        ['gpt-6-luna', 'input', 0.1],
        ['gpt-6-luna', 'output', 0.5],
      ],
    );
    assert.deepEqual(unread, ['gpt-6-luna, something new', 'web search']);
  });

  it('tells cached reads, cache writes and plain input apart', () => {
    assert.equal(openaiLineItem('gpt-6-sol, cached input')?.kind, 'cache-read');
    assert.equal(openaiLineItem('gpt-6-sol, cache write')?.kind, 'cache-write');
    assert.equal(openaiLineItem('gpt-6-sol, input')?.kind, 'input');
    assert.equal(openaiLineItem('gpt-6-sol, output')?.kind, 'output');
    assert.equal(openaiLineItem('gpt-6-sol, batch input'), null);
  });
});

describe('ignoring what is too small to mean anything', () => {
  it('reports no rate divided out of a handful of tokens', () => {
    assert.deepEqual(
      compareRealised(
        [
          {
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            kind: 'output',
            microUsdPerToken: 999,
            tokens: MIN_REALISED_TOKENS - 1,
          },
        ],
        MODEL_CATALOGUE,
      ),
      [],
    );
  });

  it('matches a dated snapshot to the model it is a snapshot of', () => {
    const findings = compareRealised(
      [
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          kind: 'output',
          microUsdPerToken: 6,
          tokens: 1_000_000,
        },
      ],
      MODEL_CATALOGUE,
    );
    assert.deepEqual(
      findings.map((f) => [f.model, f.kind]),
      [['claude-haiku-4-5', 'under-billed']],
    );
  });
});

describe('plan margins', () => {
  const build = { name: 'Build', priceUsd: 29, includedModelSpendUsd: 10 };

  it('is the price table margin when everything is billed at cost', () => {
    assert.ok(Math.abs(planMargin(build) - 19 / 29) < 1e-12);
  });

  it('shrinks by the worst under-billed ratio', () => {
    const ratio = worstCostRatio([
      {
        kind: 'under-billed',
        provider: 'openai',
        model: 'gpt-6-sol',
        basis: 'published',
        billed: 10,
        cost: 15,
      },
      {
        kind: 'over-billed',
        provider: 'openai',
        model: 'gpt-6-luna',
        basis: 'published',
        billed: 10,
        cost: 1,
      },
    ]);
    assert.equal(ratio, 1.5);
    assert.ok(Math.abs(planMargin(build, ratio) - (1 - 15 / 29)) < 1e-12);
  });

  it('is unchanged by over-billing, which costs people and not the margin', () => {
    assert.equal(worstCostRatio([]), 1);
  });
});
