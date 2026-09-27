import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { TargetAndTransition, Transition } from 'motion/react';
import { easeOut } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface PlateProps {
  number: string;
  caption: string;
  frameClassName: string;
  children: ReactNode;
  className?: string;
  immediate?: boolean;
}

// A full bleed feature image that wipes in from the left with clip-path.
// With reduced motion it fades instead.
export function Plate({ number, caption, frameClassName, children, className, immediate = false }: PlateProps) {
  const reduce = useReducedMotion();
  const hidden: TargetAndTransition = reduce ? { opacity: 0 } : { clipPath: 'inset(0% 100% 0% 0%)' };
  const shown: TargetAndTransition = reduce ? { opacity: 1 } : { clipPath: 'inset(0% 0% 0% 0%)' };
  const transition: Transition = { duration: 0.6, ease: easeOut, delay: immediate ? 0.1 : 0 };
  const frame = cn('relative w-full overflow-hidden rounded-plate bg-muted', frameClassName);

  return (
    <figure className={cn('w-full', className)}>
      {immediate ? (
        <motion.div className={frame} initial={hidden} animate={shown} transition={transition}>
          <div className="absolute inset-0">{children}</div>
        </motion.div>
      ) : (
        <motion.div
          className={frame}
          initial={hidden}
          whileInView={shown}
          viewport={{ once: true, amount: 0.3 }}
          transition={transition}
        >
          <div className="absolute inset-0">{children}</div>
        </motion.div>
      )}
      <figcaption className="page-x mx-auto mt-3 flex max-w-page flex-wrap gap-x-4 gap-y-1 font-mono text-caption text-muted-foreground">
        <span className="text-foreground">Plate {number}</span>
        <span>{caption}</span>
      </figcaption>
    </figure>
  );
}
