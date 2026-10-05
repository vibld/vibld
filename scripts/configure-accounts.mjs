// Brings the live Stripe and Clerk accounts to the settings vibld relies on,
// as far as each vendor's API reaches (Chris, 2026-09-28).
//
// Run by .github/workflows/configure-accounts.yml, which holds the keys.
// `inspect` only reads and prints; `apply` writes, and is safe to repeat:
// every write sets a value rather than adding one, the coupon is created
// under a fixed id only when it does not exist yet, the webhook endpoint's
// events are only ever added to, and a price is replaced only while its
// amount differs from `PRICE_AMOUNTS`.
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
 * What each lookup key's price charges, in US cents (docs/decisions.md L36
 * and L38, amended by D155 and D156). The same figures as
 * `PRICE_USD_CENTS` in `apps/web/worker/stripe-client.ts`, which this
 * script's test holds them to.
 *
 * A Stripe price's amount cannot be edited, so `apply` moves a mismatched
 * key to a new price on the same product, currency and interval
 * (`transfer_lookup_key`) and archives the old one. A subscription already
 * on the old price keeps it; checkout reads the key, so new ones get the new
 * amount.
 */
/**
 * Price metadata naming the lookup key a price was sold under, so a
 * subscription left on an old price after its key moves still resolves to
 * its plan (`stripe-client.ts`'s `PLAN_KEY_METADATA` and `planKeyOf`).
 */
export const PLAN_KEY_METADATA = 'vibld_lookup_key';

export const PRICE_AMOUNTS = {
  vibld_build_monthly: 1900,
  vibld_build_annual: 19000,
  vibld_ship_monthly: 4900,
  vibld_ship_annual: 49000,
  vibld_topup: 1000,
};

/**
 * The prices `apply` has to replace, from what Stripe listed: one entry per
 * key whose amount differs, with the body of the replacement. A key Stripe
 * does not have is reported, not created, since nothing here knows which
 * product it belongs on.
 */
export function plannedPriceMoves(prices) {
  const byKey = new Map(prices.map((price) => [price.lookup_key, price]));
  const missing = [];
  const moves = [];
  for (const [key, amount] of Object.entries(PRICE_AMOUNTS)) {
    const current = byKey.get(key);
    if (!current) {
      missing.push(key);
      continue;
    }
    if (current.unit_amount === amount) continue;
    const productId =
      typeof current.product === 'string'
        ? current.product
        : current.product?.id;
    moves.push({
      key,
      from: current,
      body: {
        product: productId,
        currency: current.currency,
        unit_amount: amount,
        ...(current.recurring
          ? {
              recurring: {
                interval: current.recurring.interval,
                interval_count: current.recurring.interval_count ?? 1,
              },
            }
          : {}),
        ...(current.tax_behavior && current.tax_behavior !== 'unspecified'
          ? { tax_behavior: current.tax_behavior }
          : {}),
        ...(current.nickname ? { nickname: current.nickname } : {}),
        metadata: { [PLAN_KEY_METADATA]: key },
        lookup_key: key,
        transfer_lookup_key: true,
      },
    });
  }
  return { missing, moves };
}

/**
 * What each plan's Stripe product says, keyed by the product's `vibld_tier`
 * metadata. Checkout and the Billing Portal show the description, so it has
 * to carry the included model spend of `TIER_INCLUDED_MICRO_USD` in
 * `apps/web/worker/entitlement.ts` and `TOPUP_CREDIT_USD_CENTS` in
 * `stripe-client.ts` (D155), which this script's test holds it to.
 */
export const PRODUCT_COPY = {
  build: {
    description:
      'All models, 30-minute previews, custom preview links. $14/mo included model spend.',
    included_credit_usd: '14',
  },
  ship: {
    description:
      'Priority sandboxes, deploy to your own host, higher concurrency. $40/mo included model spend.',
    included_credit_usd: '40',
  },
  topup: {
    description:
      'One-time credit top-up: $8 of included model spend, expires 12 months from purchase.',
    included_credit_usd: '8',
  },
};

/**
 * The update a product needs to match `PRODUCT_COPY`, or null when it
 * already does or is not one of vibld's plan products.
 */
