import type { Variants } from 'motion/react';

export const pulse: Variants = {
  hidden: { scale: 1, opacity: 1 },
  show: {
    scale: [1, 1.06, 1],
    opacity: [1, 0.7, 1],
    transition: { duration: 0.14, ease: 'easeOut' },
  },
};
