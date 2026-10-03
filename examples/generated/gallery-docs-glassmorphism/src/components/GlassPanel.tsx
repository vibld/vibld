import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glassMaterialize } from '@/lib/motion';

type GlassPanelProps = HTMLMotionProps<'div'> & {
  className?: string;
  children?: ReactNode;
  delay?: number;
};

export default function GlassPanel({
  className,
  children,
  delay = 0,
  ...rest
}: GlassPanelProps) {
  return (
    <motion.div
      {...rest}
      className={cn('glass-panel rounded-glass', className)}
      variants={glassMaterialize}
      initial="hidden"
      animate="show"
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}
