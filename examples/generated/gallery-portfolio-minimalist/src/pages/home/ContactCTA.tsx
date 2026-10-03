import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

export default function ContactCTA() {
  return (
    <motion.section
      variants={fadeIn}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="max-w-3xl mx-auto px-[var(--gutter)] pt-[var(--section-y)] pb-[var(--section-y)]"
    >
      <h2 className="font-display text-[clamp(1.8rem,3.5vw,2.5rem)] leading-[1.15] tracking-[-0.01em] text-foreground">
        Work with me
      </h2>
      <p className="mt-6 text-base leading-[1.6] text-muted-foreground max-w-xl">
        If you have a project in mind, tell me what you are making.
      </p>
      <a
        href="#/contact"
        className="mt-8 inline-flex items-center justify-center px-6 py-3 rounded-[var(--radius-field)] bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90 transition-colors duration-150"
      >
        Get in touch
      </a>
    </motion.section>
  );
}
