import type { Variants } from 'motion/react';

export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const materializeGlass: Variants = {
  hidden: { opacity: 0, scale: 0.98, backdropFilter: 'blur(0px)' },
  show: { opacity: 1, scale: 1, backdropFilter: 'blur(18px)', transition: { duration: 0.25, ease: EASE_OUT } },
};

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 120, damping: 20 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 120, damping: 20 } },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};
