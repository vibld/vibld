import { Link } from 'react-router';
import { Page, Section } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/pricing');
}

const PLANS = [
  {
    name: 'Per order',
    price: '8%',
    unit: 'of parts value',
    summary: 'For occasional sourcing with no commitment.',
    includes: [
      'Sourcing and supplier verification',
      'One consolidated shipment',
      'Quotes are free, whether or not you order',
    ],
  },
  {
    name: 'Retainer',
    price: '£1,200',
    unit: 'per month',
    summary: 'For maintenance teams sourcing most weeks.',
    includes: [
      'Everything in Per order, at 4% of parts value',
      'A named sourcing specialist',
      'Priority handling on line-down requests',
    ],
    featured: true,
  },
  {
    name: 'Standing coverage',
    price: 'From £4,000',
    unit: 'per month',
    summary: 'For lines where downtime is the real cost.',
    includes: [
      'Everything in Retainer',
      'Agreed spares held and replenished',
      'Quarterly review of coverage against failures',
    ],
  },
];

export default function Pricing() {
  const route = routeFor('/pricing');
  return (
    <Page title="Pricing" lead={route.description}>
      <Section heading="Plans">
        <ul className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li
              key={plan.name}
              className={`rounded-xl border p-6 ${
                plan.featured
                  ? 'border-[var(--color-accent)] shadow-sm'
                  : 'border-black/10 dark:border-white/15'
              }`}
            >
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-3">
                <span className="text-3xl font-semibold tracking-tight">
                  {plan.price}
                </span>{' '}
                <span className="text-[var(--color-ink-muted)]">
                  {plan.unit}
                </span>
              </p>
              <p className="mt-3 text-[var(--color-ink-muted)]">
                {plan.summary}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.includes.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section heading="What is not charged for">
        <p className="max-w-2xl text-[var(--color-ink-muted)]">
          Quotes, sourcing research and a request we cannot fulfil are all free.
          We would rather tell you a part is unobtainable than bill you for
          finding out.
        </p>
        <p className="mt-6">
          <Link
            to="/contact"
            className="font-medium text-[var(--color-accent)] underline underline-offset-4"
          >
            Ask about a specific part
          </Link>
        </p>
      </Section>
    </Page>
  );
}
