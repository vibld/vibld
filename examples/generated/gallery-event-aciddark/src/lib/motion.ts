import type { Variants } from 'motion/react';

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.15, ease: EASE_OUT } },
};

export const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.15, ease: EASE_OUT } },
};

export const buttonTap = {
  scale: 0.98,
  transition: { duration: 0.12, ease: EASE_OUT },
} as const;

export const accentPulse = {
  opacity: [1, 0.8, 1],
  transition: { duration: 0.18, ease: EASE_OUT },
} as const;