export function plannedProductCopy(product) {
  const copy = PRODUCT_COPY[product.metadata?.vibld_tier];
  if (!copy) return null;
  if (
    product.description === copy.description &&
    product.metadata?.included_credit_usd === copy.included_credit_usd
  ) {
    return null;
  }
  return {
    description: copy.description,
    metadata: { included_credit_usd: copy.included_credit_usd },
  };
}

/**
 * What retiring superseded plan prices takes, from one product's active
 * prices: each active price stamped with a plan key it no longer holds (its
 * key moved to a newer price) is archived, and if it is the product's
 * default price, the default first moves to the price that holds the key
 * now, since Stripe refuses to archive a default price.
 *
 * Worked out from Stripe's current state rather than remembered from the
 * move, so a run that moved a key and then failed to tidy up is finished by
 * the next run.
 */
export function plannedRetirements(product, activePrices) {
  const holder = new Map(
    activePrices
      .filter((price) => price.lookup_key in PRICE_AMOUNTS)
      .map((price) => [price.lookup_key, price.id]),
  );
  const defaultPrice =
    typeof product.default_price === 'string'
      ? product.default_price
      : product.default_price?.id;
  const retire = [];
  let newDefault = null;
  for (const price of activePrices) {
    const stamped = price.metadata?.[PLAN_KEY_METADATA];
    if (!stamped || price.lookup_key === stamped) continue;
    const successor = holder.get(stamped);
    // Never archive a plan price nothing replaces: checkout would have no
    // price for the key at all.
    if (!successor) continue;
    retire.push(price.id);
    if (price.id === defaultPrice) newDefault = successor;
  }
  return { retire, newDefault };
}

/** The listed prices not yet stamped with the lookup key they carry. */
export function unstampedPrices(prices) {
  return prices.filter(
    (price) =>
      price.lookup_key in PRICE_AMOUNTS &&
      price.metadata?.[PLAN_KEY_METADATA] !== price.lookup_key,
  );
}

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
 * Where the Worker's endpoint used to be. The Worker answered on its
 * workers.dev address until app.vibld.com became its custom domain, and a
 * custom domain turns the workers.dev address off (Cloudflare error 1042),
 * so an endpoint still pointing there reaches nothing. Moving the endpoint's
 * URL keeps its signing secret, which is what the Worker verifies with; a
 * new endpoint would not. Only these exact addresses are moved.
 */
export const LEGACY_WEBHOOK_URLS = [
  'https://vibld-web-preview.chris-brock-llc.workers.dev/api/stripe/webhook',
];

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

