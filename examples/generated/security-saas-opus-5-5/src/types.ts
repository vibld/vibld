export type Billing = 'monthly' | 'annual';

export type PlanSelection = {
  plan: string;
  billing: Billing;
};
