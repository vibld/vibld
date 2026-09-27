/**
 * Whether each provider still serves every model the catalogue offers, at
 * the limits it records, and whether it serves a newer version of a family
 * offered here.
 *
 * Reads each provider's models list with the key the builder itself uses:
 * `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`. A provider
 * whose key is absent is reported as not checked rather than passed.
 *
 * The rules are in `@vibld/ai`'s `served-check.ts`, tested against the
 * documented response shapes. This file fetches and reports.
 *
 * Writes the report to stdout and, in Actions, to the job summary and to
 * `catalogue-report.md`. Exits 1 on a finding, 2 when a provider could not
 * be checked, 0 otherwise.
 *
 * Nothing on any path prints key material: a failed request reports its
 * host and status only.
 */
import { appendFileSync, writeFileSync } from 'node:fs';

import {
  MODEL_CATALOGUE,
  anthropicServedModel,
  compareServed,
  listedModels,
} from '@vibld/ai';
import type { ServedFinding, ServedModel } from '@vibld/ai';

async function getJson(
  url: URL,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    // The status only. A body can echo request details back, and this
    // output lands in an issue.
    throw new Error(`${url.host} answered ${response.status}`);
  }
  return response.json();
}

/** Every page of Anthropic's list, bounded so a broken cursor cannot spin. */
async function anthropicServed(key: string): Promise<ServedModel[]> {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const served: ServedModel[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    const body = (await getJson(url, headers)) as {
      data?: unknown[];
      has_more?: boolean;
      last_id?: string | null;
    };
    if (!Array.isArray(body.data)) {
      throw new Error('api.anthropic.com answered without a data array');
    }
    served.push(...body.data.map(anthropicServedModel));
    if (!body.has_more || !body.last_id) return served;
    after = body.last_id;
  }
  throw new Error('api.anthropic.com kept paging past 20 pages');
}

async function openaiServed(key: string): Promise<ServedModel[]> {
  return listedModels(
    await getJson(new URL('https://api.openai.com/v1/models'), {
      authorization: `Bearer ${key}`,
    }),
  );
}

async function deepseekServed(key: string): Promise<ServedModel[]> {
  return listedModels(
    await getJson(new URL('https://api.deepseek.com/models'), {
      authorization: `Bearer ${key}`,
    }),
  );
}

const served: Parameters<typeof compareServed>[0] = {};
const checked: string[] = [];
const unchecked: string[] = [];
const failed: string[] = [];

for (const [provider, label, key, read] of [
  ['anthropic', 'Anthropic', process.env.ANTHROPIC_API_KEY, anthropicServed],
  ['openai', 'OpenAI', process.env.OPENAI_API_KEY, openaiServed],
  ['deepseek', 'DeepSeek', process.env.DEEPSEEK_API_KEY, deepseekServed],
] as const) {
  if (!key) {
    unchecked.push(label);
    continue;
  }
  try {
    served[provider] = await read(key);
    checked.push(`${label} (${served[provider]!.length} models listed)`);
  } catch (error) {
    failed.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const findings = compareServed(served, MODEL_CATALOGUE);

function describe(finding: ServedFinding): string {
  switch (finding.kind) {
    case 'not-served':
      return `\`${finding.model}\` (${finding.provider})`;
    case 'limit-differs':
      return `\`${finding.model}\` ${finding.field}: catalogue ${finding.catalogue}, served ${finding.served}`;
    case 'newer-version':
      return `\`${finding.model}\` (${finding.provider}), newer than \`${finding.newestOffered}\``;
  }
}

const TITLES: Record<ServedFinding['kind'], string> = {
  'not-served': 'Offered here, no longer listed by the provider',
  'limit-differs': 'Served with a different limit than the catalogue records',
  'newer-version': 'A newer version of a family offered here',
};

const lines: string[] = ['## Model catalogue check', ''];
if (checked.length > 0) lines.push(`Checked: ${checked.join('; ')}.`, '');
for (const kind of Object.keys(TITLES) as ServedFinding['kind'][]) {
  const ofKind = findings.filter((finding) => finding.kind === kind);
  if (ofKind.length === 0) continue;
  lines.push(
    `### ${TITLES[kind]}`,
    '',
    ...ofKind.map((f) => `- ${describe(f)}`),
    '',
  );
}
if (findings.length === 0 && checked.length > 0) {
  lines.push('Every model offered is served, at the limits recorded.', '');
}
if (failed.length > 0) {
  lines.push('### Could not check', '', ...failed.map((f) => `- ${f}`), '');
}
if (unchecked.length > 0) {
  lines.push(
    `Not checked, no key in this environment: ${unchecked.join(', ')}.`,
  );
}
const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
writeFileSync('catalogue-report.md', `${report}\n`);

// A provider not read is an incomplete check, not a clean one: passed as a
// success, the workflow would close an open issue on a run that never
// looked.
if (failed.length > 0 || unchecked.length > 0) process.exit(2);
if (findings.length > 0) process.exit(1);
