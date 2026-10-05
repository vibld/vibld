import { motion } from 'motion/react';
import { fadeUp, cardHover } from '@/lib/motion';

interface CaseStudyCardProps {
  clientLabel: string;
  title: string;
  summary: string;
  outcomeLabel: string;
  link: string;
}

export default function CaseStudyCard({
  clientLabel,
  title,
  summary,
  outcomeLabel,
  link,
}: CaseStudyCardProps) {
  return (
    <motion.article
      variants={fadeUp}
      whileHover={cardHover.whileHover}
      whileTap={cardHover.whileTap}
      className="flex flex-col rounded-lg border border-border bg-card p-6 shadow-sm cursor-pointer"
    >
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">{clientLabel}</p>
      <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">{title}</h3>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground flex-1">{summary}</p>
      <p className="mt-6 text-sm font-medium text-muted-foreground">
        <span className="font-semibold text-foreground">Outcome:</span> {outcomeLabel}
      </p>
      <a
        href={link}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        Read case study
      </a>
    </motion.article>
  );
}
