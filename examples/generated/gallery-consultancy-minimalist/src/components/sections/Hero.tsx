import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

export function Hero() {
  return (
    <section className="flex min-h-[70vh] items-center bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="show"
          className="max-w-3xl"
        >
          <p className="mb-6 text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Management consultancy
          </p>
          <h1 className="mb-6 text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            Clear counsel for complex decisions.
          </h1>
          <p className="mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Morrow &amp; Co. works with leadership teams to diagnose the real problem, build the case for change, and carry it through.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <a
              href="#contact"
              className="inline-flex h-12 items-center justify-center rounded-sm bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Request a conversation
            </a>
            <a
              href="#cases"
              className="inline-flex h-12 items-center justify-center rounded-sm border border-border bg-transparent px-6 text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              See case studies
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
