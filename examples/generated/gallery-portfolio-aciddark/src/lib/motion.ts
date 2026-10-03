import type { Variants } from 'motion/react';

export const buttonPress: Variants = {
  pressed: {
    scale: 0.97,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 30,
      duration: 0.1,
    },
  },
};

export const accentPulse: Variants = {
  initial: { opacity: 0, scale: 1 },
  animate: {
    opacity: [0, 1, 0],
    scale: [1, 1.1, 1],
    transition: { duration: 0.15, ease: 'easeOut' },
  },
};
