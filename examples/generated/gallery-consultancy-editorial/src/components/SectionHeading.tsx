import { motion } from 'motion/react';
import { fadeUp } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  kicker?: string;
  title: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

export default function SectionHeading({ kicker, title, align = 'left', className }: SectionHeadingProps) {
  const alignmentClasses = {
    left: 'items-start text-left',
    center: 'items-center text-center',
    right: 'items-end text-right',
  }[align];

  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      className={cn('flex flex-col gap-2', alignmentClasses, className)}
    >
      {kicker && (
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">{kicker}</p>
      )}
      <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-primary sm:text-4xl md:text-5xl">
        {title}
      </h2>
    </motion.div>
  );
}
