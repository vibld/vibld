import { motion, useReducedMotion } from 'motion/react';
import { easePaper, reveal, viewportOnce } from '@/lib/motion';

const facts = [
  { term: 'Roast days', detail: 'Tuesday and Friday' },
  { term: 'Batch size', detail: '12 kg' },
  { term: 'Cupped', detail: 'Every batch, next morning' },
  { term: 'Saturday counter', detail: '9am to 1pm' },
];

export function Roastery() {
  const reduce = useReducedMotion();

  return (
    <section aria-labelledby="roastery-heading" className="bg-secondary text-secondary-foreground">
      <div className="mx-auto grid max-w-page gap-14 px-5 py-24 md:px-10 md:py-32 lg:grid-cols-12 lg:gap-x-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={reveal}
          className="lg:col-span-6 lg:col-start-2"
        >
          <p className="text-label font-semibold uppercase text-muted-foreground">The roastery</p>
          <h2 id="roastery-heading" className="mt-4 text-headline font-semibold">
            Two roasters, one 12 kg machine, and a logbook entry for every batch.
          </h2>
          <div className="mt-8 max-w-measure space-y-5 text-body">
            <p>
              We roast on Tuesdays and Fridays in a converted tire shop off Haywood Road. Each coffee has a profile we adjust by hand, and every batch goes in the log: charge temperature, first crack, drop, and how it tasted on the cupping table the next morning.
            </p>
            <p>
              If a batch cups flat, it doesn't ship. It becomes cold brew for the Saturday counter, and your bag goes on the next roast. We'd rather ship your coffee two days late than send a batch we wouldn't drink ourselves.
            </p>
          </div>
        </motion.div>

        <aside aria-label="Roastery facts" className="lg:col-span-4 lg:col-start-9 lg:pt-28">
          <motion.blockquote
            initial={reduce ? { opacity: 0 } : { opacity: 0, clipPath: 'inset(0% 100% 0% 0%)' }}
            whileInView={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
            viewport={viewportOnce}
            transition={{ duration: 0.6, ease: easePaper }}
            className="border-l-2 border-primary pl-6 font-display text-quote font-medium"
          >
            We'd rather ship your coffee two days late than send a batch we wouldn't drink ourselves.
          </motion.blockquote>
          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-foreground/15 pt-8">
            {facts.map((fact) => (
              <div key={fact.term}>
                <dt className="text-sm text-muted-foreground">{fact.term}</dt>
                <dd className="mt-1 font-display text-xl font-semibold">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}
