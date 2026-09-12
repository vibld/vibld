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
