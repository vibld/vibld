/**
 * Ask GitHub what the Vibld App is actually allowed to do.
 *
 * The App's permission levels are not on its public page and reading them
 * from the settings UI needs the owner's own browser session, so the only
 * thing that can answer this without a person looking is the App's own
 * credentials. `GET /app` authenticated with an App JWT returns exactly
 * that, and the deploy environment already holds the key.
 *
 * Why it is worth a check of its own: the push path mints a token asking for
 * `contents: write` and `pull_requests: write`, and GitHub answers 422 when
 * an installation cannot grant them. A read-only App therefore looks
 * perfectly configured (the key is set, the status route says `canPush`)
 * and fails at the last step of every push. That is the same shape as the
 * signup-credit cutoff: a green deploy that silently cannot do the thing.
 *
 * The rules live in `github-app-verdict.mjs` so they can be tested. What is
 * here is fetching and reporting.
 *
 * Nothing on any path prints key material. The key is read from the
 * environment, used to sign, and never echoed; the only thing reported is
 * what GitHub says the App may do.
 */
import { createSign } from 'node:crypto';

import { appVerdict, blocking } from './github-app-verdict.ts';
import type { Installation } from './github-app-verdict.ts';

const API = 'https://api.github.com';

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A short-lived App JWT.
 *
 * `iat` is backdated a minute for a clock that is a little slow and `exp` is
 * inside GitHub's ten-minute ceiling. The same numbers the Worker uses, for
 * the same reasons.
 */
function appJwt(appId: string, privateKey: string): string {
  const issuedAt = Math.floor(Date.now() / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: appId }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer
    .sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}

const appId = (process.env.VIBLD_GITHUB_APP_ID ?? '').trim();
const privateKey = process.env.VIBLD_GITHUB_PRIVATE_KEY ?? '';

if (!appId || !privateKey) {
  console.log(
    'VIBLD_GITHUB_APP_ID/VIBLD_GITHUB_PRIVATE_KEY not both set, so there is no App to ask about.',
  );
  process.exit(0);
}

let jwt: string;
try {
  jwt = appJwt(appId, privateKey);
} catch {
  // Deliberately not reporting the reason: it would be a message about the
  // shape of a private key.
  console.error(
    '::error::VIBLD_GITHUB_PRIVATE_KEY could not be used to sign. Paste the whole .pem, BEGIN and END lines included.',
  );
  process.exit(1);
}

function ask(path: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Vibld (+https://vibld.com)',
    },
  });
}

const response = await ask('/app');
if (!response.ok) {
  const hint =
    response.status === 401
      ? ' The App ID and the private key are probably not from the same App.'
      : '';
  console.error(
    `::error::GitHub refused to describe the App (HTTP ${response.status}).${hint}`,
  );
  process.exit(1);
}
const app = (await response.json()) as {
  slug: string;
  id: number;
  permissions?: Record<string, string>;
};

/** Each installation, and what it has actually accepted. */
async function installations(): Promise<
  | { ok: true; found: Installation[]; more: boolean }
  | { ok: false; status: number }
> {
  const found: Installation[] = [];
  let path: string | null = '/app/installations?per_page=100';
  for (let page = 0; page < 5 && path; page += 1) {
    const reply = await ask(path);
    if (!reply.ok) return { ok: false, status: reply.status };
    const batch = await reply.json();
    if (!Array.isArray(batch)) return { ok: false, status: reply.status };
    found.push(...batch);
    const next = /<([^>]+)>;\s*rel="next"/.exec(
      reply.headers.get('link') ?? '',
    );
    if (!next) {
      path = null;
      break;
    }
    const url = new URL(next[1]);
    path = url.pathname + url.search;
  }
  // A page the bound refused to follow. Said rather than swallowed: without
  // it, "no installations are lagging" would mean "none of the ones I got
  // round to looking at", which is the same silent truncation this pull
  // request has already fixed three times elsewhere.
  return { ok: true, found, more: path !== null };
}

const installed = await installations();
const verdict = appVerdict(
  app.permissions,
  installed.ok ? installed.found : null,
);

console.log(`App: ${app.slug} (id ${app.id})`);
console.log('Permissions GitHub reports for the App:');
for (const [name, level] of Object.entries(app.permissions ?? {}).sort()) {
  console.log(`  ${name}: ${level}`);
}
console.log(
  installed.ok
    ? `Installations: ${installed.found.length}${installed.more ? '+ (more than this check reads)' : ''}, of which ${verdict.lagging.length} have not accepted the App's current permissions`
    : `Installations: could not be read (HTTP ${installed.status}), so per-installation permissions were not checked`,
);

const faults: string[] = [];
if (verdict.missing.length) {
  faults.push(
    verdict.missing
      .map((one) => `\`${one.name}\` is \`${one.has}\`, needs \`${one.level}\``)
      .join('; '),
  );
}
if (verdict.extra.length) {
  faults.push(
    `holds ${verdict.extra.map((name) => `\`${name}\``).join(', ')}, which this feature does not use`,
  );
}

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const { appendFileSync } = await import('node:fs');
  const head = faults.length
    ? `GitHub App **${app.slug}**: ${faults.join('. ')}.`
    : `GitHub App **${app.slug}**: contents and pull requests are both write, and nothing else is held.`;
  const partial =
    installed.ok && installed.more
      ? ` Only the first ${installed.found.length} installations were checked.`
      : '';
  const lag = verdict.lagging.length
    ? `\n\n${verdict.lagging.length} installation(s) have not accepted the App's current permissions and answer 422 on every push: ${verdict.lagging
        .map((one) => `**${one.account}** (${one.short.join(', ')})`)
        .join(', ')}.`
    : '';
  appendFileSync(summary, `${head}${partial}${lag}\n`);
}

// Loud, and not fatal. An installation that has not accepted is somebody
// else's click rather than this deployment's configuration, and refusing to
// ship anything until another account acts would be worse than the thing it
// guards against.
for (const one of verdict.lagging) {
  console.error(
    `::warning::${one.account} has not accepted the App's current permissions (${one.short.join(', ')}). Pushes to it return 422 until they do.`,
  );
}
if (!installed.ok) {
  console.error(
    `::warning::Could not read the App's installations (HTTP ${installed.status}), so per-installation permissions were not checked.`,
  );
} else if (installed.more) {
  console.error(
    `::warning::More installations exist than this check reads, so "${verdict.lagging.length} lagging" covers only the first ${installed.found.length}.`,
  );
}

if (blocking(verdict)) {
  console.error(
    `::error::${faults.join('. ')}. Fix at https://github.com/settings/apps/${app.slug}/permissions, then accept the change on each installation.`,
  );
  process.exit(1);
}

console.log(
  'Contents and pull requests are both read and write, and nothing else is held.',
);
