import { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { easePaper } from '@/lib/motion';

type CountUpProps = {
  to: number;
  className?: string;
};

export function CountUp({ to, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const display = useTransform(value, (latest) => Math.round(latest).toString());

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      value.set(to);
      return;
    }
    const controls = animate(value, to, { duration: 1.2, ease: easePaper });
    return () => controls.stop();
  }, [inView, reduce, to, value]);

  return (
    <span className={className}>
      <span className="sr-only">{to}</span>
      <motion.span ref={ref} aria-hidden="true">
        {display}
      </motion.span>
    </span>
  );
}
