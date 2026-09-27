import { cacheRatesFor } from './model-catalogue.ts';
import type { ModelChoice } from './model-catalogue.ts';
import type { ProviderName } from './select-client.ts';

/**
 * Whether what a run is billed at still covers what it costs.
 *
 * Every credit a person spends here is a cent of model spend at the rates in
 * `model-catalogue.ts`, and the margin on a plan is the gap between its
 * price and the model spend it includes (docs/decisions.md L36). That margin
 * holds only while each catalogue rate is at least what the provider
 * charges. A provider that raises a price, or starts charging for something
 * it did not (OpenAI's cache writes on GPT-5.6), takes the difference out of
 * every plan without anything here failing. A rate set above cost does the
 * opposite: it charges people for model spend that did not happen.
 *
 * Two independent sources are compared against the catalogue:
 *
 * - **published**: the providers' pricing pages, read on a schedule by the
 *   pricing routine and passed in as data. What the provider says it
 *   charges.
 * - **realised**: the providers' own cost and usage reports, through their
 *   admin APIs. What the provider actually billed per token, divided out.
 *
 * Pure, so every rule is tested against recorded response shapes rather
 * than the network. `apps/web/scripts/check-model-prices.ts` fetches.
 */

export type TokenKind = 'input' | 'output' | 'cache-read' | 'cache-write';

export const TOKEN_KINDS: readonly TokenKind[] = [
  'input',
  'output',
  'cache-read',
  'cache-write',
];

/** A rate, in micro-USD per token (equal to dollars per million). */
export type Rates = Partial<Record<TokenKind, number>>;

/** What vibld bills a token of each kind at on this model. */
export function billedRates(model: ModelChoice): Record<TokenKind, number> {
  const cache = cacheRatesFor(model);
  return {
    input: model.inputMicroUsd,
    output: model.outputMicroUsd,
    'cache-read': cache.cachedInputMicroUsd,
    'cache-write': cache.cacheWriteMicroUsd,
  };
}

/** One model's standard-tier prices as its provider publishes them. */
export interface PublishedPrice {
  provider: ProviderName;
  model: string;
  rates: Rates;
  /** The page the figures were read from. */
  source: string;
}

/** One model's cost per token, divided out of the provider's own bill. */
export interface RealisedRate {
  provider: ProviderName;
  model: string;
  kind: TokenKind;
  microUsdPerToken: number;
  /** How many tokens the rate was divided out of. */
  tokens: number;
}

export type PriceFindingKind =
  /** Billed below cost: the plan margin is paying the difference. */
  | 'under-billed'
  /** Billed above cost: people are paying for spend that did not happen. */
  | 'over-billed'
  /** Priced by the provider and not offered here. */
  | 'not-offered'
  /** Offered here, and absent from a provider page that was read. */
  | 'not-published'
  /**
   * Offered here and published, but without a rate for a kind of token
   * vibld bills (#213 review). Nothing was compared for that kind, so the
   * check is incomplete rather than clean.
   */
  | 'rate-missing';

export interface PriceFinding {
  kind: PriceFindingKind;
  provider: ProviderName;
  model: string;
  basis: 'published' | 'realised';
  tokenKind?: TokenKind;
  billed?: number;
  cost?: number;
  source?: string;
}

/**
 * How far apart two rates may be before it is a finding.
 *
 * Relative, because the rates span four orders of magnitude, and not zero,
 * because a realised rate is an amount rounded to a fraction of a cent
 * divided by a token count.
 */
export const RATE_TOLERANCE = 0.02;

/**
 * Fewer tokens than this, and a realised rate is mostly rounding. A run's
 * worth is far more; one stray request is not.
 */
export const MIN_REALISED_TOKENS = 10_000;

/** A dated snapshot suffix: `-20251001` or `-2026-08-01`. */
const SNAPSHOT = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

function differs(billed: number, cost: number): boolean {
  if (cost === 0) return billed !== 0;
  return Math.abs(billed - cost) / cost > RATE_TOLERANCE;
}

function compareRate(
  model: ModelChoice,
  kind: TokenKind,
  cost: number,
  basis: PriceFinding['basis'],
  source?: string,
): PriceFinding | null {
  const billed = billedRates(model)[kind];
  if (!differs(billed, cost)) return null;
  return {
    kind: billed < cost ? 'under-billed' : 'over-billed',
    provider: model.provider,
    model: model.id,
    basis,
    tokenKind: kind,
    billed,
    cost,
    ...(source ? { source } : {}),
  };
}

