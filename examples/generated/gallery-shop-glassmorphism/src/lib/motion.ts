import type { Variants } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const glassEnter: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    backdropFilter: 'blur(0px)',
  },
  show: {
    opacity: 1,
    scale: 1,
    backdropFilter: 'blur(18px)',
    transition: {
      duration: 0.25,
      ease: EASE_OUT,
    },
  },
};

export const glassEnterReduced: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.15, ease: EASE_OUT },
  },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 120,
      damping: 20,
    },
  },
};

export const fadeUpReduced: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.15, ease: EASE_OUT },
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

export const staggerContainerReduced: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0,
    },
  },
};
