import type { Variants } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.15, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.15, ease: EASE_OUT } },
};

export const transition = {
  duration: 0.15,
  ease: EASE_OUT,
};
