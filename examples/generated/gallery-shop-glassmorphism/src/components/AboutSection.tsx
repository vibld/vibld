import { motion, useReducedMotion } from 'motion/react';
import {
  glassEnter,
  glassEnterReduced,
} from '@/lib/motion';

export default function AboutSection() {
  const reduceMotion = useReducedMotion();
  const panel = reduceMotion ? glassEnterReduced : glassEnter;

  return (
    <section id="about" className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <motion.div
        variants={panel}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--glass)] p-8 shadow-[0_8px_32px_var(--shadow)] backdrop-blur-[18px] sm:p-10"
      >
        <h2 className="font-display text-[clamp(2.5rem,6vw,3.5rem)] leading-[1.1] tracking-[-0.02em] text-foreground">
          From our studio
        </h2>
        <p className="mt-5 text-base leading-relaxed text-foreground/90">
          We hand-pour every candle in small batches using 100% soy wax and
          cotton wicks. Each scent is blended from natural essential oils and
          phthalate-free fragrance oils. Our candles burn clean for 40 to 50
          hours, filling your space with a subtle, true-to-life aroma.
        </p>
      </motion.div>
    </section>
  );
}
