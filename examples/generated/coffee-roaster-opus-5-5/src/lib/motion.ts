import type { Transition } from 'motion/react';

export const easePaper: [number, number, number, number] = [0.23, 1, 0.32, 1];

// Critically damped enough that nothing overshoots: paper, not rubber.
export const spring: Transition = { type: 'spring', stiffness: 300, damping: 35 };

export const reveal: Transition = { duration: 0.35, ease: easePaper };

export const viewportOnce = { once: true, amount: 0.3 };
