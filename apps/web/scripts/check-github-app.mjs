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
 * Nothing here prints key material. The key is read from the environment,
 * used to sign, and never echoed; the only thing reported is what GitHub
 * says the App may do.
 */
import { createSign } from 'node:crypto';

const NEEDED = { contents: 'write', pull_requests: 'write' };

function base64Url(value) {
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
 * nine minutes past that, which is inside GitHub's ten-minute ceiling. The
 * same numbers the Worker uses, for the same reasons.
 */
function appJwt(appId, privateKey) {
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

let jwt;
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

const response = await fetch('https://api.github.com/app', {
  headers: {
    authorization: `Bearer ${jwt}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Vibld (+https://vibld.com)',
  },
});

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

const app = await response.json();
const granted = app.permissions ?? {};

console.log(`App: ${app.slug} (id ${app.id})`);
console.log(`Installations: ${app.installations_count ?? 'unknown'}`);
console.log('Permissions GitHub reports:');
for (const [name, level] of Object.entries(granted).sort()) {
  console.log(`  ${name}: ${level}`);
}

const wrong = Object.entries(NEEDED).filter(
  ([name, level]) => granted[name] !== level,
);

const summary = process.env.GITHUB_STEP_SUMMARY;
const note = wrong.length
  ? `GitHub App **${app.slug}**: ${wrong
      .map(
        ([name, level]) =>
          `\`${name}\` is \`${granted[name] ?? 'absent'}\`, needs \`${level}\``,
      )
      .join('; ')}.`
  : `GitHub App **${app.slug}**: contents and pull_requests are both write, and ${app.installations_count ?? 0} installation(s) exist.`;
if (summary) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(summary, `${note}\n`);
}

if (wrong.length) {
  console.error(
    `::error::${wrong
      .map(
        ([name, level]) =>
          `${name} is "${granted[name] ?? 'absent'}" and must be "${level}"`,
      )
      .join(
        '; ',
      )}. Set them at https://github.com/settings/apps/${app.slug}/permissions, then accept the change on each installation. Until then every push returns 422.`,
  );
  process.exit(1);
}

console.log('Contents and pull requests are both read and write.');
