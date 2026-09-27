import { motion } from 'motion/react';

const phrases = [
  'Washed Colombia',
  'Natural Ethiopia',
  'Honey Costa Rica',
  'Pulped natural Brazil',
  'Roasted every Tuesday',
  'Ground to order',
  'Shipped within 48 hours',
];

export function Marquee() {
  return (
    <section aria-label="What we roast" className="border-y border-border bg-card py-5">
      <div className="fade-x overflow-hidden">
        <motion.div
          className="flex w-max"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 36, repeat: Infinity, ease: 'linear' }}
        >
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 ? true : undefined} className="flex shrink-0 items-center">
              {phrases.map((phrase) => (
                <li
                  key={phrase}
                  className="flex items-center gap-8 pr-8 font-display text-2xl font-medium tracking-[-0.01em] whitespace-nowrap"
                >
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                  {phrase}
                </li>
              ))}
            </ul>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
