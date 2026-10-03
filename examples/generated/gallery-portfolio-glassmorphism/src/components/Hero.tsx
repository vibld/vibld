import { motion, useMotionValue, useSpring, useReducedMotion } from 'motion/react';
import type { PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { staggerContainer, riseIn } from '@/lib/motion';

export default function Hero() {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const isFinePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
  const showSpotlight = isFinePointer && !prefersReducedMotion;

  const spotlightX = useMotionValue(0);
  const spotlightY = useMotionValue(0);
  const springX = useSpring(spotlightX, { stiffness: 80, damping: 20 });
  const springY = useSpring(spotlightY, { stiffness: 80, damping: 20 });

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!showSpotlight) return;
    const rect = event.currentTarget.getBoundingClientRect();
    spotlightX.set(event.clientX - rect.left);
    spotlightY.set(event.clientY - rect.top);
  };

  return (
    <section id="hero" onPointerMove={handlePointerMove} className="relative flex min-h-svh items-end overflow-hidden">
      <div
        className="absolute inset-0 -z-20"
        style={{
          backgroundImage: 'radial-gradient(circle at 25% 20%, var(--color-primary), var(--color-accent) 60%, var(--color-background))',
        }}
      />
      <div className="absolute inset-0 -z-10 scrim" />

      {showSpotlight && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -left-[300px] -top-[300px] h-[600px] w-[600px] rounded-full"
          style={{
            x: springX,
            y: springY,
            background: 'radial-gradient(circle, color-mix(in oklab, var(--color-primary) 25%, transparent) 0%, transparent 70%)',
          }}
        />
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto w-full max-w-[1200px] px-[clamp(20px,4vw,48px)] pb-[clamp(48px,8vh,96px)] text-left"
      >
        <motion.p variants={riseIn} className="text-eyebrow uppercase tracking-[0.14em] text-primary">
          Freelance photographer, Lisbon
        </motion.p>
        <motion.h1 variants={riseIn} className="mt-4 font-display text-hero font-semibold text-foreground tracking-tight">
          Photographs that hold the quiet in a loud room.
        </motion.h1>
        <motion.p variants={riseIn} className="mt-6 max-w-xl text-body text-muted-foreground">
          I make portraits, editorial images and live performance photos for musicians, makers and small brands.
        </motion.p>
        <motion.div variants={riseIn} className="mt-8 flex flex-col gap-4 sm:flex-row">
          <a href="#gallery" className={cn(buttonVariants({ variant: 'default', size: 'lg' }))}>
            See recent work
          </a>
          <a href="#contact" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
            Get in touch
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}
