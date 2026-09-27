import { useRef } from 'react';
import { motion, stagger, useReducedMotion, useScroll, useTransform } from 'motion/react';
import type { Variants } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RoastCard } from '@/components/roast-card';
import { spring } from '@/lib/motion';

const sequence: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.06) } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: spring },
};

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] });
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 90]);

  return (
    <section id="top" ref={sectionRef} aria-labelledby="hero-heading" className="relative isolate overflow-clip">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <motion.div
          className="glow-terracotta absolute -top-48 right-[-12rem] size-[44rem] rounded-full"
          animate={{ x: [0, -70, 30, 0], y: [0, 50, -20, 0], opacity: [0.85, 1, 0.75, 0.85] }}
          transition={{ duration: 32, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="glow-teal absolute bottom-[-14rem] left-[-10rem] size-[36rem] rounded-full"
          animate={{ x: [0, 50, -30, 0], y: [0, -40, 10, 0], opacity: [0.7, 1, 0.8, 0.7] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <motion.div
        variants={sequence}
        initial="hidden"
        animate="show"
        className="mx-auto grid max-w-page grid-cols-1 gap-y-10 px-5 pt-14 pb-24 md:px-10 md:pt-20 md:pb-32 lg:grid-cols-12 lg:gap-x-10"
      >
        <motion.p variants={rise} className="text-label font-semibold uppercase text-primary lg:col-span-12">
          Small-batch roaster in Asheville, North Carolina
        </motion.p>

        <h1 id="hero-heading" className="text-display font-semibold lg:col-span-12">
          <motion.span variants={rise} className="block">
            Roasted Tuesday.
          </motion.span>
          <motion.span variants={rise} className="block">
            Here by Saturday.
          </motion.span>
        </h1>

        <div className="flex flex-col gap-8 lg:col-span-5 lg:pt-6">
          <motion.p variants={rise} className="max-w-measure text-lead text-muted-foreground">
            Every subscription bag comes off our 12 kg roaster on Tuesday and ships by Wednesday afternoon. Choose a coffee and a grind, then skip, swap or cancel from the email we send before each roast.
          </motion.p>

          <motion.div variants={rise} className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring}>
              <Button asChild size="lg" className="group">
                <a href="#subscribe">
                  Start a subscription
                  <ArrowRight
                    className="size-5 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </a>
              </Button>
            </motion.div>
            <a
              href="#coffees"
              className="inline-flex min-h-11 cursor-pointer items-center px-1 font-semibold text-foreground underline decoration-border decoration-2 underline-offset-[6px] transition-colors duration-150 hover:decoration-primary"
            >
              See this month's coffees
            </a>
          </motion.div>

          <motion.p variants={rise} className="text-base text-muted-foreground">
            $19 a bag, 340 g, US shipping included.
          </motion.p>
        </div>

        <motion.div variants={rise} className="lg:col-span-6 lg:col-start-7 lg:-mt-6 xl:-mr-20">
          <motion.div style={{ y: reduce ? 0 : cardY }}>
            <RoastCard />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
