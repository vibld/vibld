import { useState } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/Reveal';
import { cn } from '@/lib/utils';
import { easeOut } from '@/lib/motion';
import type { Billing, PlanSelection } from '@/types';

type Plan = {
  id: string;
  name: string;
  blurb: string;
  monthly: number;
  annualTotal: number;
  features: string[];
  cta: string;
  recommended?: boolean;
};

const plans: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    blurb: 'For one product with a small public footprint.',
    monthly: 49,
    annualTotal: 490,
    features: ['Up to 25 hosts', '1 root domain', 'Daily rescans', 'Email alerts', '30 days of finding history', '2 seats'],
    cta: 'Choose Starter',
  },
  {
    id: 'team',
    name: 'Team',
    blurb: 'For companies running several products without a full-time security hire.',
    monthly: 149,
    annualTotal: 1490,
    features: [
      'Up to 250 hosts',
      '5 root domains',
      'Rescans every 6 hours',
      'Slack, Teams, email and webhook alerts',
      '90 days of finding history',
      '10 seats',
    ],
    cta: 'Start a 14-day trial',
    recommended: true,
  },
  {
    id: 'business',
    name: 'Business',
    blurb: 'For security teams that need scale, SSO and an API.',
    monthly: 399,
    annualTotal: 3990,
    features: [
      'Up to 2,000 hosts',
      'Unlimited root domains',
      'Hourly rescans',
      'Every alert channel, plus PagerDuty',
      '1 year of finding history',
      'SAML SSO and REST API',
      'Unlimited seats',
    ],
    cta: 'Choose Business',
  },
];

const periods: { value: Billing; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

function money(amount: number) {
  return `$${amount.toLocaleString('en-US')}`;
}

type PricingProps = {
  onChoose: (selection: PlanSelection) => void;
};

export function Pricing({ onChoose }: PricingProps) {
  const [billing, setBilling] = useState<Billing>('annual');

  return (
    <section id="pricing" className="border-t border-border py-24 lg:py-32">
      <Tabs
        value={billing}
        onValueChange={(value) => setBilling(value as Billing)}
        className="mx-auto max-w-6xl gap-0 px-6"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <Reveal className="max-w-2xl">
            <p className="font-display text-label font-semibold uppercase text-muted-foreground">Pricing</p>
            <h2 className="mt-4 font-display text-title font-bold text-foreground">
              Priced by the number of hosts we watch.
            </h2>
            <p className="mt-5 text-lead text-muted-foreground">
              Every plan runs every check. Plans differ in how many hosts we watch, how often we rescan them
              and where alerts can go.
            </p>
          </Reveal>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <TabsList aria-label="Billing period">
              {periods.map((period) => (
                <TabsTrigger key={period.value} value={period.value}>
                  {billing === period.value && (
                    <motion.span
                      layoutId="billing-indicator"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-pill bg-foreground"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative">{period.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <p className="text-small text-muted-foreground">Annual billing: pay for 10 months, get 12.</p>
          </div>
        </div>

        {periods.map((period) => (
          <TabsContent key={period.value} value={period.value} className="mt-12">
            <div className="grid gap-4 lg:grid-cols-3">
              {plans.map((plan, index) => {
                const isAnnual = period.value === 'annual';
                const price = isAnnual ? Math.round(plan.annualTotal / 12) : plan.monthly;
                const note = isAnnual ? `${money(plan.annualTotal)} billed yearly` : 'Billed monthly';
                return (
                  <motion.article
                    key={plan.id}
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.16, ease: easeOut, delay: index * 0.04 }}
                    className={cn(
                      'flex flex-col rounded-lg border bg-card p-6 text-card-foreground sm:p-8',
                      plan.recommended ? 'border-foreground' : 'border-border',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-display text-heading font-semibold">{plan.name}</h3>
                      {plan.recommended && (
                        <span className="rounded-pill bg-foreground px-3 py-1 font-display text-label font-semibold uppercase text-background">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-muted-foreground">{plan.blurb}</p>
                    <p className="mt-8 flex items-baseline gap-1">
                      <span className="font-display text-price font-bold tabular-nums">{money(price)}</span>
                      <span className="text-muted-foreground">/month</span>
                    </p>
                    <p className="mt-2 text-small text-muted-foreground">{note}</p>
                    <ul className="mt-8 flex-1 space-y-3">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-3">
                          <Check className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden="true" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="lg"
                      variant={plan.recommended ? 'default' : 'secondary'}
                      className="mt-10 w-full"
                      onClick={() => onChoose({ plan: plan.name, billing: period.value })}
                    >
                      {plan.cta}
                    </Button>
                  </motion.article>
                );
              })}
            </div>
          </TabsContent>
        ))}

        <div className="mt-12 grid gap-8 border-t border-border pt-10 md:grid-cols-2">
          <div>
            <h3 className="font-display text-heading font-semibold text-foreground">What happens at the host limit</h3>
            <p className="mt-3 text-muted-foreground">
              Scanning keeps running for 14 days after you pass it. We email the account owner on day 1 and day
              10, so there is time to upgrade or take hosts out of scope.
            </p>
          </div>
          <div>
            <h3 className="font-display text-heading font-semibold text-foreground">Cancelling</h3>
            <p className="mt-3 text-muted-foreground">
              Cancel from Settings at any time. Monthly plans end with the current month, and annual plans are
              refunded for each unused full month.
            </p>
          </div>
        </div>
        <p className="mt-8 text-small text-muted-foreground">Prices in USD, excluding sales tax and VAT.</p>
      </Tabs>
    </section>
  );
}
