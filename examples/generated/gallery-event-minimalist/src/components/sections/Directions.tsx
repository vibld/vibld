import { motion } from 'motion/react';
import { fade, viewport } from '@/lib/motion';
import SectionHeading from '@/components/SectionHeading';

export default function Directions() {
  return (
    <motion.section
      id="directions"
      className="py-16 md:py-24"
      variants={fade}
      initial="hidden"
      whileInView="show"
      viewport={viewport}
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-12">
        <SectionHeading kicker="Getting here" heading="Directions" />
        <div className="grid md:grid-cols-2 md:gap-x-16">
          <div>
            <p className="font-display text-h3 text-foreground">
              Millbrook Park, 1200 Lakeside Drive, Millbrook
            </p>
            <p className="mt-3 text-body text-muted-foreground">
              Bus 14 and 22 stop at Lakeside Drive and Park Gate. The park is a 10 minute walk from Millbrook Station.
            </p>
          </div>
          <div className="mt-8 md:mt-0">
            <p className="text-body text-muted-foreground">
              Free parking in the west lot. Bike racks at both gates. Accessible drop-off at the main entrance.
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
