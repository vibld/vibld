import type { Variants } from 'motion/react';

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3, ease: EASE_OUT } },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const cardHover: Variants = {
  rest: {
    y: 0,
    boxShadow: '0 1px 2px rgba(31,30,28,.04), 0 8px 24px rgba(31,30,28,.06)',
  },
  hover: {
    y: -2,
    boxShadow: '0 2px 4px rgba(31,30,28,.05), 0 12px 32px rgba(31,30,28,.08)',
    transition: { duration: 0.2, ease: EASE_OUT },
  },
  tap: {
    scale: 0.98,
    transition: { duration: 0.1, ease: EASE_OUT },
  },
};
