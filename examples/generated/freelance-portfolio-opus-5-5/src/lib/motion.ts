import type { Transition, Variants } from 'motion/react';

// Ease-out used for every entrance on the page. No overshoot anywhere.
export const easeOut: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const enter: Transition = { duration: 0.5, ease: easeOut };

// The one entrance this design allows: opacity plus a 98% to 100% scale.
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: enter },
};

export const press = { scale: 0.97 };
export const lift = { scale: 1.02 };

// Critically damped, so buttons settle without bouncing past their size.
export const pressSpring: Transition = { type: 'spring', stiffness: 400, damping: 40 };
