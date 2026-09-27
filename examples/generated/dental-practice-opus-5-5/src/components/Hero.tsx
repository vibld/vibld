import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  motion,
  stagger,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import type { Variants } from 'motion/react';
import { ArrowDown, CalendarPlus, Check, CircleCheck, CircleMinus, Phone, Siren, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Blob } from '@/components/Blob';
import { Lift } from '@/components/Lift';
import { useNow } from '@/hooks/useNow';
import { getOpenStatus, PRACTICE } from '@/lib/hours';
import { EASE_OUT } from '@/lib/motion';

const heroContainer: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.06) } },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', duration: 0.5, bounce: 0 } },
};

const heroMedia: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: EASE_OUT } },
};

type HeroProps = {
  onBook: () => void;
};

export function Hero({ onBook }: HeroProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [finePointer, setFinePointer] = useState(false);
  const now = useNow();
  const status = getOpenStatus(now);
  const StatusIcon = status.isOpen ? CircleCheck : CircleMinus;

  useEffect(() => {
    const query = window.matchMedia('(pointer: fine)');
    const update = () => setFinePointer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const tracking = finePointer && !reduce;

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const glowX = useSpring(pointerX, { stiffness: 300, damping: 35 });
  const glowY = useSpring(pointerY, { stiffness: 300, damping: 35 });
  const glowOpacity = useSpring(0, { stiffness: 300, damping: 35 });

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const parallax = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 90]);

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (!tracking || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    pointerX.set(event.clientX - rect.left);
    pointerY.set(event.clientY - rect.top);
  }

  return (
    <section
      ref={ref}
      id="top"
      aria-labelledby="hero-heading"
      onPointerMove={handlePointerMove}
      onPointerEnter={() => {
        if (tracking) glowOpacity.set(1);
      }}
      onPointerLeave={() => glowOpacity.set(0)}
      className="relative isolate overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="hero-mesh absolute inset-0 -z-20 animate-drift motion-reduce:animate-none"
      />
      {tracking && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 -z-10 -mt-60 -ml-60 size-120 rounded-full bg-glow blur-3xl"
          style={{ x: glowX, y: glowY, opacity: glowOpacity }}
        />
      )}

      <motion.div
        variants={heroContainer}
        initial="hidden"
        animate="show"
        className="mx-auto grid max-w-300 items-center gap-14 px-6 pt-12 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-12 lg:pt-20 lg:pb-32"
      >
        <div>
          <motion.p
            variants={heroItem}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-small font-medium text-accent-foreground"
          >
            <Sprout aria-hidden="true" className="size-4" />
            Family and general dentistry in Millbrook
          </motion.p>

          <motion.h1
            id="hero-heading"
            variants={heroItem}
            className="mt-7 font-display text-display font-medium text-foreground"
          >
            Calm dentistry, <em className="font-normal text-clay italic">at a gentler pace.</em>
          </motion.h1>

          <motion.p variants={heroItem} className="mt-7 max-w-xl text-lede text-muted-foreground">
            Fernbank Dental is a small practice with four surgeries on Fernbank Road. Standard appointments are 30
            minutes long, so there is time to ask questions, and time to stop if you need a break.
          </motion.p>

          <motion.div variants={heroItem} className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Lift className="w-full sm:w-auto">
              <Button size="lg" onClick={onBook} className="w-full">
                <CalendarPlus aria-hidden="true" className="size-5" />
                Request an appointment
              </Button>
            </Lift>
            <Lift className="w-full sm:w-auto">
              <Button asChild variant="outline" size="lg" className="group w-full">
                <a href="#hours">
                  Opening hours
                  <ArrowDown
                    aria-hidden="true"
                    className="size-5 transition-transform duration-400 ease-organic group-hover:translate-y-0.5"
                  />
                </a>
              </Button>
            </Lift>
          </motion.div>

          <motion.p variants={heroItem} className="mt-6 flex items-center gap-2 text-small text-muted-foreground">
            <Check aria-hidden="true" className="size-4 text-primary" />
            New patients welcome, adults and children.
          </motion.p>
        </div>

        <motion.div style={{ y: parallax }} className="relative">
          <motion.div
            variants={heroMedia}
            className="relative mx-auto aspect-square w-full max-w-md sm:max-w-lg"
          >
            <Blob className="grain inset-[4%] bg-sage" duration={3.8} />
            <Blob className="top-[6%] right-[-2%] size-[40%] bg-clay/60" duration={3.2} delay={0.6} />
            <Blob className="bottom-[2%] left-0 size-[34%] bg-bark/45" duration={4} delay={1.2} />
            <Blob className="inset-[18%] border border-primary/30" duration={3.5} delay={0.3} />

            <div className="absolute top-[10%] left-0 flex max-w-52 items-start gap-3 rounded-organic-alt border border-border bg-card/95 p-4 shadow-soft backdrop-blur-sm">
              <Siren aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-clay" />
              <p className="text-small font-medium text-foreground">Emergency slots every weekday morning</p>
            </div>

            <div className="absolute right-0 bottom-[8%] w-[min(17rem,78%)] rounded-organic border border-border bg-card p-5 shadow-soft sm:right-[2%]">
              <p className="text-small text-muted-foreground">Today at Fernbank</p>
              <p className="mt-1 flex items-center gap-2 font-display text-title font-medium text-foreground">
                <StatusIcon
                  aria-hidden="true"
                  className={status.isOpen ? 'size-5 text-primary' : 'size-5 text-clay'}
                />
                {status.headline}
              </p>
              <p className="text-body text-muted-foreground">{status.detail}</p>
              <a
                href={PRACTICE.phoneHref}
                className="mt-2 inline-flex min-h-11 items-center gap-2 font-medium text-primary underline-offset-4 transition-colors duration-400 ease-organic hover:text-primary-hover hover:underline"
              >
                <Phone aria-hidden="true" className="size-4" />
                Call {PRACTICE.phone}
              </a>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