/**
 * The catalogue against what the providers publish.
 *
 * `readProviders` names the providers whose pages were actually read, and
 * only their models can be `not-published`: a provider nobody looked at has
 * not stopped listing anything.
 */
export function comparePublished(
  published: readonly PublishedPrice[],
  catalogue: readonly ModelChoice[],
  readProviders: readonly ProviderName[],
): PriceFinding[] {
  const findings: PriceFinding[] = [];
  const byId = new Map(catalogue.map((model) => [model.id, model]));
  // By provider and id together (#213 review): an entry filed under the
  // wrong provider did not publish that model, and must not hide it.
  const listed = new Set(
    published.map((price) => `${price.provider}\u0000${price.model}`),
  );

  for (const price of published) {
    const model = byId.get(price.model);
    if (!model || model.provider !== price.provider) {
      findings.push({
        kind: 'not-offered',
        provider: price.provider,
        model: price.model,
        basis: 'published',
        source: price.source,
      });
      continue;
    }
    for (const kind of TOKEN_KINDS) {
      const cost = price.rates[kind];
      if (cost === undefined) {
        findings.push({
          kind: 'rate-missing',
          provider: model.provider,
          model: model.id,
          basis: 'published',
          tokenKind: kind,
          source: price.source,
        });
        continue;
      }
      const finding = compareRate(model, kind, cost, 'published', price.source);
      if (finding) findings.push(finding);
    }
  }

  for (const model of catalogue) {
    if (!readProviders.includes(model.provider)) continue;
    if (listed.has(`${model.provider}\u0000${model.id}`)) continue;
    findings.push({
      kind: 'not-published',
      provider: model.provider,
      model: model.id,
      basis: 'published',
    });
  }

  return findings;
}

/**
 * The catalogue against what the providers actually billed.
 *
 * A model billed that is not in the catalogue is not a finding here: the
 * same account also carries evaluation runs and anything else the key is
 * used for, and those are not what people are charged for.
 */
