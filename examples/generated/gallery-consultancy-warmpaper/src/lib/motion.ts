import type { Variants } from 'motion/react';

export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.5, ease: EASE_OUT } },
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

export const cardHover = {
  whileHover: { y: -4, transition: { duration: 0.3, ease: EASE_OUT } },
  whileTap: { scale: 0.97, transition: { duration: 0.2 } },
};

export const buttonTap = {
  whileTap: { scale: 0.97, transition: { duration: 0.2 } },
};
