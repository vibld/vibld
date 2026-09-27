/**
 * Whether what vibld bills for model use still covers what it costs, and
 * what that leaves of each plan's margin.
 *
 * Two sources, each optional, each reported as not checked when absent
 * rather than passed silently:
 *
 * - `--published <file>`: the providers' published prices, in the shape of
 *   `packages/ai/published-prices.json`. Defaults to that file, which the
 *   pricing routine rewrites from the pricing pages.
 * - the admin APIs, with `ANTHROPIC_ADMIN_KEY` and `OPENAI_ADMIN_KEY`: what
 *   each provider actually billed per token over the last seven days.
 *   DeepSeek has no cost API and is covered by its published prices only.
 *
 * The rules are in `@vibld/ai`'s `price-check.ts`, tested against recorded
 * response shapes. This file fetches and reports.
 *
 * Writes the report to stdout and, in Actions, to the job summary and to
 * `price-report.md`. Exits 1 when anything is billed away from cost, 2 when
 * a source could not be checked (an admin API unreadable, a charge for
 * tokens it could not turn into a rate, or a key absent unless
 * `--published-only` says only published prices were meant), 0 otherwise.
 *
 * Nothing on any path prints key material: a failed request reports its
 * host and status only.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import {
  MAX_SNAPSHOT_AGE_DAYS,
  MODEL_CATALOGUE,
  PUBLISHED_PROVIDERS,
  anthropicRealisedRates,
  comparePublished,
  compareRealised,
  openaiRealisedRates,
  parsePublishedSnapshot,
  planMargin,
  worstCostRatio,
} from '@vibld/ai';
import type { PlanEconomics, PriceFinding } from '@vibld/ai';

import { TIER_INCLUDED_MICRO_USD } from '../worker/entitlement.ts';
import { TOPUP_CREDIT_USD_CENTS } from '../worker/stripe-client.ts';

/**
 * The price table (docs/decisions.md L36, L38). The prices themselves live
 * in Stripe; the model spend each includes is read from the code that
 * grants it, so the two halves of each margin cannot drift apart silently.
 */
const PLANS: readonly PlanEconomics[] = [
  {
    name: 'Build, monthly',
    priceUsd: 29,
    includedModelSpendUsd: TIER_INCLUDED_MICRO_USD.build / 1_000_000,
  },
  {
    name: 'Ship, monthly',
    priceUsd: 99,
    includedModelSpendUsd: TIER_INCLUDED_MICRO_USD.ship / 1_000_000,
  },
  {
    name: 'Build, annual',
    priceUsd: 290,
    includedModelSpendUsd: (12 * TIER_INCLUDED_MICRO_USD.build) / 1_000_000,
  },
  {
    name: 'Ship, annual',
    priceUsd: 990,
    includedModelSpendUsd: (12 * TIER_INCLUDED_MICRO_USD.ship) / 1_000_000,
  },
  {
    name: 'Top-up',
    priceUsd: 20,
    includedModelSpendUsd: TOPUP_CREDIT_USD_CENTS / 100,
  },
];

const WINDOW_DAYS = 7;

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function getJson(url: URL, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    // The status only. A body can echo request details back, and this
    // output lands in an issue.
    throw new Error(`${url.host} answered ${response.status}`);
  }
  return (await response.json()) as {
    data?: unknown[];
    has_more?: boolean;
    next_page?: string | null;
  };
}

/** Every page of an admin report, bounded so a broken cursor cannot spin. */
async function allPages(
  first: URL,
  headers: Record<string, string>,
): Promise<{ data: never[] }> {
  const data: unknown[] = [];
  let url = first;
  for (let page = 0; page < 50; page += 1) {
    const body = await getJson(url, headers);
    data.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) return { data: data as never[] };
    url = new URL(first);
    url.searchParams.set('page', body.next_page);
  }
  throw new Error(`${first.host} kept paging past 50 pages`);
}

const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
since.setUTCHours(0, 0, 0, 0);

async function anthropicFindings(key: string): Promise<PriceFinding[]> {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const cost = new URL(
    'https://api.anthropic.com/v1/organizations/cost_report',
  );
  cost.searchParams.set('starting_at', since.toISOString());
  cost.searchParams.append('group_by[]', 'description');
  cost.searchParams.set('limit', String(WINDOW_DAYS + 1));
  const usage = new URL(
    'https://api.anthropic.com/v1/organizations/usage_report/messages',
  );
  usage.searchParams.set('starting_at', since.toISOString());
  usage.searchParams.set('bucket_width', '1d');
  usage.searchParams.set('limit', String(WINDOW_DAYS + 1));
  for (const dimension of ['model', 'service_tier', 'inference_geo']) {
    usage.searchParams.append('group_by[]', dimension);
  }
  const [costReport, usageReport] = await Promise.all([
    allPages(cost, headers),
    allPages(usage, headers),
  ]);
  const { rates, unread: missed } = anthropicRealisedRates(
    costReport,
    usageReport,
  );
  unread.push(...missed.map((item) => `Anthropic: ${item}`));
  return compareRealised(rates, MODEL_CATALOGUE);
}

/** Charges for tokens that did not become a rate: an incomplete check. */
const unread: string[] = [];

async function openaiFindings(key: string): Promise<PriceFinding[]> {
  const costs = new URL('https://api.openai.com/v1/organization/costs');
  costs.searchParams.set(
    'start_time',
    String(Math.floor(since.getTime() / 1000)),
  );
  costs.searchParams.set('bucket_width', '1d');
  costs.searchParams.set('limit', String(WINDOW_DAYS + 1));
  costs.searchParams.append('group_by', 'line_item');
  const report = await allPages(costs, { authorization: `Bearer ${key}` });
  const { rates, unread: missed } = openaiRealisedRates(report);
  unread.push(...missed.map((item) => `OpenAI: ${item}`));
  return compareRealised(rates, MODEL_CATALOGUE);
}

