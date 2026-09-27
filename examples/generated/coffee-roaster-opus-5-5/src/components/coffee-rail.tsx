import { useRef } from 'react';
import { motion, stagger, useReducedMotion } from 'motion/react';
import type { Variants } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { coffees } from '@/lib/coffees';
import { cn } from '@/lib/utils';
import { reveal, spring, viewportOnce } from '@/lib/motion';

const rail: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.07) } },
};

const card: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: reveal },
};

const levels = [1, 2, 3, 4, 5];

export function CoffeeRail() {
  const railRef = useRef<HTMLUListElement>(null);
  const reduce = useReducedMotion();

  function scrollRail(direction: 1 | -1) {
    const list = railRef.current;
    if (!list) return;
    const first = list.querySelector('li');
    const step = first ? first.getBoundingClientRect().width + 20 : list.clientWidth * 0.8;
    list.scrollBy({ left: direction * step, behavior: reduce ? 'auto' : 'smooth' });
  }

  return (
    <section id="coffees" aria-labelledby="coffees-heading" className="pb-24 md:pb-36">
      <div className="mx-auto flex max-w-page flex-col gap-8 px-5 md:flex-row md:items-end md:justify-between md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={reveal}
          className="max-w-2xl"
        >
          <p className="text-label font-semibold uppercase text-primary">On the roaster</p>
          <h2 id="coffees-heading" className="mt-4 text-headline font-semibold">
            This month's coffees
          </h2>
          <p className="mt-5 max-w-measure text-body text-muted-foreground">
            Four coffees through the end of the month. Subscribers can switch between them for any delivery.
          </p>
        </motion.div>
        <div className="hidden gap-3 sm:flex">
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring}>
            <Button variant="outline" size="icon" aria-label="Scroll to previous coffees" onClick={() => scrollRail(-1)}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Button>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring}>
            <Button variant="outline" size="icon" aria-label="Scroll to next coffees" onClick={() => scrollRail(1)}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          </motion.div>
        </div>
      </div>

      <motion.ul
        ref={railRef}
        tabIndex={0}
        aria-label="This month's coffees"
        variants={rail}
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        className="rail-inset mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto pt-1 pb-6 [scrollbar-width:thin]"
      >
        {coffees.map((coffee) => (
          <motion.li key={coffee.id} variants={card} className="w-[82%] shrink-0 snap-start sm:w-[22rem]">
            <article className="flex h-full flex-col rounded-lg border border-border bg-card p-6 shadow-soft md:p-8">
              <p className="text-label font-semibold uppercase text-muted-foreground">{coffee.origin}</p>
              <h3 className="mt-3 text-title font-semibold">{coffee.name}</h3>
              <p className="mt-4 font-display text-lead font-medium text-foreground">{coffee.notes}</p>
              <div className="mt-6 mb-8 flex items-center gap-3">
                <span className="flex gap-1" aria-hidden="true">
                  {levels.map((level) => (
                    <span
                      key={level}
                      className={cn(
                        'size-2.5 rounded-full border border-foreground/40',
                        level <= coffee.level && 'border-foreground bg-foreground',
                      )}
                    />
                  ))}
                </span>
                <span className="text-base font-semibold">{coffee.roast} roast</span>
              </div>
              <dl className="mt-auto grid gap-3 border-t border-border pt-6 text-base">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Process</dt>
                  <dd className="text-right font-semibold">{coffee.process}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Variety</dt>
                  <dd className="text-right font-semibold">{coffee.variety}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Brew with</dt>
                  <dd className="text-right font-semibold">{coffee.brew}</dd>
                </div>
              </dl>
            </article>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
