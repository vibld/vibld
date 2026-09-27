/**
 * The plans, as the pricing page states them, read from the builder's own
 * source rather than restated here.
 *
 * The figures live in `apps/web/worker`: what each tier includes in
 * `entitlement.ts`, the one-time grant a new account gets (and whether it
 * waits for a card) in `signup-credit.ts`, and the prices and the top-up's credit beside the
 * Stripe lookup keys in `stripe-client.ts`. They cannot be imported the way
 * `catalogue.ts` imports the style presets, because those files belong to a
 * Worker and type-check against Workers bindings (and, for the last, the
 * Stripe SDK) this app does not have. So `plan-sources.ts` hands this module
 * their text (Vite's `?raw`), and the parsing is here, pure, so
 * `test/plans.test.ts` can hold it to the numbers the Worker actually runs on
 * and to the price table in docs/decisions.md (L36, L38).
 *
 * Two amounts per paid plan, and they are different kinds of number: the
 * price a subscription charges, and the model spend it includes each month.
 * The page never lets the second read as the first; the guide once did.
 */

export interface PlanSources {
  /** The text of `apps/web/worker/entitlement.ts`. */
  entitlement: string;
  /** The text of `apps/web/worker/signup-credit.ts`. */
  signupCredit: string;
  /** The text of `apps/web/worker/stripe-client.ts`. */
  stripeClient: string;
}

export interface Plan {
  id: 'free' | 'build' | 'ship';
  name: string;
  /** Included model spend each month, in US cents. */
  monthlyCents: number;
  /** What the subscription charges, in US cents; null for Free. */
  price: { monthly: number; annual: number } | null;
}

export interface Plans {
  plans: Plan[];
  /** The one-time grant a new account gets, in US cents. */
  signupCents: number;
  /**
   * Whether that grant waits for a card on file (a Stripe setup that charges
   * nothing), read from `SIGNUP_CREDIT_REQUIRES_CARD` beside the amount. The
   * copy states the condition from this rather than from memory, so the day
   * the builder stops asking for a card the page stops saying it does.
   */
  signupRequiresCard: boolean;
  /** A one-time top-up: what it costs and the model spend it adds. */
  topup: { priceCents: number; creditCents: number };
}

/** A numeric literal as written in TypeScript, underscores and all. */
function literal(text: string): number {
  const value = Number(text.replace(/_/g, ''));
  if (!Number.isFinite(value)) throw new Error(`Not a number: ${text}`);
  return value;
}

function find(source: string, pattern: RegExp, what: string): number {
  const match = pattern.exec(source);
  if (!match?.[1]) {
    // A build failure rather than a guess. The page would otherwise print a
    // plan the product does not sell, and nothing would notice.
    throw new Error(`Could not read ${what} from the builder's source`);
  }
  return literal(match[1]);
}

/** One entry of `PRICE_USD_CENTS` in stripe-client.ts. */
function price(source: string, key: string): number {
  return find(
    source,
    new RegExp(`PRICE_USD_CENTS\\s*=\\s*\\{[^}]*?\\b${key}:\\s*([\\d_]+)`),
    `the ${key} price`,
  );
}

export function readPlans(sources: PlanSources): Plans {
  const free = find(
    sources.entitlement,
    /DEFAULT_FREE_INCLUDED_MICRO_USD\s*=\s*([\d_]+)/,
    'the Free allowance',
  );
  const build = find(
    sources.entitlement,
    /TIER_INCLUDED_MICRO_USD[\s\S]*?\bbuild:\s*([\d_]+)/,
    'the Build allowance',
  );
  const ship = find(
    sources.entitlement,
    /TIER_INCLUDED_MICRO_USD[\s\S]*?\bship:\s*([\d_]+)/,
    'the Ship allowance',
  );
  const signup = find(
    sources.signupCredit,
    /DEFAULT_SIGNUP_CREDIT_USD_CENTS\s*=\s*([\d_]+)/,
    'the new-account grant',
  );
  const requiresCard = /SIGNUP_CREDIT_REQUIRES_CARD\s*=\s*(true|false)/.exec(
    sources.signupCredit,
  )?.[1];
  if (requiresCard === undefined) {
    throw new Error(
      "Could not read whether the new-account grant needs a card from the builder's source",
    );
  }
  const s = sources.stripeClient;
  const cents = (microUsd: number) => Math.round(microUsd / 10_000);
  return {
    plans: [
      { id: 'free', name: 'Free', monthlyCents: cents(free), price: null },
      {
        id: 'build',
        name: 'Build',
        monthlyCents: cents(build),
        price: {
          monthly: price(s, 'buildMonthly'),
          annual: price(s, 'buildAnnual'),
        },
      },
      {
        id: 'ship',
        name: 'Ship',
        monthlyCents: cents(ship),
        price: {
          monthly: price(s, 'shipMonthly'),
          annual: price(s, 'shipAnnual'),
        },
      },
    ],
    signupCents: signup,
    signupRequiresCard: requiresCard === 'true',
    topup: {
      priceCents: price(s, 'topup'),
      creditCents: find(
        s,
        /TOPUP_CREDIT_USD_CENTS\s*=\s*([\d_]+)/,
        'the top-up credit',
      ),
    },
  };
}

/** "$10.00", the way the guide writes an amount of credit. */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "$29", or "$29.50": a price, without cents when it has none. */
export function priceLabel(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : dollars(cents);
}
