#!/usr/bin/env node
/**
 * Brings the preview zone to what custom domains need (docs/decisions.md
 * D189): a proxied record for the fallback origin, and Cloudflare for SaaS
 * pointed at it. Every custom hostname then sends its traffic to
 * apps/preview's route on the zone, which hands it to apps/publish.
 *
 * `CONFIGURE_MODE=inspect` (the default) only reads; `apply` writes and is
 * safe to repeat. Run by .github/workflows/configure-custom-hostnames.yml.
 *
 * Needs CUSTOM_HOSTNAME_API_TOKEN, a token with Zone: SSL and Certificates:
 * Edit and Zone: DNS: Edit on vibld-preview.dev. The zone and the fallback
 * origin are the values apps/web/wrangler.jsonc carries.
 */

export const ZONE_ID = '3f49356ba40be20bd9094c2c73e1c2a0';
export const FALLBACK_ORIGIN = 'domains.vibld-preview.dev';

/**
 * What has to change, from what the zone has now. Pure, so the test can
 * say what `apply` would do without a Cloudflare account.
 */
export function plan({ records, fallback }) {
  const steps = [];
  const record = records.find((entry) => entry.name === FALLBACK_ORIGIN);
  if (!record) {
    steps.push({
      kind: 'record',
      say: `Add a proxied AAAA record ${FALLBACK_ORIGIN} -> 100::`,
    });
  } else if (!record.proxied) {
    steps.push({
      kind: 'proxy',
      id: record.id,
      say: `Proxy the existing ${record.type} record ${FALLBACK_ORIGIN}`,
    });
  }
  if (fallback?.origin !== FALLBACK_ORIGIN) {
    steps.push({
      kind: 'fallback',
      say: `Set the fallback origin to ${FALLBACK_ORIGIN} (now ${fallback?.origin ?? 'none'})`,
    });
  }
  return steps;
}

async function call(token, path, init = {}) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    },
  );
  const body = await response.json().catch(() => null);
  return {
    ok: response.ok && body?.success === true,
    result: body?.result,
    errors: (body?.errors ?? []).map(
      (error) => `${error.code} ${error.message}`,
    ),
  };
}

async function main() {
  const token = process.env.CUSTOM_HOSTNAME_API_TOKEN;
  const mode = process.env.CONFIGURE_MODE === 'apply' ? 'apply' : 'inspect';
  if (!token) {
    console.error(
      'CUSTOM_HOSTNAME_API_TOKEN is not set on the "preview" environment.',
    );
    process.exit(1);
  }

  const records = await call(
    token,
    `/dns_records?name=${encodeURIComponent(FALLBACK_ORIGIN)}`,
  );
  if (!records.ok) {
    console.error('Reading DNS records failed:', records.errors.join('; '));
    process.exit(1);
  }
  const fallback = await call(token, '/custom_hostnames/fallback_origin');
  if (!fallback.ok && !fallback.errors.some((e) => e.startsWith('1551'))) {
    // 1551: no fallback origin yet, which `apply` sets. Anything else, such
    // as an authentication error, means the token or the zone is not ready.
    console.error(
      'Reading the fallback origin failed:',
      fallback.errors.join('; '),
    );
    console.error(
      'Check that the token has Zone: SSL and Certificates: Edit on vibld-preview.dev.',
    );
    process.exit(1);
  }

  const steps = plan({
    records: records.result ?? [],
    fallback: fallback.ok ? fallback.result : null,
  });
  console.log(
    fallback.ok
      ? `Fallback origin: ${fallback.result?.origin} (${fallback.result?.status})`
      : 'Fallback origin: none',
  );
  if (steps.length === 0) {
    console.log('Nothing to change.');
    return;
  }
  for (const step of steps)
    console.log(`${mode === 'apply' ? 'Doing' : 'Would'}: ${step.say}`);
  if (mode !== 'apply') return;

  for (const step of steps) {
    const done =
      step.kind === 'record'
        ? await call(token, '/dns_records', {
            method: 'POST',
            body: JSON.stringify({
              type: 'AAAA',
              name: FALLBACK_ORIGIN,
              content: '100::',
              proxied: true,
              comment: 'Custom domains fallback origin (D189)',
            }),
          })
        : step.kind === 'proxy'
          ? await call(token, `/dns_records/${step.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ proxied: true }),
            })
          : await call(token, '/custom_hostnames/fallback_origin', {
              method: 'PUT',
              body: JSON.stringify({ origin: FALLBACK_ORIGIN }),
            });
    if (!done.ok) {
      console.error(`Failed: ${step.say}:`, done.errors.join('; '));
      process.exit(1);
    }
    console.log(`Done: ${step.say}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
