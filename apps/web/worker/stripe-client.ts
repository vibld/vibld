import Stripe from 'stripe';

/**
 * Stripe billing (docs/decisions.md L12-L15).
 *
 * The official SDK, the same choice `@vibld/ai` makes for Anthropic and for
 * the same reason: a maintained client beats a hand-rolled one for a vendor
 * that already ships a good one (DeepSeek, with none, is the one exception
 * in this repo). `Stripe.createFetchHttpClient()` is what makes it work on
 * Workers -- the SDK's default HTTP client assumes Node's `http` module,
 * which does not exist here.
 */

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
}

export function stripeConfigured(env: StripeEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function createStripeClient(env: StripeEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY!, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export type Tier = 'build' | 'ship';

/**
 * Stripe `lookup_key`s, not price ids -- the ids are free to change (a price
 * correction, say) without a code change, which is the entire point of
 * naming a price at all. These five already exist in the live Vibld Stripe
 * account, created to match docs/decisions.md L36/L38 exactly:
 * Build $29/mo or $290/yr, Ship $99/mo or $990/yr, Top-up $20 one-time.
 */
export const PRICE_LOOKUP_KEYS = {
  buildMonthly: 'vibld_build_monthly',
  buildAnnual: 'vibld_build_annual',
  shipMonthly: 'vibld_ship_monthly',
  shipAnnual: 'vibld_ship_annual',
  topup: 'vibld_topup',
} as const;

/**
 * What each of those prices charges, in US cents, keyed exactly as
 * `PRICE_LOOKUP_KEYS` is.
 *
 * Nothing in this Worker charges from these: Stripe does, from the price the
 * lookup key names, and a checkout never trusts an amount written here. They
 * exist so the one other place that has to state them, the pricing page on
 * vibld.com (`apps/marketing/app/plans.ts`), reads them from beside the keys
 * rather than from a second copy. A test there pins every figure to
 * docs/decisions.md L36/L38, so a change here without a decision fails, and
 * so does a decision nobody carried into Stripe and this file.
 */
export const PRICE_USD_CENTS = {
  buildMonthly: 2900,
  buildAnnual: 29000,
  shipMonthly: 9900,
  shipAnnual: 99000,
  topup: 2000,
} as const satisfies Record<keyof typeof PRICE_LOOKUP_KEYS, number>;

/**
 * The coupon offered to somebody cancelling a monthly plan: 50% off one
 * month, once (Chris, 2026-09-28). `scripts/configure-accounts.mjs` creates
 * it in Stripe under this id, and a test there pins the two together.
 *
 * The coupon itself applies to any product. Stripe keeps each tier's monthly
 * and annual prices on one product, so a coupon cannot be limited to the
 * monthly price by product, and a percentage off an annual invoice would be
 * half a year's fee rather than half a month's. What keeps it to monthly
 * subscribers is that the only place it is offered is vibld's own cancel
 * flow (`billing-checkout.ts`'s `createCancelSession`), which offers it only
 * for a price `isMonthlyPlanPrice` accepts. The Billing Portal's own
 * retention setting stays empty, because it cannot tell the two apart.
 */
export const RETENTION_COUPON_ID = 'vibld-retention-50-1mo';

const MONTHLY_PLAN_LOOKUP_KEYS: readonly string[] = [
  PRICE_LOOKUP_KEYS.buildMonthly,
  PRICE_LOOKUP_KEYS.shipMonthly,
];

/**
 * Whether a subscribed price is one of the monthly plans, and so one the
 * retention coupon may be offered against.
 *
 * Both tests, not either. The lookup key says which plan was sold, and the
 * interval says what the price actually bills: a key reused on a price with
 * a different interval (a correction made in the Dashboard, say) must not
 * turn a year's invoice into one the coupon halves.
 */
export function isMonthlyPlanPrice(price: {
  lookup_key: string | null;
  recurring: { interval: string } | null;
}): boolean {
  return (
    price.recurring?.interval === 'month' &&
    price.lookup_key !== null &&
    MONTHLY_PLAN_LOOKUP_KEYS.includes(price.lookup_key)
  );
}

const TIER_LOOKUP_KEYS: Record<string, Tier> = {
  [PRICE_LOOKUP_KEYS.buildMonthly]: 'build',
  [PRICE_LOOKUP_KEYS.buildAnnual]: 'build',
  [PRICE_LOOKUP_KEYS.shipMonthly]: 'ship',
  [PRICE_LOOKUP_KEYS.shipAnnual]: 'ship',
};

/**
 * Which tier a subscribed price belongs to, from the price's own
 * `lookup_key` -- never from its id, which is free to change, and never
 * from its amount, which would silently misclassify a corrected price.
 * `undefined` for a price this deployment does not recognise (the top-up
 * price, or anything created outside `PRICE_LOOKUP_KEYS`) rather than a
 * guess: a subscription record with no tier is a bug to notice, not paper
 * over.
 */
export function tierForLookupKey(lookupKey: string | null): Tier | undefined {
  return lookupKey ? TIER_LOOKUP_KEYS[lookupKey] : undefined;
}

export type PurchaseOption =
  | {
      kind: 'subscription';
      tier: 'build' | 'ship';
      interval: 'monthly' | 'annual';
    }
  | { kind: 'topup' };

/** The lookup_key for a chosen purchase -- the one place this mapping lives. */
export function lookupKeyFor(option: PurchaseOption): string {
  if (option.kind === 'topup') return PRICE_LOOKUP_KEYS.topup;
  const key =
    `${option.tier}${option.interval === 'annual' ? 'Annual' : 'Monthly'}` as
      'buildMonthly' | 'buildAnnual' | 'shipMonthly' | 'shipAnnual';
  return PRICE_LOOKUP_KEYS[key];
}

/** L36's top-up: $20 for $8 of included model spend, expiring in 12 months. */
export const TOPUP_CREDIT_USD_CENTS = 800;

/**
 * Stamped on the Checkout Session and the SetupIntent that save a card for
 * the welcome credit (`billing-checkout.ts`), and read back by the webhook
 * (`billing-events.ts`). A card saved any other way, through the Billing
 * Portal say, carries no such mark and pays nothing: the credit is for the
 * flow that offered it, not for every card that reaches Stripe.
 *
 * Stripe metadata can be written only with this deployment's secret key, so
 * the mark is ours to trust in a way a browser-supplied value never is.
 */
export const PURPOSE_METADATA_KEY = 'vibld_purpose';
export const SIGNUP_CARD_PURPOSE = 'signup_credit';
