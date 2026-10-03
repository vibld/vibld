import { motion } from 'motion/react';
import { fadeUp } from '@/lib/motion';

interface PageSectionProps {
  id: string;
  heading: string;
  intro: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageSection({ id, heading, intro, children, className = '' }: PageSectionProps) {
  return (
    <section
      id={id}
      className={`mx-auto w-full container-page px-6 py-16 md:px-8 md:py-24 lg:px-12 lg:py-32 ${className}`}
    >
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        className="mb-10 max-w-2xl md:mb-14"
      >
        <h2 className="font-display text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          {heading}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{intro}</p>
      </motion.div>
      {children}
    </section>
  );
}

export default PageSection;
