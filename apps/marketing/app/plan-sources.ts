import entitlement from '../../web/worker/entitlement.ts?raw';
import signupCredit from '../../web/worker/signup-credit.ts?raw';
import stripeClient from '../../web/worker/stripe-client.ts?raw';

import { readPlans } from './plans.ts';

/**
 * The plans, read at build time from the builder's own source. See
 * `plans.ts` for why this is text rather than an import, and turbo.json for
 * why a change to any of these three files rebuilds this site.
 */
export const PLANS = readPlans({ entitlement, signupCredit, stripeClient });
