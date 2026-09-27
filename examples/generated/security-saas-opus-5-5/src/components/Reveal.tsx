import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { easeOut } from '@/lib/motion';

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

// Rises 8px and fades in once when a third of it is on screen.
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.18, ease: easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}
