import { stagger, type Variants } from 'motion/react';

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const SPRING = { type: 'spring', stiffness: 400, damping: 30 } as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06 },
  },
};

export const glassIn: Variants = {
  hidden: { opacity: 0, scale: 0.95, backdropFilter: 'blur(0px)' },
  show: {
    opacity: 1,
    scale: 1,
    backdropFilter: 'blur(20px)',
    transition: { duration: 0.25, ease: [0.23, 1, 0.32, 1] },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] },
  },
};
