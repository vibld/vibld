import { motion } from 'motion/react';
import { fadeUp, cardHover } from '@/lib/motion';

interface ServiceCardProps {
  title: string;
  description: string;
}

export default function ServiceCard({ title, description }: ServiceCardProps) {
  return (
    <motion.article
      variants={fadeUp}
      whileHover={cardHover.whileHover}
      whileTap={cardHover.whileTap}
      className="rounded-lg border border-border bg-card p-6 shadow-sm cursor-pointer"
    >
      <h3 className="font-display text-xl font-semibold text-foreground">{title}</h3>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">{description}</p>
    </motion.article>
  );
}
