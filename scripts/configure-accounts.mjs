// Brings the live Stripe and Clerk accounts to the settings vibld relies on,
// as far as each vendor's API reaches (Chris, 2026-09-28).
//
// Run by .github/workflows/configure-accounts.yml, which holds the keys.
// `inspect` only reads and prints; `apply` writes, and is safe to repeat:
// every write sets a value rather than adding one, and the coupon is created
// under a fixed id only when it does not exist yet.
//
// What the APIs do not reach (Stripe's own-account branding, public details
// and statement descriptor, the portal's retention-coupon drop-down, Clerk's
// logo and application name) is a Dashboard step, and the run summary lists
// each one with its URL.

const STRIPE_API = 'https://api.stripe.com/v1';
const CLERK_API = 'https://api.clerk.com/v1';

export const PRICE_LOOKUP_KEYS = [
  'vibld_build_monthly',
  'vibld_build_annual',
  'vibld_ship_monthly',
  'vibld_ship_annual',
  'vibld_topup',
];

/** The offer made to somebody cancelling a monthly plan: half off one month. */
export const RETENTION_COUPON = {
  id: 'vibld-retention-50-1mo',
  name: '50% off your next month',
  percent_off: 50,
  duration: 'once',
};

export const PORTAL_SETTINGS = {
  business_profile: {
    headline: 'Manage your vibld plan and billing',
    privacy_policy_url: 'https://vibld.com/legal/privacy',
    terms_of_service_url: 'https://vibld.com/legal/terms',
  },
  default_return_url: 'https://app.vibld.com/',
  features: {
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      proration_behavior: 'none',
      cancellation_reason: {
        enabled: true,
        options: [
          'too_expensive',
          'missing_features',
          'switched_service',
          'unused',
          'too_complex',
          'low_quality',
          'customer_service',
          'other',
        ],
      },
    },
  },
};

export const CLERK_INSTANCE_SETTINGS = { support_email: 'support@vibld.com' };

/**
 * Stripe's form encoding: nested objects as `a[b][c]`, arrays as `a[]`.
 * Returned as pairs so a test can read them without a URLSearchParams.
 */
export function formPairs(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item) => formPairs(item, `${prefix}[]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) =>
      formPairs(inner, prefix ? `${prefix}[${key}]` : key),
    );
  }
  return [[prefix, String(value)]];
}

/**
 * Which products the retention coupon may discount: the monthly plans'
 * products, and only when no annual price shares one. A coupon on a product
 * that also carries an annual price would take half off a whole year, which
 * is not the offer, so that case returns an error rather than a scope.
 */
export function retentionScope(prices) {
  const monthly = new Set();
  const annual = new Set();
  for (const price of prices) {
    const product =
      typeof price.product === 'string' ? price.product : price.product?.id;
    if (!product || price.recurring == null) continue;
    if (price.recurring.interval === 'month') monthly.add(product);
    if (price.recurring.interval === 'year') annual.add(product);
  }
  const shared = [...monthly].filter((product) => annual.has(product));
  if (monthly.size === 0) {
    return { error: 'No monthly plan price was found by lookup key.' };
  }
  if (shared.length > 0) {
    return {
      error: `Monthly and annual prices share product ${shared.join(', ')}, so a percentage coupon cannot be limited to one month.`,
    };
  }
  return { products: [...monthly].sort() };
}

async function stripe(key, method, path, body) {
  const url = `${STRIPE_API}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(formPairs(body)).toString() : undefined,
  });
  const json = await response.json();
  return { status: response.status, json };
}

async function clerk(key, method, path, body) {
  const response = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: response.status, json };
}

function stripeError(result) {
  return result.json?.error?.message ?? `HTTP ${result.status}`;
}