const findings: PriceFinding[] = [];
const checked: string[] = [];
const unchecked: string[] = [];
const failed: string[] = [];

const publishedPath =
  argument('--published') ??
  new URL('../../../packages/ai/published-prices.json', import.meta.url)
    .pathname;
try {
  const snapshot = parsePublishedSnapshot(
    JSON.parse(readFileSync(publishedPath, 'utf8')),
  );
  // Every provider is read every time, which the parser has already made
  // sure of, so none of them can drop out of the check by being absent.
  findings.push(
    ...comparePublished(snapshot.prices, MODEL_CATALOGUE, PUBLISHED_PROVIDERS),
  );
  const age = Math.floor(
    (Date.now() - Date.parse(`${snapshot.readOn}T00:00:00Z`)) / 86_400_000,
  );
  if (age > MAX_SNAPSHOT_AGE_DAYS) {
    // Stale is not checked (internal PR 213 review). DeepSeek has no cost API, so an
    // old snapshot leaves it with no check at all.
    failed.push(
      `published prices: read on ${snapshot.readOn}, ${age} days ago; the pricing routine has not refreshed them`,
    );
  } else {
    checked.push(`published prices read on ${snapshot.readOn}`);
  }
} catch (error) {
  failed.push(
    `published prices: ${error instanceof Error ? error.message : String(error)}`,
  );
}

for (const [label, key, check] of [
  ['Anthropic bill', process.env.ANTHROPIC_ADMIN_KEY, anthropicFindings],
  ['OpenAI bill', process.env.OPENAI_ADMIN_KEY, openaiFindings],
] as const) {
  if (!key) {
    unchecked.push(label);
    continue;
  }
  try {
    findings.push(...(await check(key)));
    checked.push(`${label}, last ${WINDOW_DAYS} days`);
  } catch (error) {
    failed.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function perMillion(microUsd: number | undefined): string {
  if (microUsd === undefined) return '?';
  return `$${Number(microUsd.toPrecision(4))}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const lines: string[] = ['## Model pricing and margin check', ''];
if (checked.length > 0) lines.push(`Checked: ${checked.join('; ')}.`, '');

const TITLES: Record<PriceFinding['kind'], string> = {
  'under-billed': 'Billed below cost (the margin pays the difference)',
  'over-billed': 'Billed above cost (people pay for spend that did not happen)',
  'not-offered': 'Priced by the provider, not offered here',
  'not-published': 'Offered here, no longer on the provider page',
  'rate-missing': 'Published without a rate vibld bills (not compared)',
};
for (const kind of Object.keys(TITLES) as PriceFinding['kind'][]) {
  const ofKind = findings.filter((finding) => finding.kind === kind);
  if (ofKind.length === 0) continue;
  lines.push(`### ${TITLES[kind]}`, '');
  if (kind === 'under-billed' || kind === 'over-billed') {
    lines.push(
      '| Model | Token | Billed /M | Costs /M | From |',
      '|---|---|---|---|---|',
    );
    for (const f of ofKind) {
      lines.push(
        `| \`${f.model}\` | ${f.tokenKind} | ${perMillion(f.billed)} | ${perMillion(f.cost)} | ${f.basis} |`,
      );
    }
  } else {
    for (const f of ofKind) {
      lines.push(
        `- \`${f.model}\` (${f.provider})${f.tokenKind ? `: ${f.tokenKind}` : ''}`,
      );
    }
  }
  lines.push('');
}

const ratio = worstCostRatio(findings);
lines.push('### Plan margins', '');
lines.push(
  '| Plan | Price | Model spend included | Margin at list | Margin at the worst under-billed rate |',
  '|---|---|---|---|---|',
);
for (const plan of PLANS) {
  lines.push(
    `| ${plan.name} | $${plan.priceUsd} | $${plan.includedModelSpendUsd} | ${percent(planMargin(plan))} | ${percent(planMargin(plan, ratio))} |`,
  );
}
lines.push(
  '',
  'Margins assume every included dollar is spent. Over-billing does not lower them; it charges people more than the model cost.',
);

if (unread.length > 0) {
  lines.push(
    '',
    '### Billed for tokens, and not read',
    '',
    'Each of these was charged and did not become a per-token rate, so the bill was only partly checked.',
    '',
    ...unread.map((item) => `- ${item}`),
  );
}
if (failed.length > 0) {
  lines.push('', '### Could not check', '', ...failed.map((f) => `- ${f}`));
}
if (unchecked.length > 0) {
  lines.push(
    '',
    `Not checked, no admin key in this environment: ${unchecked.join(', ')}.`,
  );
}
const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
writeFileSync('price-report.md', `${report}\n`);

// A missing admin key is an incomplete check, not a clean one (internal PR 213 review).
// Passed as a success, the workflow would close an open pricing issue on a
// run that never looked at what was billed. `--published-only` is for the
// weekly routine, which compares published prices and holds no admin keys.
const publishedOnly = process.argv.includes('--published-only');
// Likewise a bill that was read only in part (internal PR 213 review).
if (
  failed.length > 0 ||
  checked.length === 0 ||
  unread.length > 0 ||
  findings.some((finding) => finding.kind === 'rate-missing') ||
  (unchecked.length > 0 && !publishedOnly)
) {
  process.exit(2);
}
if (
  findings.some(
    (finding) =>
      finding.kind === 'under-billed' || finding.kind === 'over-billed',
  )
) {
  process.exit(1);
}
