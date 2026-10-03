import type { Variants } from 'motion/react';

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
};

export const viewport = { once: true, amount: 0.3 } as const;