async function retirePredecessors(key, apply, report) {
  const query = new URLSearchParams(
    PRICE_LOOKUP_KEYS.map((k) => ['lookup_keys[]', k]),
  );
  query.set('limit', '10');
  const keyed = await stripe(key, 'GET', `/prices?${query}`);
  if (keyed.status !== 200) {
    report.fail(`Stripe prices could not be re-read: ${stripeError(keyed)}`);
    return;
  }
  const productIds = [
    ...new Set(
      keyed.json.data.map((price) =>
        typeof price.product === 'string' ? price.product : price.product?.id,
      ),
    ),
  ];
  for (const productId of productIds) {
    const product = await stripe(key, 'GET', `/products/${productId}`);
    const active = await stripe(
      key,
      'GET',
      `/prices?product=${productId}&active=true&limit=100`,
    );
    if (product.status !== 200 || active.status !== 200) {
      report.fail(
        `Product ${productId}'s prices could not be read: ${stripeError(product.status !== 200 ? product : active)}`,
      );
      continue;
    }
    const copy = plannedProductCopy(product.json);
    if (copy && !apply) {
      report.line(
        `- Would set ${productId}'s description to "${copy.description}".`,
      );
    } else if (copy) {
      const updated = await stripe(key, 'POST', `/products/${productId}`, copy);
      if (updated.status === 200) {
        report.line(
          `- Set ${productId}'s description to "${copy.description}".`,
        );
      } else {
        report.fail(
          `${productId}'s description was not updated: ${stripeError(updated)}`,
        );
      }
    }
    const { retire, newDefault } = plannedRetirements(
      product.json,
      active.json.data,
    );
    if (retire.length === 0) continue;
    if (!apply) {
      report.line(
        `- Would archive ${retire.map((id) => `\`${id}\``).join(', ')} on ${productId}` +
          (newDefault ? `, default price moving to \`${newDefault}\`.` : '.'),
      );
      continue;
    }
    if (newDefault) {
      const updated = await stripe(key, 'POST', `/products/${productId}`, {
        default_price: newDefault,
      });
      if (updated.status !== 200) {
        report.fail(
          `Product ${productId}'s default price was not moved to ${newDefault}, so nothing on it was archived: ${stripeError(updated)}`,
        );
        continue;
      }
    }
    for (const id of retire) {
      const archived = await stripe(key, 'POST', `/prices/${id}`, {
        active: false,
      });
      if (archived.status === 200) {
        report.line(`- Archived superseded price \`${id}\`.`);
      } else {
        report.fail(`\`${id}\` was not archived: ${stripeError(archived)}`);
      }
    }
  }
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
  // Stamped before any key moves: the stamp is what keeps a subscription on
  // the old price resolvable once the key has left it.
  for (const price of unstampedPrices(prices.json.data)) {
    if (!apply) {
      report.line(
        `- Would stamp \`${price.id}\` with ${PLAN_KEY_METADATA}=${price.lookup_key}.`,
      );
      continue;
    }
    const stamped = await stripe(key, 'POST', `/prices/${price.id}`, {
      metadata: { [PLAN_KEY_METADATA]: price.lookup_key },
    });
    if (stamped.status !== 200) {
      report.fail(
        `\`${price.id}\` was not stamped, so no key was moved: ${stripeError(stamped)}`,
      );
      return;
    }
    report.line(
      `- Stamped \`${price.id}\` with ${PLAN_KEY_METADATA}=${price.lookup_key}.`,
    );
  }
  const { missing, moves } = plannedPriceMoves(prices.json.data);
  for (const key of missing) {
    report.fail(`No Stripe price has lookup key \`${key}\`.`);
  }
  for (const move of moves) {
    const what = `\`${move.key}\` from ${move.from.unit_amount / 100} to ${move.body.unit_amount / 100} ${move.body.currency.toUpperCase()}`;
    if (!apply) {
      report.line(`- Would move ${what}.`);
      continue;
    }
    const created = await stripe(key, 'POST', '/prices', move.body);
    if (created.status !== 200) {
      report.fail(`Could not move ${what}: ${stripeError(created)}`);
      continue;
    }
    report.line(`- Moved ${what}: ${created.json.id} now holds the key.`);
  }
  await retirePredecessors(key, apply, report);

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
  let endpoints = (listed.json.data ?? []).filter(
    (endpoint) => endpoint.url === WEBHOOK_URL,
  );
  const legacy = (listed.json.data ?? []).filter((endpoint) =>
    LEGACY_WEBHOOK_URLS.includes(endpoint.url),
  );
  if (endpoints.length === 0 && legacy.length > 0) {
    if (!apply) {
      for (const endpoint of legacy) {
        report.line(
          `- Would move \`${endpoint.id}\` from ${endpoint.url} to ${WEBHOOK_URL}.`,
        );
      }
      endpoints = legacy;
    } else {
      const moved = [];
      for (const endpoint of legacy) {
        const updated = await stripe(
          key,
          'POST',
          `/webhook_endpoints/${endpoint.id}`,
          { url: WEBHOOK_URL },
        );
        if (updated.status === 200) {
          report.line(
            `- Moved \`${endpoint.id}\` from ${endpoint.url} to ${WEBHOOK_URL}; its signing secret is unchanged.`,
          );
          moved.push(updated.json);
        } else {
          report.fail(
            `Webhook endpoint ${endpoint.id} was not moved to ${WEBHOOK_URL}: ${stripeError(updated)}`,
          );
        }
      }
      endpoints = moved;
    }
  }
  if (endpoints.length === 0) {
    // The addresses Stripe does deliver to, so a run that finds none says
    // where the Worker's endpoint went instead of only that it is missing.
    // A webhook URL is not a secret; its signing secret is not listed.
    const others = (listed.json.data ?? []).map(
      (endpoint) => `${endpoint.url} (${endpoint.status})`,
    );
    report.fail(
      `No webhook endpoint delivers to ${WEBHOOK_URL}. Not created here, because its new signing secret would not match the Worker's STRIPE_WEBHOOK_SECRET. ` +
        `Endpoints on this account: ${others.length > 0 ? others.join(', ') : 'none'}.`,
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
