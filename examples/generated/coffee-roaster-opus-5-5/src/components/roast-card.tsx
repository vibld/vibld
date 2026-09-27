import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { easePaper } from '@/lib/motion';

const notes = ['Red apple', 'Panela', 'Cocoa nib'];

const readings = [
  { term: 'First crack', detail: '8:05' },
  { term: 'Development', detail: '1:52' },
  { term: 'Drop', detail: '204°C' },
];

export function RoastCard() {
  const reduce = useReducedMotion();
  const finePointer = useRef(false);

  useEffect(() => {
    const query = window.matchMedia('(pointer: fine)');
    finePointer.current = query.matches;
    const update = (event: MediaQueryListEvent) => {
      finePointer.current = event.matches;
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const rotateX = useSpring(tiltX, { stiffness: 300, damping: 35 });
  const rotateY = useSpring(tiltY, { stiffness: 300, damping: 35 });
  const lightX = useMotionValue(72);
  const lightY = useMotionValue(18);
  const light = useMotionTemplate`radial-gradient(340px circle at ${lightX}% ${lightY}%, var(--glow), transparent 70%)`;

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!finePointer.current || reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    tiltY.set((px - 0.5) * 8);
    tiltX.set((0.5 - py) * 6);
    lightX.set(px * 100);
    lightY.set(py * 100);
  }

  function handlePointerLeave() {
    tiltX.set(0);
    tiltY.set(0);
  }

  const drawn = reduce ? { pathLength: 1 } : { pathLength: 0 };

  return (
    <div onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} className="perspective-distant">
      <motion.div
        style={{ rotateX: reduce ? 0 : rotateX, rotateY: reduce ? 0 : rotateY }}
        className="relative overflow-hidden rounded-lg border border-border bg-card p-6 text-card-foreground shadow-medium sm:p-8"
      >
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: light }} />

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-label font-semibold uppercase text-muted-foreground">Lot 047 · Batch 3 of 6</p>
              <p className="mt-2 font-display text-title font-semibold">El Mirador</p>
              <p className="text-base text-muted-foreground">Huila, Colombia · Washed</p>
            </div>
            <p className="rounded-pill bg-muted px-3 py-1 text-sm font-semibold text-foreground">Roasted Tuesday</p>
          </div>

          <div className="mt-6">
            <svg viewBox="0 0 320 160" className="h-auto w-full" role="img" aria-labelledby="roast-curve-title">
              <title id="roast-curve-title">
                Roast curve for lot 047. Bean temperature dips after charge, climbs to first crack at 8:05 and drops at 204°C at 9:57.
              </title>
              <g className="stroke-border" strokeWidth="1">
                <line x1="10" y1="30" x2="310" y2="30" />
                <line x1="10" y1="80" x2="310" y2="80" />
                <line x1="10" y1="130" x2="310" y2="130" />
              </g>
              <line
                x1="254"
                y1="12"
                x2="254"
                y2="150"
                className="stroke-muted-foreground"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              <motion.path
                d="M40 62 C80 52 130 72 180 96 C220 113 260 125 310 132"
                fill="none"
                className="stroke-accent"
                strokeWidth="2"
                strokeLinecap="round"
                initial={drawn}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.1, delay: 0.45, ease: easePaper }}
              />
              <motion.path
                d="M10 30 C18 120 28 140 40 140 C70 138 100 105 161 78 C200 60 230 42 254 35 C275 31 295 28 310 26"
                fill="none"
                className="stroke-primary"
                strokeWidth="3"
                strokeLinecap="round"
                initial={drawn}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.1, delay: 0.35, ease: easePaper }}
              />
            </svg>
            <div className="mt-2 flex justify-between text-sm text-muted-foreground" aria-hidden="true">
              <span>0:00</span>
              <span>9:57</span>
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="h-0.5 w-5 rounded-full bg-primary" aria-hidden="true" />
                Bean temperature
              </li>
              <li className="flex items-center gap-2">
                <span className="h-0.5 w-5 rounded-full bg-accent" aria-hidden="true" />
                Rate of rise
              </li>
              <li className="flex items-center gap-2">
                <span className="h-3 w-0 border-l border-dashed border-muted-foreground" aria-hidden="true" />
                First crack
              </li>
            </ul>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold text-muted-foreground">Tasting notes</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {notes.map((note) => (
                <li key={note} className="rounded-pill border border-border px-3 py-1 text-base">
                  {note}
                </li>
              ))}
            </ul>
          </div>

          <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
            {readings.map((reading) => (
              <div key={reading.term}>
                <dt className="text-sm text-muted-foreground">{reading.term}</dt>
                <dd className="mt-1 font-display text-xl font-semibold">{reading.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </motion.div>
    </div>
  );
}
