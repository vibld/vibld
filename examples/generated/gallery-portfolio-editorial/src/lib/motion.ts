import type { Variants } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

export const heroStagger: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

export const heroItem: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 120, damping: 20 },
  },
};

export const clipRevealLeft: Variants = {
  hidden: { clipPath: 'inset(0 100% 0 0)', opacity: 0, scale: 1.05 },
  show: {
    clipPath: 'inset(0 0% 0 0)',
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

export const clipRevealBottom: Variants = {
  hidden: { clipPath: 'inset(100% 0 0 0)', opacity: 0, scale: 1.02 },
  show: {
    clipPath: 'inset(0% 0 0 0)',
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};
