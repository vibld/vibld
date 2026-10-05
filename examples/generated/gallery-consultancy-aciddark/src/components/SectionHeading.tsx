import { motion } from "motion/react";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
}

export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className={cn(
        "mb-8",
        align === "center" && "text-center",
        className
      )}
    >
      {eyebrow && (
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-primary">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-[1.2] tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      {description && (
        <p className={cn("mt-4 max-w-2xl text-muted-foreground", align === "center" && "mx-auto")}>
          {description}
        </p>
      )}
    </motion.div>
  );
}
