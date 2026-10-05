import type { Variants } from 'motion/react';

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: [0.23, 1, 0.32, 1] } },
};

export const clipWipe: Variants = {
  hidden: { clipPath: 'inset(0 100% 0 0)' },
  show: { clipPath: 'inset(0 0% 0 0)', transition: { duration: 0.6, ease: [0.23, 1, 0.32, 1] } },
};

export const hoverPress: Variants = {
  rest: { scale: 1 },
  hover: { scale: 1.02, transition: { duration: 0.15, ease: 'easeOut' } },
  tap: { scale: 0.97, transition: { duration: 0.15, ease: 'easeOut' } },
};
