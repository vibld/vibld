import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkDesign } from '../src/design-checks.ts';
import { findSecrets } from '../src/secrets.ts';

/**
 * Key-shaped strings, assembled at run time so this file holds no string a
 * secret scanner would stop a push for.
 */
const random = 'q7Zr2Lm9Xc4Vb8Nt1Kw6Hy3Js5Df0Ga';
const keys = {
  anthropic: ['sk', 'ant', `api03-${random}${random}`].join('-'),
  openai: ['sk', `proj-${random}${random}`].join('-'),
  stripe: ['sk', 'live', random].join('_'),
  aws: 'AKIA' + 'Q7ZR2LM9XC4VB8NT',
  github: ['ghp', random + 'Ab12Cd'].join('_'),
  slack: ['xoxb', '1234567890', random].join('-'),
  slackApp: ['xapp', '1', 'A0123456789', random].join('-'),
  supabase: ['sb', 'secret', random].join('_'),
  webhook: ['whsec', random].join('_'),
  supabaseAccess: ['sbp', (random + random).slice(0, 40)].join('_'),
  installation: [
    'ghs',
    '123456',
    `eyJ${random}.${random}${random}.${random}${random}`,
  ].join('_'),
  slackRefresh: ['xoxe', '1', random].join('-'),
  sendgrid: ['SG', random.slice(0, 22), (random + random).slice(0, 43)].join(
    '.',
  ),
  pem: [
    '-----BEGIN',
    'RSA PRIVATE KEY-----\\n' + 'MIIEow' + random + random,
  ].join(' '),
};

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return [
    part({ alg: 'HS256', typ: 'JWT' }),
    part(claims),
    random + random,
  ].join('.');
}

const file = (content: string, path = 'src/lib/api.ts') => ({ path, content });

describe('findSecrets (D213)', () => {
  it('finds each kind of key, in code and in comments', () => {
    for (const [name, key] of Object.entries(keys)) {
      const found = findSecrets([file(`const k = "${key}";`)]);
      assert.equal(found.length, 1, name);
      assert.equal(found[0]!.path, 'src/lib/api.ts');
    }
    assert.equal(findSecrets([file(`// ${keys.stripe}`)]).length, 1);
    assert.equal(
      findSecrets([file(`const k = '${keys.anthropic}';`)])[0]!.kind,
      'an Anthropic API key',
    );
  });

  it('reads a placeholder word only at the start of a segment', () => {
    const fakeInside = ['sk', 'live', 'q7Zr2Lm9fakeXc4Vb8Nt'].join('_');
    assert.equal(findSecrets([file(`k = "${fakeInside}"`)]).length, 1);
    const fakeStart = ['sk', 'live', 'fakeq7Zr2Lm9Xc4Vb8Nt'].join('_');
    assert.deepEqual(findSecrets([file(`k = "${fakeStart}"`)]), []);
    const rotating = `xoxe.${keys.slackApp}`;
    assert.equal(findSecrets([file(`k = "${rotating}"`)]).length, 1);
  });

  it("tells Supabase's service role key from its public anon key", () => {
    const service = jwt({ role: 'service_role', iss: 'supabase' });
    const anon = jwt({ role: 'anon', iss: 'supabase' });
    assert.deepEqual(findSecrets([file(`key: '${service}'`)]), [
      { path: 'src/lib/api.ts', kind: 'a Supabase service role key' },
    ]);
    assert.deepEqual(findSecrets([file(`key: '${anon}'`)]), []);
    const other = jwt({
      role: 'service_role',
      iss: 'https://auth.example.org',
    });
    assert.deepEqual(findSecrets([file(`key: '${other}'`)]), []);
  });

  it('leaves public keys, placeholders and ordinary identifiers alone', () => {
    const clean = [
      `const pk = "${['pk', 'live', random].join('_')}";`,
      `const k = "${['sk', 'live', 'x'.repeat(24)].join('_')}";`,
      `const k = "${['sk', 'test', 'YOUR_KEY_HERE_0123456'].join('_')}";`,
      'const task = "sk-ant-short";',
      'export const disk_live_mode = true;',
      `const pub = "${['sb', 'publishable', random].join('_')}";`,
      `const sample = "${'AKIA' + 'IOSFODNN7EXAMPLE'}";`,
      `const id = "fixture_${'AKIA' + 'Q7ZR2LM9XC4VB8NT'}_enabled";`,
      `const flag = "${['sk', 'live', 'abcdefghijklmnop'].join('_')}_enabled";`,
      `const name = "${['ghp', random + 'Ab12Cd'].join('_')}_suffix";`,
      'const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;',
      `// Paste it as "${['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')}\\nMIIE..."`,
    ];
    for (const content of clean) {
      assert.deepEqual(findSecrets([file(content)]), [], content);
    }
  });

  it('reports one finding per kind per file, and never the key', () => {
    const found = findSecrets([
      file(`a = "${keys.stripe}"; b = "${keys.stripe}x";`),
      file(`c = "${keys.aws}"`, '.env'),
    ]);
    assert.deepEqual(found, [
      { path: 'src/lib/api.ts', kind: 'a Stripe secret key' },
      { path: '.env', kind: 'an AWS access key id' },
    ]);
  });
});

describe('checkDesign with a key in the code (D213)', () => {
  it('is an error that names the file and the kind, not the key', () => {
    const report = checkDesign([
      file(`export const stripe = "${keys.stripe}";`),
    ]);
    const secret = report.errors.filter((e) => e.check === 'secret');
    assert.equal(secret.length, 1);
    assert.match(
      secret[0]!.detail,
      /^src\/lib\/api\.ts contains a Stripe secret key\./,
    );
    assert.ok(!secret[0]!.detail.includes(keys.stripe));
    // First, so a repair prompt's capped list always carries it.
    assert.equal(report.errors[0]!.check, 'secret');
  });

  it('is a warning in DESIGN.md, which a repair cannot change', () => {
    const report = checkDesign([
      file(`Billing uses ${keys.stripe}.`, 'DESIGN.md'),
    ]);
    assert.equal(report.errors.filter((e) => e.check === 'secret').length, 0);
    assert.equal(report.warnings.filter((w) => w.check === 'secret').length, 1);
  });
});
