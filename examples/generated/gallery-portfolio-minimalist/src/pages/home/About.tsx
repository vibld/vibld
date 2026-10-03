import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

export default function About() {
  return (
    <motion.section
      variants={fadeIn}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="max-w-3xl mx-auto px-[var(--gutter)] py-[var(--section-y)]"
    >
      <h2 className="font-display text-[clamp(1.8rem,3.5vw,2.5rem)] leading-[1.15] tracking-[-0.01em] text-foreground">
        About
      </h2>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-5 gap-8 items-start">
        <div className="md:col-span-3 space-y-6">
          <p className="text-base leading-[1.6] text-foreground">
            Mara Voss is a freelance photographer based in Copenhagen. She photographs people, objects and quiet interiors for magazines, studios and independent brands.
          </p>
          <p className="text-base leading-[1.6] text-muted-foreground">
            The work is unhurried and precise: natural light, careful composition, and a preference for what is already there. She takes on a small number of commissions each season.
          </p>
        </div>
        <div className="md:col-span-2">
          <img
            src="https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=800&q=80"
            alt="Portrait of Mara Voss standing beside a window"
            className="w-full h-auto object-cover aspect-[4/5] rounded-none"
            loading="lazy"
          />
        </div>
      </div>
    </motion.section>
  );
}
