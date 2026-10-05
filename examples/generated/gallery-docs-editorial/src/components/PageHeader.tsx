import { motion } from "motion/react";
import { fadeScale } from "@/lib/motion";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  intro?: string;
  meta?: string;
}

export default function PageHeader({
  eyebrow,
  title,
  intro,
  meta,
}: PageHeaderProps) {
  return (
    <header className="border-b border-border/80 bg-background px-4 pb-10 pt-12 sm:px-6 sm:pb-16 sm:pt-16 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {eyebrow && (
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        )}
        <motion.h1
          className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl"
          initial="hidden"
          animate="show"
          variants={fadeScale}
        >
          {title}
        </motion.h1>
        {intro && (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground sm:text-xl">
            {intro}
          </p>
        )}
        {meta && (
          <p className="mt-6 font-mono text-xs text-muted-foreground">{meta}</p>
        )}
      </div>
    </header>
  );
}
