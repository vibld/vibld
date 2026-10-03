import { motion, useReducedMotion } from 'motion/react';
import {
  fadeUp,
  fadeUpReduced,
  glassEnter,
  glassEnterReduced,
  staggerContainer,
  staggerContainerReduced,
} from '@/lib/motion';
import { Button } from '@/components/ui/button';

export default function HomeHero() {
  const reduceMotion = useReducedMotion();
  const container = reduceMotion ? staggerContainerReduced : staggerContainer;
  const item = reduceMotion ? fadeUpReduced : fadeUp;
  const panel = reduceMotion ? glassEnterReduced : glassEnter;

  const scrollToProducts = () => {
    const behavior = reduceMotion ? 'auto' : 'smooth';
    document.getElementById('all-products')?.scrollIntoView({ behavior });
  };

  return (
    <section
      id="hero"
      className="relative flex min-h-[80vh] items-center justify-center overflow-hidden px-6 py-24"
    >
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10 w-full max-w-3xl"
      >
        <motion.div
          variants={panel}
          className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--glass)] px-8 py-12 shadow-[0_8px_32px_var(--shadow)] backdrop-blur-[18px] sm:px-12"
        >
          <motion.h1
            variants={item}
            className="font-display text-[clamp(3.5rem,10vw,6rem)] leading-[0.95] tracking-[-0.04em] text-foreground"
          >
            Hand-poured candles for quiet moments
          </motion.h1>

          <motion.p
            variants={item}
            className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground"
          >
            Small-batch soy wax candles with natural scents, made in small
            batches in our studio.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex justify-center">
            <Button size="lg" onClick={scrollToProducts}>
              Shop candles
            </Button>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
