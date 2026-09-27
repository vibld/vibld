import { motion, stagger } from 'motion/react';
import type { Variants } from 'motion/react';
import { CalendarClock, MapPin, SlidersHorizontal, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CountUp } from '@/components/count-up';
import { cn } from '@/lib/utils';
import { reveal, viewportOnce } from '@/lib/motion';

const grid: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.08) } },
};

const cell: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: reveal },
};

type Answer = {
  icon: LucideIcon;
  title: string;
  body: string;
  className: string;
};

const answers: Answer[] = [
  {
    icon: SlidersHorizontal,
    title: 'Which grind do I need?',
    body: 'Tell us how you brew: espresso, moka pot, pour-over, AeroPress, French press, or whole bean if you grind at home. Each bag is ground to order on a flat burr grinder set for that method.',
    className: 'lg:col-span-2',
  },
  {
    icon: CalendarClock,
    title: 'Am I locked in?',
    body: 'Two days before each roast we email you, and one link lets you skip, swap the coffee or cancel. There is no account to log in to and no minimum number of bags.',
    className: 'lg:col-span-2',
  },
  {
    icon: Undo2,
    title: "What if I don't like it?",
    body: "Reply to the shipping email and tell us what was off. We'll put a different coffee in your next box at no charge and note it, so that style doesn't come back.",
    className: 'lg:col-span-3',
  },
  {
    icon: MapPin,
    title: 'Where does it come from?',
    body: 'The producer, region, variety and process are printed on every label. We buy green coffee by the lot through two importers who visit the farms each harvest.',
    className: 'lg:col-span-3',
  },
];

export function Benefits() {
  return (
    <section id="how" aria-labelledby="how-heading" className="mx-auto max-w-page px-5 py-24 md:px-10 md:py-36">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={reveal}
        className="max-w-3xl"
      >
        <p className="text-label font-semibold uppercase text-primary">How it works</p>
        <h2 id="how-heading" className="mt-4 text-headline font-semibold">
          Built around the questions people ask before their first bag.
        </h2>
      </motion.div>

      <motion.ul
        variants={grid}
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-6"
      >
        <motion.li
          variants={cell}
          className="flex flex-col justify-between gap-10 rounded-lg border border-border bg-card p-6 shadow-soft md:col-span-2 md:p-10 lg:col-span-4 lg:row-span-2"
        >
          <div className="flex items-end gap-3 text-primary">
            <CountUp to={48} className="font-display text-numeral font-bold" />
            <span className="pb-3 font-display text-title font-semibold md:pb-5">hours</span>
          </div>
          <div className="max-w-xl">
            <h3 className="text-title font-semibold">Will it be fresh when it arrives?</h3>
            <p className="mt-3 text-body text-muted-foreground">
              Your bag ships within 48 hours of roasting, and the roast date is printed on the label where you would usually find a best-before.
            </p>
          </div>
        </motion.li>

        {answers.map((answer) => {
          const Icon = answer.icon;
          return (
            <motion.li
              key={answer.title}
              variants={cell}
              className={cn('rounded-lg border border-border bg-card p-6 shadow-soft md:p-8', answer.className)}
            >
              <span className="flex size-11 items-center justify-center rounded-pill bg-muted">
                <Icon className="size-5 text-foreground" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-title font-semibold">{answer.title}</h3>
              <p className="mt-3 text-body text-muted-foreground">{answer.body}</p>
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}
