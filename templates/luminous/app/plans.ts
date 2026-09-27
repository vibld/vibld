/**
 * The plans, shared by the home page's summary and the pricing page, so the
 * two can never quote different prices. Every figure here is invented for
 * the template; replace them with real ones before publishing.
 */

export interface Plan {
  name: string;
  price: string;
  per: string;
  summary: string;
  includes: string[];
  tone: 'ic-teal' | 'ic-amber' | 'ic-ember';
  featured?: boolean;
}

export const PLANS: Plan[] = [
  {
    name: 'Starter',
    price: '$0',
    per: 'per month, for good',
    summary: 'For a founder who still reads every message personally.',
    includes: [
      'One inbox and up to three sources',
      'Themes and manual ranking',
      'CSV export of everything',
    ],
    tone: 'ic-teal',
  },
  {
    name: 'Team',
    price: '$49',
    per: 'per month, per workspace',
    summary: 'For a product team deciding what goes into the next cycle.',
    includes: [
      'Every source, and up to ten teammates',
      'Ranking weighted by plan or account value',
      'Replies to everyone who asked, from the theme',
      'Issue tracker and team chat connections',
    ],
    tone: 'ic-amber',
    featured: true,
  },
  {
    name: 'Scale',
    price: '$149',
    per: 'per month, per workspace',
    summary: 'For several product teams sharing one view of the customer.',
    includes: [
      'Everything in Team, with unlimited teammates',
      'Single sign-on and an audit log',
      'Webhooks and the full API',
      'A named contact for onboarding',
    ],
    tone: 'ic-ember',
  },
];

/** Terms that apply to every plan. */
export const PLAN_NOTES = [
  'Prices are per workspace, never per message. A busy week costs the same as a quiet one.',
  'Every paid plan starts with a fourteen-day trial and no card on file.',
  'Paying yearly takes two months off the price.',
  'Cancelling keeps your data readable and exportable for ninety days.',
];
