import { motion } from 'motion/react';
import type { Variants } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { staggerContainer, fadeIn, EASE_OUT } from '@/lib/motion';

const heroItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
};

export function HeroSection() {
  return (
    <section className="mx-auto w-full container-page px-6 pt-20 pb-24 md:px-8 lg:px-12 lg:pt-28 lg:pb-32">
      <div className="lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="max-w-2xl"
        >
          <motion.p
            variants={heroItem}
            className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary"
          >
            October 18–19, 2025 · Riverside Park
          </motion.p>
          <motion.h1
            variants={heroItem}
            className="font-display text-hero font-semibold leading-[0.95] tracking-[-0.04em] text-foreground"
          >
            A weekend for slow food and long tables.
          </motion.h1>
          <motion.p
            variants={heroItem}
            className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl"
          >
            Forty cooks, two days, one riverside lawn. The Ember Table Festival gathers the region's
            best kitchens for a weekend of fire, fermentation and shared plates.
          </motion.p>
          <motion.div variants={heroItem} className="mt-10 flex flex-wrap gap-4">
            <Button asChild variant="outline" size="lg">
              <a href="#lineup">View lineup</a>
            </Button>
            <Button asChild size="lg">
              <a href="#tickets">Get tickets</a>
            </Button>
          </motion.div>
        </motion.div>

        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.2, duration: 0.4, ease: EASE_OUT }}
          className="hidden lg:block"
        >
          <div className="relative flex h-80 w-80 items-center justify-center rounded-full border border-border bg-secondary/60">
            <div className="text-center font-display text-3xl font-semibold leading-tight text-foreground">
              Slow food,
              <br />
              long tables
            </div>
            <div className="absolute -bottom-4 -left-4 h-20 w-20 rounded-full bg-primary/15" />
            <div className="absolute -top-2 -right-6 h-12 w-12 rounded-full border border-primary/30" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default HeroSection;
