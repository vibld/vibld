import { findModel } from '@vibld/ai/model-catalogue';

import entitlement from '../../web/worker/entitlement.ts?raw';
import modelAccess from '../../web/worker/model-access.ts?raw';
import signupCredit from '../../web/worker/signup-credit.ts?raw';
import stripeClient from '../../web/worker/stripe-client.ts?raw';

import { countWord, readPlans } from './plans.ts';

/**
 * The plans, read at build time from the builder's own source. See
 * `plans.ts` for why this is text rather than an import, and turbo.json for
 * why a change to any of these files rebuilds this site.
 */
export const PLANS = readPlans({
  entitlement,
  signupCredit,
  stripeClient,
  modelAccess,
});

/**
 * The Free plan in words, for the pages that state it: "GPT-6 Luna" and
 * "three", from the builder's source rather than typed (D98b).
 */
export const FREE_PLAN = {
  models: PLANS.free.modelIds
    .map((id) => findModel(id)?.label ?? id)
    .join(' and '),
  activeProjects: countWord(PLANS.free.activeProjects),
};
