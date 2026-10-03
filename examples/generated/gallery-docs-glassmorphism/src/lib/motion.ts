import type { Variants } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const glassMaterialize: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.96,
    backdropFilter: 'blur(0px)',
  },
  show: {
    opacity: 1,
    scale: 1,
    backdropFilter: 'blur(18px) saturate(140%)',
    transition: {
      duration: 0.25,
      ease: EASE_OUT,
    },
  },
};

export const rise: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: EASE_OUT,
    },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};
