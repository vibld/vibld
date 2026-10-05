import type { Variants } from 'motion/react';

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const glassMaterialize: Variants = {
  hidden: { opacity: 0, scale: 0.98, backdropFilter: 'blur(0px)' },
  show: {
    opacity: 1,
    scale: 1,
    backdropFilter: 'blur(20px)',
    transition: { duration: 0.25, ease: EASE_OUT },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0,
    },
  },
};
