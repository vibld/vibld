// Brings the live Stripe and Clerk accounts to the settings vibld relies on,
// as far as each vendor's API reaches (Chris, 2026-09-28).
//
// Run by .github/workflows/configure-accounts.yml, which holds the keys.
// `inspect` only reads and prints; `apply` writes, and is safe to repeat:
// every write sets a value rather than adding one, the coupon is created
// under a fixed id only when it does not exist yet, and the webhook
// endpoint's events are only ever added to.
//
// What the APIs do not reach (Stripe's own-account branding, public details
// and statement descriptor, Clerk's logo and application name) is a
// Dashboard step, and the run summary lists each one with its URL.
//
// The portal's own retention-coupon drop-down is deliberately not one of
// them and stays empty. It offers one coupon to every subscription, and the
// offer is for monthly plans only (Chris, 2026-09-28), which the Worker's
// own cancel flow (`/api/billing/cancel`) decides instead.

const STRIPE_API = 'https://api.stripe.com/v1';
const CLERK_API = 'https://api.clerk.com/v1';

export const PRICE_LOOKUP_KEYS = [
  'vibld_build_monthly',
  'vibld_build_annual',
  'vibld_ship_monthly',
  'vibld_ship_annual',
  'vibld_topup',
];

/**
 * The offer made to somebody cancelling a monthly plan: half off one month.
 *
 * Deliberately not limited to any product. Stripe keeps each tier's monthly
 * and annual prices on one product, so `applies_to` cannot tell them apart,
 * and this coupon would take half off a year if it were ever attached to an
 * annual invoice. It never is: the only place it is offered is the Worker's
 * cancel flow, which offers it only for a monthly price (`stripe-client.ts`'s
 * `RETENTION_COUPON_ID` and `isMonthlyPlanPrice`). The id is pinned to that
 * constant by this script's test.
 */
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

/** Where Stripe delivers this deployment's webhooks (`/api/stripe/webhook`). */
export const WEBHOOK_URL = 'https://app.vibld.com/api/stripe/webhook';

/**
 * Every event type the Worker acts on, which is every `case` in
 * `apps/web/worker/billing-events.ts`'s `applyStripeEvent` and the same list
 * as `billing-replay.ts`'s `REPLAYED_EVENT_TYPES`. The test reads both files
 * and fails if either drifts from this one.
 *
 * An endpoint missing one of these does not fail loudly: the nightly replay
 * still finds the event, a day late. A refund that takes a day to remove
 * what it paid for, or a saved card whose credit arrives tomorrow, is the
 * failure this list is here to prevent.
 */
export const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.closed',
  'setup_intent.succeeded',
];

/**
 * The events an endpoint has to gain, in the order this script lists them.
 * None for an endpoint subscribed to everything (`*`), which already
 * receives them all and would only be narrowed by writing a list.
 */
export function missingWebhookEvents(enabled) {
  if (enabled.includes('*')) return [];
  return REQUIRED_WEBHOOK_EVENTS.filter((type) => !enabled.includes(type));
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
  } else if (existing.status !== 404) {
    report.fail(
      `The retention coupon could not be read: ${stripeError(existing)}`,
    );
  } else if (!apply) {
    report.line(
      `- Would create \`${RETENTION_COUPON.id}\`: ${RETENTION_COUPON.percent_off}% off, ${RETENTION_COUPON.duration}, any product.`,
    );
  } else {
    const created = await stripe(key, 'POST', '/coupons', RETENTION_COUPON);
    if (created.status === 200) {
      report.line(
        `- Created \`${created.json.id}\`: ${created.json.percent_off}% off, ${created.json.duration}, any product.`,
      );
    } else {
      report.fail(`Retention coupon not created: ${stripeError(created)}`);
    }
  }

  await configureWebhookEndpoint(key, apply, report);

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

/**
 * Make sure the endpoint that delivers to the Worker sends every event the
 * Worker acts on. Only ever adds: an event somebody ticked by hand stays
 * ticked, and an endpoint on `*` is left alone.
 *
 * A missing endpoint is reported rather than created. A new endpoint comes
 * with a new signing secret, and the Worker verifies every delivery against
 * the one it already holds (`STRIPE_WEBHOOK_SECRET`), so creating one here
 * would add an endpoint whose every delivery is refused.
 */
async function configureWebhookEndpoint(key, apply, report) {
  report.line('### Webhook endpoint');
  const listed = await stripe(key, 'GET', '/webhook_endpoints?limit=100');
  if (listed.status !== 200) {
    report.fail(
      `Stripe webhook endpoints could not be read: ${stripeError(listed)}`,
    );
    return;
  }
  const endpoints = (listed.json.data ?? []).filter(
    (endpoint) => endpoint.url === WEBHOOK_URL,
  );
  if (endpoints.length === 0) {
    report.fail(
      `No webhook endpoint delivers to ${WEBHOOK_URL}. Not created here, because its new signing secret would not match the Worker's STRIPE_WEBHOOK_SECRET.`,
    );
    return;
  }
  for (const endpoint of endpoints) {
    const enabled = endpoint.enabled_events ?? [];
    const missing = missingWebhookEvents(enabled);
    report.line(
      `- \`${endpoint.id}\` (${endpoint.status}): ${enabled.includes('*') ? 'every event' : `${enabled.length} events`}` +
        `${missing.length > 0 ? `, missing ${missing.map((type) => `\`${type}\``).join(', ')}` : ', nothing missing'}.`,
    );
    if (missing.length === 0) continue;
    if (!apply) {
      report.line(
        `- Would add ${missing.length} events to \`${endpoint.id}\`.`,
      );
      continue;
    }
    const updated = await stripe(
      key,
      'POST',
      `/webhook_endpoints/${endpoint.id}`,
      { enabled_events: [...enabled, ...missing] },
    );
    if (updated.status === 200) {
      report.line(
        `- Added to \`${endpoint.id}\`: ${missing.map((type) => `\`${type}\``).join(', ')}.`,
      );
    } else {
      report.fail(
        `Events not added to webhook endpoint ${endpoint.id}: ${stripeError(updated)}`,
      );
    }
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
