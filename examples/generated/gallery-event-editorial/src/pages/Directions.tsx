import { Bus, Bike, Car, Accessibility } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { PageHeader } from '@/components/PageHeader';
import { fadeScale } from '@/lib/motion';

interface DirectionSection {
  icon: LucideIcon;
  title: string;
  content: string[];
}

const sections: DirectionSection[] = [
  {
    icon: Bus,
    title: 'By transit',
    content: [
      'Bus lines 72 and 17 stop on NE Ridgewood Ave.',
      'MAX Yellow Line to Albina/Mississippi, then a 10-minute walk north.',
    ],
  },
  {
    icon: Bike,
    title: 'By bike',
    content: [
      'Bike valet at the north gate.',
      '200 racks, with air and basic tools.',
    ],
  },
  {
    icon: Car,
    title: 'By car',
    content: [
      'Parking at the high school lot, $15 per day.',
      'Spaces are limited; arrive before noon for the best chance.',
    ],
  },
  {
    icon: Accessibility,
    title: 'Accessibility',
    content: [
      'Step-free paths from all entrances to the main meadow.',
      'Accessible restrooms near the north gate and the barn.',
      'Service animals welcome.',
    ],
  },
];

export default function Directions() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      <PageHeader
        kicker="Directions"
        title="Getting to Ridgewood Park"
        lead="Ridgewood Park is at 4100 NE Ridgewood Ave, Portland, OR 97211. The festival entrance is at the north gate."
      />
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-8">
          {sections.map((section) => (
            <motion.section
              key={section.title}
              variants={fadeScale}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="flex gap-4"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <section.icon className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {section.content.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </motion.section>
          ))}
        </div>
        <motion.div
          variants={fadeScale}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="flex items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6"
        >
          <div className="relative h-64 w-full max-w-md overflow-hidden rounded-md bg-muted/40">
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Ridgewood Park</p>
            </div>
            <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 transform rounded-[50%] border border-primary/30 bg-primary/5" />
            <div className="absolute left-1/2 top-4 -translate-x-1/2 transform rounded bg-foreground px-3 py-1 text-xs font-medium text-background">
              North gate
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 transform text-xs text-muted-foreground">
              Festival meadow
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