export function compareRealised(
  realised: readonly RealisedRate[],
  catalogue: readonly ModelChoice[],
): PriceFinding[] {
  const byId = new Map(catalogue.map((model) => [model.id, model]));
  const findings: PriceFinding[] = [];
  for (const rate of realised) {
    if (rate.tokens < MIN_REALISED_TOKENS) continue;
    // A bill can name the dated snapshot (`claude-haiku-4-5-20251001`) of
    // the id a request used. It is the same model and the same price.
    const model =
      byId.get(rate.model) ?? byId.get(rate.model.replace(SNAPSHOT, ''));
    if (!model || model.provider !== rate.provider) continue;
    const finding = compareRate(
      model,
      rate.kind,
      rate.microUsdPerToken,
      'realised',
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

/** What a plan costs and how much model spend it includes, in USD. */
export interface PlanEconomics {
  name: string;
  priceUsd: number;
  includedModelSpendUsd: number;
}

/**
 * A plan's margin when every included dollar of model spend costs
 * `costRatio` dollars. 1 is the margin the price table was set at; a model
 * billed at half its cost is a ratio of 2.
 */
export function planMargin(plan: PlanEconomics, costRatio = 1): number {
  return 1 - (plan.includedModelSpendUsd * costRatio) / plan.priceUsd;
}

/**
 * The worst cost-to-billed ratio among `under-billed` findings: what one
 * included dollar costs if someone spends all of it on the most
 * under-priced token there is. 1 when nothing is billed below cost.
 */
export function worstCostRatio(findings: readonly PriceFinding[]): number {
  let worst = 1;
  for (const finding of findings) {
    if (finding.kind !== 'under-billed') continue;
    if (!finding.billed || finding.cost === undefined) continue;
    worst = Math.max(worst, finding.cost / finding.billed);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Provider reports, parsed into realised rates.
// ---------------------------------------------------------------------------

interface AnthropicCostResult {
  amount?: unknown;
  currency?: unknown;
  cost_type?: unknown;
  model?: unknown;
  token_type?: unknown;
  service_tier?: unknown;
  inference_geo?: unknown;
  speed?: unknown;
}

interface AnthropicUsageResult {
  model?: unknown;
  service_tier?: unknown;
  inference_geo?: unknown;
  speed?: unknown;
  uncached_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation?: {
    ephemeral_5m_input_tokens?: unknown;
    ephemeral_1h_input_tokens?: unknown;
  } | null;
}

interface Buckets<T> {
  data?: { results?: T[] }[];
}

/**
 * Standard-tier, global, standard-speed traffic only: the price this product
 * pays. Batch is half price and US-only inference a tenth more, and a rate
 * averaged across them describes no request this product makes.
 */
function standardTraffic(result: {
  service_tier?: unknown;
  inference_geo?: unknown;
  speed?: unknown;
}): boolean {
  const tier = result.service_tier;
  const geo = result.inference_geo;
  const speed = result.speed;
  return (
    (tier === undefined || tier === null || tier === 'standard') &&
    (geo === undefined ||
      geo === null ||
      geo === 'global' ||
      geo === 'not_available') &&
    (speed === undefined || speed === null || speed === 'standard')
  );
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Anthropic's token types, as its cost report names them, and the usage
 * report field that counts the same tokens. Only the five-minute cache
 * write is mapped, because it is the only one this product makes; a
 * one-hour write is priced differently and is not a rate it pays.
 */
const ANTHROPIC_TOKEN_TYPES: Readonly<
  Record<
    string,
    { kind: TokenKind; tokens: (u: AnthropicUsageResult) => number }
  >
> = {
  uncached_input_tokens: {
    kind: 'input',
    tokens: (u) => count(u.uncached_input_tokens),
  },
  output_tokens: { kind: 'output', tokens: (u) => count(u.output_tokens) },
  cache_read_input_tokens: {
    kind: 'cache-read',
    tokens: (u) => count(u.cache_read_input_tokens),
  },
  'cache_creation.ephemeral_5m_input_tokens': {
    kind: 'cache-write',
    tokens: (u) => count(u.cache_creation?.ephemeral_5m_input_tokens),
  },
};

/**
 * What a provider's bill turned into, and what it could not.
 *
 * `unread` names every charge for tokens that did not become a per-token
 * rate: a token type or line item this does not recognise, or one with no
 * token count to divide by. A check that quietly skipped them would report
 * the bill it could not read as a bill that agreed (#213 review), so the
 * script treats a non-empty list as an incomplete check, never a clean one.
 */
export interface RealisedReading {
  rates: RealisedRate[];
  unread: string[];
}

/**
 * Realised Anthropic rates: the cost report (grouped by description) divided
 * by the usage report (grouped by model) over the same window.
 *
 * The cost report's amounts are USD cents, as decimal strings. A cent is
 * ten thousand micro-USD. Charges that are not per token (web search, code
 * execution) and traffic this product does not make (batch, US-only
 * inference, fast mode) are left out on purpose, not as unread.
 */
export function anthropicRealisedRates(
  costReport: Buckets<AnthropicCostResult>,
  usageReport: Buckets<AnthropicUsageResult>,
): RealisedReading {
  const cents = new Map<string, number>();
  const unread = new Set<string>();
  for (const bucket of costReport.data ?? []) {
    for (const result of bucket.results ?? []) {
      if (result.cost_type !== 'tokens') continue;
      if (!standardTraffic(result)) continue;
      const amount = Number(result.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const model = typeof result.model === 'string' ? result.model : '?';
      const tokenType =
        typeof result.token_type === 'string' ? result.token_type : '?';
      if (
        (result.currency !== undefined && result.currency !== 'USD') ||
        !(tokenType in ANTHROPIC_TOKEN_TYPES) ||
        model === '?'
      ) {
        unread.add(`${model} ${tokenType}`);
        continue;
      }
      const key = `${model}\u0000${tokenType}`;
      cents.set(key, (cents.get(key) ?? 0) + amount);
    }
  }

  const tokens = new Map<string, number>();
  for (const bucket of usageReport.data ?? []) {
    for (const result of bucket.results ?? []) {
      if (!standardTraffic(result)) continue;
      if (typeof result.model !== 'string') continue;
      for (const [tokenType, { tokens: read }] of Object.entries(
        ANTHROPIC_TOKEN_TYPES,
      )) {
        const key = `${result.model}\u0000${tokenType}`;
        tokens.set(key, (tokens.get(key) ?? 0) + read(result));
      }
    }
  }

  const rates: RealisedRate[] = [];
  for (const [key, amount] of cents) {
    const [model, tokenType] = key.split('\u0000') as [string, string];
    const counted = tokens.get(key) ?? 0;
    if (counted <= 0) {
      // Billed, with no tokens counted to divide it by.
      unread.add(`${model} ${tokenType}`);
      continue;
    }
    rates.push({
      provider: 'anthropic',
      model,
      kind: ANTHROPIC_TOKEN_TYPES[tokenType]!.kind,
      microUsdPerToken: (amount * 10_000) / counted,
      tokens: counted,
    });
  }
  return { rates, unread: [...unread].sort() };
}

interface OpenaiCostResult {
  amount?: { value?: unknown; currency?: unknown } | null;
  line_item?: unknown;
  quantity?: unknown;
  quantity_unit?: unknown;
}

/**
 * Which kind of token an OpenAI cost line item bills.
 *
 * The line item is a string naming the model and what was charged. Only the
 * four text-token charges are read; anything else (audio, images, tools,
 * batch, a wording this does not recognise) is left out rather than guessed
 * at, since a guessed mapping is a margin figure nobody can trust.
 */
export function openaiLineItem(
  lineItem: string,
): { model: string; kind: TokenKind } | null {
  const comma = lineItem.lastIndexOf(',');
  if (comma <= 0) return null;
  const model = lineItem.slice(0, comma).trim();
  const charge = lineItem
    .slice(comma + 1)
    .trim()
    .toLowerCase();
  if (/audio|image|batch|flex|fast|priority|tool|search/.test(charge)) {
    return null;
  }
  if (/cache[ds]?[ _-]?write/.test(charge))
    return { model, kind: 'cache-write' };
  if (/cached/.test(charge)) return { model, kind: 'cache-read' };
  if (/^output/.test(charge)) return { model, kind: 'output' };
  if (/^input/.test(charge)) return { model, kind: 'input' };
  return null;
}

/** Units that are not tokens: a charge in one of these is not a token rate. */
const NON_TOKEN_UNITS = new Set([
  'duration_seconds',
  'duration_minutes',
  'duration_hours',
  'gibibyte_hours',
  'images',
]);

/**
 * Realised OpenAI rates, from the costs endpoint grouped by line item. With
 * that grouping each result carries its own `quantity` and `quantity_unit`
 * (OpenAI's API reference, read 2026-09-23), so no second report is needed.
 * Amounts are dollars.
 *
 * Any charge that could be for tokens and did not become a rate is unread:
 * a wording this does not recognise (OpenAI does not document it), or a
 * result with no token quantity. Charges in a unit that is plainly not
 * tokens (images, container time) are other products and are left out.
 */
export function openaiRealisedRates(
  costs: Buckets<OpenaiCostResult>,
): RealisedReading {
  const totals = new Map<string, { usd: number; tokens: number }>();
  const unread = new Set<string>();
  for (const bucket of costs.data ?? []) {
    for (const result of bucket.results ?? []) {
      const usd = Number(result.amount?.value);
      if (!Number.isFinite(usd) || usd === 0) continue;
      const unit = result.quantity_unit;
      if (typeof unit === 'string' && NON_TOKEN_UNITS.has(unit)) continue;
      const name =
        typeof result.line_item === 'string'
          ? result.line_item
          : '(no line item)';
      const parsed =
        typeof result.line_item === 'string'
          ? openaiLineItem(result.line_item)
          : null;
      const quantity = Number(result.quantity);
      const currency = result.amount?.currency;
      if (
        !parsed ||
        (unit !== 'tokens' && unit !== '1000_tokens') ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        (currency !== undefined && currency !== 'usd')
      ) {
        unread.add(name);
        continue;
      }
      const tokens = unit === '1000_tokens' ? quantity * 1000 : quantity;
      const key = `${parsed.model}\u0000${parsed.kind}`;
      const total = totals.get(key) ?? { usd: 0, tokens: 0 };
      total.usd += usd;
      total.tokens += tokens;
      totals.set(key, total);
    }
  }
  const rates: RealisedRate[] = [];
  for (const [key, { usd, tokens }] of totals) {
    const [model, kind] = key.split('\u0000') as [string, TokenKind];
    rates.push({
      provider: 'openai',
      model,
      kind,
      microUsdPerToken: (usd * 1_000_000) / tokens,
      tokens,
    });
  }
  return { rates, unread: [...unread].sort() };
}

/** The providers whose pricing pages every snapshot must cover. */
export const PUBLISHED_PROVIDERS: readonly ProviderName[] = [
  'anthropic',
  'openai',
  'deepseek',
];

/**
 * How old the snapshot on `main` may be before the daily check calls it
 * stale. The routine reads weekly, so a week and a day allows for a run
 * landing late; past that, published prices were not checked.
 */
export const MAX_SNAPSHOT_AGE_DAYS = 8;

/**
 * Published prices as the pricing routine writes them, checked rather than
 * trusted: the file comes from reading web pages, and a malformed entry
 * would otherwise become a finding about a price nobody published.
 */
export function parsePublishedPrices(value: unknown): PublishedPrice[] {
  if (!Array.isArray(value)) {
    throw new Error('published prices must be a JSON array');
  }
  const providers: readonly string[] = PUBLISHED_PROVIDERS;
  return value.map((entry, index) => {
    const where = `published prices entry ${index}`;
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${where} is not an object`);
    }
    const { provider, model, rates, source } = entry as Record<string, unknown>;
    if (typeof provider !== 'string' || !providers.includes(provider)) {
      throw new Error(`${where} has no known provider`);
    }
    if (typeof model !== 'string' || model.length === 0) {
      throw new Error(`${where} has no model id`);
    }
    if (typeof source !== 'string' || !/^https:\/\//.test(source)) {
      throw new Error(`${where} (${model}) has no https source`);
    }
    if (typeof rates !== 'object' || rates === null) {
      throw new Error(`${where} (${model}) has no rates`);
    }
    const parsed: Rates = {};
    for (const kind of TOKEN_KINDS) {
      const rate = (rates as Record<string, unknown>)[kind];
      if (rate === undefined) continue;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
        throw new Error(`${where} (${model}) has an unusable ${kind} rate`);
      }
      parsed[kind] = rate;
    }
    // Cache reads are required, not optional: they are the rate that was
    // wrong on three models the first time anyone looked, and an entry that
    // omitted one would pass the catalogue check without comparing it.
    if (
      parsed.input === undefined ||
      parsed.output === undefined ||
      parsed['cache-read'] === undefined
    ) {
      throw new Error(
        `${where} (${model}) needs input, output and cache-read rates`,
      );
    }
    return {
      provider: provider as ProviderName,
      model,
      rates: parsed,
      source,
    };
  });
}

/**
 * `published-prices.json`: the date the pages were read, and what they said.
 * The date is required because a snapshot with no date cannot say how stale
 * it is.
 */
export function parsePublishedSnapshot(
  value: unknown,
  now: Date = new Date(),
): {
  readOn: string;
  prices: PublishedPrice[];
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('the published price snapshot must be a JSON object');
  }
  const { readOn, prices } = value as Record<string, unknown>;
  if (typeof readOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(readOn)) {
    throw new Error('the published price snapshot needs readOn as YYYY-MM-DD');
  }
  // A real calendar date, and not a future one (#213 review). `2026-99-99`
  // has no age at all and a future date a negative one, and either would
  // hold the stale-snapshot check open for good.
  const read = new Date(`${readOn}T00:00:00Z`);
  if (
    Number.isNaN(read.getTime()) ||
    read.toISOString().slice(0, 10) !== readOn
  ) {
    throw new Error(
      `the published price snapshot's readOn ${readOn} is not a date`,
    );
  }
  if (readOn > now.toISOString().slice(0, 10)) {
    throw new Error(
      `the published price snapshot's readOn ${readOn} is in the future`,
    );
  }
  const parsed = parsePublishedPrices(prices);
  // Every provider, every time (#213 review). A rewrite that dropped one
  // would otherwise read as that provider's page not having been read, and
  // quietly stop every check on its models. DeepSeek has no cost API, so
  // for it this snapshot is the only check there is.
  for (const provider of PUBLISHED_PROVIDERS) {
    if (!parsed.some((price) => price.provider === provider)) {
      throw new Error(`the published price snapshot has no ${provider} prices`);
    }
  }
  return { readOn, prices: parsed };
}
