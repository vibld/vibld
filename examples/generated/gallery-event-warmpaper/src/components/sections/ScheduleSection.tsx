import { motion } from 'motion/react';
import { PageSection } from '@/components/PageSection';
import { fadeUp } from '@/lib/motion';

const saturday = [
  { time: '11:00', event: 'Gates open, coffee and pastries at the bakery tent.' },
  { time: '12:30', event: 'Fire stage: whole lamb roasted over oak, with chef Alma Ruiz.' },
  { time: '14:00', event: 'Fermentation workshop: kraut, kimchi and kombucha with The Brinery.' },
  { time: '16:00', event: 'Long table dinner: a shared four-course menu from six kitchens.' },
  { time: '19:00', event: 'Live music from the Riverside String Band.' },
];

const sunday = [
  { time: '10:00', event: 'Morning market: preserves, bread and flowers.' },
  { time: '11:30', event: 'Dumpling masterclass with Uncle Bun.' },
  { time: '13:00', event: 'Oak-grilled fish demo with Little River Oysters.' },
  { time: '15:00', event: 'Pie competition and judging.' },
  { time: '17:00', event: 'Closing feast and bonfire.' },
];

function DayColumn({ day, events }: { day: string; events: { time: string; event: string }[] }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="mb-12 md:mb-0"
    >
      <h3 className="mb-6 font-display text-2xl font-semibold tracking-tight text-foreground">
        {day}
      </h3>
      <ul className="space-y-5">
        {events.map((item) => (
          <li key={item.time} className="flex gap-4 border-b border-border pb-5">
            <span className="w-14 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              {item.time}
            </span>
            <p className="text-base leading-relaxed text-foreground">{item.event}</p>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export function ScheduleSection() {
  return (
    <PageSection
      id="schedule"
      heading="Schedule"
      intro="Two days, three stages, and a long table that never empties."
    >
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        <DayColumn day="Saturday, October 18" events={saturday} />
        <DayColumn day="Sunday, October 19" events={sunday} />
      </div>
    </PageSection>
  );
}

export default ScheduleSection;