async function configureStripe(key, apply, report) {
  const query = new URLSearchParams(
    PRICE_LOOKUP_KEYS.map((k) => ['lookup_keys[]', k]),
  );
  query.append('expand[]', 'data.product');
  query.set('limit', '10');
  const prices = await stripe(key, 'GET', `/prices?${query}`);
  if (prices.status !== 200) {
    report.fail(`Stripe prices could not be read: ${stripeError(prices)}`);
    return;
  }
  report.line('### Stripe prices');
  for (const price of prices.json.data) {
    report.line(
      `- \`${price.lookup_key}\`: ${price.unit_amount / 100} ${price.currency.toUpperCase()}` +
        `${price.recurring ? ` per ${price.recurring.interval}` : ' one-time'}, product ${price.product?.id} (${price.product?.name})`,
    );
  }

  report.line('### Retention coupon');
  const existing = await stripe(key, 'GET', `/coupons/${RETENTION_COUPON.id}`);
  if (existing.status === 200) {
    const c = existing.json;
    report.line(
      `- \`${c.id}\` exists: ${c.percent_off}% off, ${c.duration}, products ${c.applies_to?.products?.join(', ') ?? 'all'}.`,
    );
  } else {
    const scope = retentionScope(prices.json.data);
    if (scope.error) {
      report.fail(`Retention coupon not created: ${scope.error}`);
    } else if (!apply) {
      report.line(
        `- Would create \`${RETENTION_COUPON.id}\` for products ${scope.products.join(', ')}.`,
      );
    } else {
      const created = await stripe(key, 'POST', '/coupons', {
        ...RETENTION_COUPON,
        applies_to: { products: scope.products },
      });
      if (created.status === 200) {
        report.line(
          `- Created \`${created.json.id}\` for products ${scope.products.join(', ')}.`,
        );
      } else {
        report.fail(`Retention coupon not created: ${stripeError(created)}`);
      }
    }
  }

  report.line('### Customer portal');
  const configs = await stripe(
    key,
    'GET',
    '/billing_portal/configurations?is_default=true&active=true&limit=1',
  );
  const current = configs.json?.data?.[0];
  if (configs.status !== 200 || !current) {
    report.fail(
      `The default portal configuration could not be read: ${stripeError(configs)}`,
    );
    return;
  }
  const cancel = current.features?.subscription_cancel;
  report.line(
    `- Default configuration \`${current.id}\`: cancel ${cancel?.enabled ? cancel.mode : 'off'}, ` +
      `reasons ${cancel?.cancellation_reason?.enabled ? 'on' : 'off'}, headline "${current.business_profile?.headline ?? ''}", ` +
      `privacy ${current.business_profile?.privacy_policy_url ?? 'none'}, terms ${current.business_profile?.terms_of_service_url ?? 'none'}.`,
  );
  if (!apply) {
    report.line(
      '- Would set the headline, policy links, return URL, end-of-period cancellation and cancellation reasons.',
    );
    return;
  }
  const updated = await stripe(
    key,
    'POST',
    `/billing_portal/configurations/${current.id}`,
    PORTAL_SETTINGS,
  );
  if (updated.status === 200) {
    report.line(
      '- Updated: headline, policy links, return URL, cancel at period end with no proration, cancellation reasons on.',
    );
  } else {
    report.fail(
      `The default portal configuration was not updated: ${stripeError(updated)}`,
    );
  }
}

async function configureClerk(key, apply, report) {
  report.line('### Clerk instance');
  const instance = await clerk(key, 'GET', '/instance');
  if (instance.status !== 200) {
    report.fail(
      `The Clerk instance could not be read: HTTP ${instance.status}`,
    );
    return;
  }
  report.line(
    `- Environment ${instance.json?.environment_type ?? 'unknown'}, support email ${instance.json?.support_email ?? 'none'}.`,
  );
  if (!apply) {
    report.line(
      `- Would set the support email to ${CLERK_INSTANCE_SETTINGS.support_email}.`,
    );
    return;
  }
  const updated = await clerk(
    key,
    'PATCH',
    '/instance',
    CLERK_INSTANCE_SETTINGS,
  );
  if (updated.status >= 200 && updated.status < 300) {
    report.line(
      `- Support email set to ${CLERK_INSTANCE_SETTINGS.support_email}.`,
    );
  } else {
    report.fail(`The Clerk support email was not set: HTTP ${updated.status}`);
  }
}

async function main() {
  const mode = process.env.CONFIGURE_MODE === 'apply' ? 'apply' : 'inspect';
  const lines = [`## Configure accounts (${mode})`];
  let failed = false;
  const report = {
    line: (text) => lines.push(text),
    fail: (text) => {
      failed = true;
      lines.push(`- **Failed:** ${text}`);
    },
  };
  if (process.env.STRIPE_SECRET_KEY) {
    await configureStripe(
      process.env.STRIPE_SECRET_KEY,
      mode === 'apply',
      report,
    );
  } else {
    report.fail('STRIPE_SECRET_KEY is not set.');
  }
  if (process.env.CLERK_SECRET_KEY) {
    await configureClerk(
      process.env.CLERK_SECRET_KEY,
      mode === 'apply',
      report,
    );
  } else {
    report.fail('CLERK_SECRET_KEY is not set.');
  }
  const text = `${lines.join('\n')}\n`;
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
