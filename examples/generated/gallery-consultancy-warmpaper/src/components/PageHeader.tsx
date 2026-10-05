import { motion } from 'motion/react';
import { fadeUp, staggerContainer } from '@/lib/motion';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  intro: string;
}

export default function PageHeader({ eyebrow, title, intro }: PageHeaderProps) {
  return (
    <motion.header
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-3xl px-4 pt-16 pb-12 sm:px-6 lg:px-8 lg:pt-24 lg:pb-16"
    >
      <motion.p variants={fadeUp} className="text-sm font-semibold uppercase tracking-widest text-primary">
        {eyebrow}
      </motion.p>
      <motion.h1 variants={fadeUp} className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance">
        {title}
      </motion.h1>
      <motion.p variants={fadeUp} className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-2xl">
        {intro}
      </motion.p>
    </motion.header>
  );
}
