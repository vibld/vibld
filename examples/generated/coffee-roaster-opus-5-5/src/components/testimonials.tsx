import { motion, stagger } from 'motion/react';
import type { Variants } from 'motion/react';
import { Info, Quote } from 'lucide-react';
import { reveal, viewportOnce } from '@/lib/motion';

const list: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.08) } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: reveal },
};

// Placeholder quotes. Replace with real subscriber quotes (with permission) and remove the notice.
const quotes = [
  {
    text: "The first Ethiopia was too bright for me. I replied to the shipping email, they sent the Brazil instead, and I haven't had a natural since.",
    who: 'Placeholder subscriber · Moka pot, every four weeks',
  },
  {
    text: 'Ground for my French press and it tastes cleaner. Much less sludge at the bottom of the cup.',
    who: 'Placeholder subscriber · French press, every two weeks',
  },
];

export function Testimonials() {
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="bg-foreground text-background">
      <div className="mx-auto max-w-page px-5 py-24 md:px-10 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={reveal}
          className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="max-w-2xl">
            <p className="text-label font-semibold uppercase text-background/70">From subscribers</p>
            <h2 id="reviews-heading" className="mt-4 text-headline font-semibold">
              What people say a few months in.
            </h2>
          </div>
          <p className="flex max-w-md items-start gap-3 rounded-md border border-background/25 px-4 py-3 text-base text-background/80">
            <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            Placeholder quotes: these stand in for real subscriber reviews and will be replaced before launch.
          </p>
        </motion.div>

        <motion.div
          variants={list}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="mt-14 grid gap-5 lg:grid-cols-12"
        >
          <motion.figure
            variants={item}
            className="flex flex-col justify-between rounded-lg border border-background/15 bg-background/5 p-8 md:p-12 lg:col-span-7 lg:row-span-2"
          >
            <Quote className="size-8 text-primary" aria-hidden="true" />
            <blockquote className="mt-8 font-display text-quote font-medium">
              I used to buy whichever bag had the nicest label. Now the roast date is the first thing I check, and the Sunday email is the only one from a shop I actually open.
            </blockquote>
            <figcaption className="mt-10 text-base text-background/75">
              Placeholder subscriber · Pour-over, every two weeks
            </figcaption>
          </motion.figure>

          {quotes.map((quote) => (
            <motion.figure
              key={quote.who}
              variants={item}
              className="flex flex-col justify-between rounded-lg border border-background/15 bg-background/5 p-8 lg:col-span-5"
            >
              <blockquote className="text-lead">{quote.text}</blockquote>
              <figcaption className="mt-8 text-base text-background/75">{quote.who}</figcaption>
            </motion.figure>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
