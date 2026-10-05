import type { Variants } from 'motion/react';

export const fadeInScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
  },
};

export const clipWipe: Variants = {
  hidden: {
    clipPath: 'inset(0 0 100% 0)',
    transition: { duration: 0.6, ease: [0.23, 1, 0.32, 1] },
  },
  show: {
    clipPath: 'inset(0 0 0% 0)',
    transition: { duration: 0.6, ease: [0.23, 1, 0.32, 1] },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
};

export const buttonHover: Variants = {
  whileHover: { scale: 0.98 },
  whileTap: { scale: 0.96 },
};
