import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type BlobProps = {
  className?: string;
  duration?: number;
  delay?: number;
};

// A soft organic shape that breathes between scale 0.98 and 1.02.
export function Blob({ className, duration = 3.6, delay = 0 }: BlobProps) {
  return (
    <motion.div
      aria-hidden="true"
      className={cn('pointer-events-none absolute rounded-blob', className)}
      animate={{ scale: [0.98, 1.02, 0.98], rotate: [-2, 2, -2] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
