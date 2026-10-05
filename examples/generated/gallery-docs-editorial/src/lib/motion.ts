import type { Variants } from "motion/react";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

export const clipReveal: Variants = {
  hidden: { clipPath: "inset(0 0 100% 0)" },
  show: {
    clipPath: "inset(0 0 0% 0)",
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};
