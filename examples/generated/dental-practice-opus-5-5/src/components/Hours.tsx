import { motion } from 'motion/react';
import { CircleCheck, CircleMinus, Info, Phone } from 'lucide-react';
import { Blob } from '@/components/Blob';
import { Reveal } from '@/components/Reveal';
import { useNow } from '@/hooks/useNow';
import { formatHours, getOpenStatus, WEEK, weekIndex } from '@/lib/hours';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function Hours() {
  const now = useNow();
  const today = weekIndex(now);
  const status = getOpenStatus(now);
  const StatusIcon = status.isOpen ? CircleCheck : CircleMinus;

  return (
    <section id="hours" aria-labelledby="hours-heading" className="px-3 py-10 sm:px-6 lg:py-16">
      <div className="relative isolate mx-auto max-w-330 overflow-hidden rounded-organic-lg bg-forest text-forest-foreground">
        <Blob className="-top-32 -right-32 -z-10 size-112 bg-primary/40" duration={4} />
        <Blob className="-bottom-40 -left-24 -z-10 size-88 bg-bark/35" duration={3.4} delay={0.8} />

        <div className="grid gap-12 px-6 py-14 sm:px-12 sm:py-16 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-20 lg:py-24">
          <div>
            <Reveal>
              <p className="text-small font-medium text-sage">Hours</p>
              <h2 id="hours-heading" className="mt-3 font-display text-heading font-medium">
                Opening hours
              </h2>
              <p className="mt-6 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-forest-foreground/10 px-4 py-2">
                <StatusIcon aria-hidden="true" className="size-5 text-sage" />
                <span className="font-medium">{status.headline}</span>
                <span className="text-forest-muted">{status.detail}</span>
              </p>
            </Reveal>

            <motion.div
              className="mt-12"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: 0.1, ease: EASE_OUT }}
            >
              <p className="-ml-[0.06em] font-display text-numeral font-medium text-sage tabular-nums">19:30</p>
              <p className="mt-3 max-w-xs text-forest-muted">Wednesday late clinic, for appointments after work.</p>
            </motion.div>
          </div>

          <div className="lg:pt-4">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Weekly opening hours</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Hours</th>
                </tr>
              </thead>
              <tbody>
                {WEEK.map((day, index) => {
                  const isToday = index === today;
                  return (
                    <motion.tr
                      key={day.day}
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.3 }}
                      transition={{ duration: 0.45, delay: index * 0.05, ease: EASE_OUT }}
                      aria-current={isToday ? 'date' : undefined}
                      className={cn(
                        'border-b border-forest-foreground/15 align-top',
                        isToday && 'bg-forest-foreground/10',
                      )}
                    >
                      <th scope="row" className="py-4 pr-3 pl-4 font-medium">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {day.day}
                          {isToday && (
                            <span className="rounded-full bg-sage px-2.5 py-0.5 text-small font-medium text-forest">
                              Today
                            </span>
                          )}
                        </span>
                      </th>
                      <td className="py-4 pr-4 text-right tabular-nums">
                        {formatHours(day)}
                        {day.note && <span className="block text-small text-forest-muted">{day.note}</span>}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="mt-10 grid gap-4 text-forest-muted">
              <li className="flex gap-3">
                <Phone aria-hidden="true" className="mt-1 size-5 shrink-0 text-sage" />
                <span>Reception answers the phone from 08:00 on weekdays and 09:00 on Saturdays.</span>
              </li>
              <li className="flex gap-3">
                <Info aria-hidden="true" className="mt-1 size-5 shrink-0 text-sage" />
                <span>Out of hours with severe pain or swelling, call NHS 111.</span>
              </li>
            </ul>
            <p className="mt-6 text-small text-forest-muted">Open and closed status uses the time on your device.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
