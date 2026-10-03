import { motion } from 'motion/react';
import { fade, viewport } from '@/lib/motion';
import SectionHeading from '@/components/SectionHeading';

const tiers = [
  {
    name: 'Day pass',
    price: '$45',
    description: 'Entry for one day, all demos, one tasting token.',
  },
  {
    name: 'Weekend pass',
    price: '$80',
    description:
      'Entry both days, all demos, two tasting tokens, long table waitlist priority.',
  },
  {
    name: 'Long table dinner',
    price: '$120',
    description:
      'Saturday or Sunday evening seat at the shared table, five courses, paired pours.',
  },
];

export default function Tickets() {
  return (
    <motion.section
      id="tickets"
      className="py-16 md:py-24"
      variants={fade}
      initial="hidden"
      whileInView="show"
      viewport={viewport}
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-12">
        <SectionHeading
          kicker="Entry"
          heading="Tickets"
          intro="Buy online until June 6, or at the gate if any remain."
        />
        <div>
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className="border-b border-border py-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
                <h3 className="font-display text-h3 font-medium text-foreground">
                  {tier.name}
                </h3>
                <span className="font-display text-h3 text-accent">
                  {tier.price}
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-body text-muted-foreground">
                {tier.description}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-small text-muted-foreground">
          Children under 12 enter free with an adult.
        </p>
      </div>
    </motion.section>
  );
}
