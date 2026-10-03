import { motion } from 'motion/react';
import { fade, viewport } from '@/lib/motion';
import SectionHeading from '@/components/SectionHeading';

const saturday = [
  { time: '11:00', activity: 'Gates open, coffee service starts' },
  { time: '12:00', activity: 'First fire: whole lamb on the spit' },
  { time: '14:00', activity: 'Dumpling workshop' },
  { time: '16:00', activity: 'Oyster shucking demo' },
  { time: '18:00', activity: 'Long table dinner, ticketed' },
  { time: '21:00', activity: 'Last pour' },
];

const sunday = [
  { time: '11:00', activity: 'Gates open, coffee service starts' },
  { time: '12:00', activity: 'Sourdough masterclass' },
  { time: '14:00', activity: 'Pepper tasting' },
  { time: '16:00', activity: 'Pie contest' },
  { time: '18:00', activity: 'Fire feast, ticketed' },
  { time: '21:00', activity: 'Last pour' },
];

export default function Schedule() {
  return (
    <motion.section
      id="schedule"
      className="py-16 md:py-24"
      variants={fade}
      initial="hidden"
      whileInView="show"
      viewport={viewport}
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-12">
        <SectionHeading
          kicker="Two days"
          heading="Schedule"
          intro="Gates open at 11:00 both days. Last pour at 21:00."
        />
        <div className="grid md:grid-cols-2 md:gap-x-16">
          <div>
            <h3 className="mb-4 font-display text-h3 text-foreground">
              Saturday, June 7
            </h3>
            <div>
              {saturday.map((item) => (
                <div
                  key={`${item.time}-${item.activity}`}
                  className="grid grid-cols-[80px_1fr] gap-4 border-b border-border py-4"
                >
                  <span className="text-small text-muted-foreground">
                    {item.time}
                  </span>
                  <span className="text-body text-foreground">
                    {item.activity}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-4 font-display text-h3 text-foreground">
              Sunday, June 8
            </h3>
            <div>
              {sunday.map((item) => (
                <div
                  key={`${item.time}-${item.activity}`}
                  className="grid grid-cols-[80px_1fr] gap-4 border-b border-border py-4"
                >
                  <span className="text-small text-muted-foreground">
                    {item.time}
                  </span>
                  <span className="text-body text-foreground">
                    {item.activity}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
