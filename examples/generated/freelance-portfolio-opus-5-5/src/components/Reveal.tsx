import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { easeOut } from '@/lib/motion';

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

// Headings and quotes enter once with opacity and a 0.98 scale. Body copy
// never goes through this component.
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  return (
    <motion.div
      className={className}
      style={{ transformOrigin: 'left top' }}
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}
