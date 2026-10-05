import { motion } from 'motion/react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { fadeScale } from '@/lib/motion';

interface TicketTier {
  name: string;
  price: string;
  description: string;
  features: string[];
}

const tiers: TicketTier[] = [
  {
    name: 'Single day',
    price: '$45',
    description: 'One day of demos, talks and meals.',
    features: [
      "Full access to that day's schedule",
      'Tasting portions at demos',
      'No reserved seating',
    ],
  },
  {
    name: 'Weekend pass',
    price: '$110',
    description: 'All three days, best value.',
    features: [
      'Full weekend access',
      'Entry to all demos and talks',
      'Tasting portions and one full dinner',
    ],
  },
  {
    name: 'VIP',
    price: '$220',
    description: 'Weekend pass plus reserved front-row seats and a Friday dinner.',
    features: [
      'Reserved seating at demos',
      'Friday night long-table dinner',
      'VIP lounge with shade and water',
      'Complimentary festival tote',
    ],
  },
];

export default function Tickets() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <PageHeader
        kicker="Tickets"
        title="Buy a pass, plan your meals"
        lead="Tickets are per day or for the whole weekend. Kids 12 and under enter free."
      />
      <div className="grid gap-8 md:grid-cols-3">
        {tiers.map((tier) => (
          <motion.article
            key={tier.name}
            variants={fadeScale}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="flex flex-col rounded-lg border bg-background p-6 shadow-sm"
          >
            <h2 className="font-display text-2xl tracking-tight">{tier.name}</h2>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{tier.price}</p>
            <p className="mt-3 text-muted-foreground">{tier.description}</p>
            <ul className="mt-6 flex-1 space-y-3">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button disabled className="w-full">Select</Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Online sales open June 15. This is a demonstration site; no tickets are sold here.
              </p>
            </div>
          </motion.article>
        ))}
      </div>
      <p className="mt-12 text-center text-sm text-muted-foreground">
        Online sales open June 15. This is a demonstration site; no tickets are sold here.
      </p>
    </div>
  );
}
