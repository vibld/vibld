import { useMemo, type MouseEvent } from 'react';
import { motion, useMotionValue, useSpring, useMotionTemplate, useReducedMotion } from 'motion/react';
import { ArrowRight, Briefcase, Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fadeUp, staggerContainer, glassIn } from '@/lib/motion';

const stats = [
  {
    label: 'Client focus',
    value: 'Owner-run and midsize firms',
    Icon: Briefcase,
  },
  {
    label: 'Engagement length',
    value: 'From six weeks',
    Icon: Clock,
  },
  {
    label: 'Reach',
    value: 'North America',
    Icon: MapPin,
  },
];

export function Hero() {
  const isFinePointer = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
    [],
  );
  const prefersReducedMotion = useReducedMotion();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 120, damping: 28 });
  const springY = useSpring(mouseY, { stiffness: 120, damping: 28 });

  const spotlight = useMotionTemplate`radial-gradient(600px circle at ${springX}px ${springY}px, color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%)`;

  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    mouseX.set(event.clientX - rect.left);
    mouseY.set(event.clientY - rect.top);
  };

  return (
    <section
      className="relative overflow-hidden bg-background px-5 py-20 sm:px-8 lg:py-28"
      onMouseMove={isFinePointer ? handleMouseMove : undefined}
    >
      {isFinePointer && !prefersReducedMotion ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: spotlight }}
        />
      ) : null}
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-8"
        >
          <motion.p
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-sm font-medium text-primary"
          >
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            Crestline Partners
          </motion.p>
          <motion.h1
            variants={fadeUp}
            className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl xl:text-8xl"
          >
            Strategy that moves with your market
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="max-w-2xl text-lg leading-relaxed text-muted-foreground"
          >
            We work with owner-run and midsize firms to make clearer decisions and better use of capital. No retainers, no long slide decks, just a plan your team can run with.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-col gap-4 pt-2 sm:flex-row">
            <Button asChild size="lg">
              <a href="#services">
                Explore services
                <ArrowRight className="size-4" aria-hidden />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#contact">Start a conversation</a>
            </Button>
          </motion.div>
        </motion.div>

        <motion.aside
          variants={glassIn}
          initial="hidden"
          animate="show"
          className="rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl shadow-black/20 backdrop-blur-xl"
        >
          <div className="space-y-6">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-start gap-4">
                <div className="rounded-full border border-white/10 bg-white/10 p-3 text-primary">
                  <stat.Icon className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.15em] text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground">{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.aside>
      </div>
    </section>
  );
}
