import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';

type LiftProps = {
  children: ReactNode;
  className?: string;
};

// Wraps a button or link so it lifts on hover and presses in on tap.
export function Lift({ children, className }: LiftProps) {
  return (
    <motion.span
      className={cn('inline-flex', className)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.span>
  );
}
