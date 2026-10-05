import { motion, type HTMLMotionProps } from "motion/react";
import { glassMaterialize } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function GlassPanel({
  className,
  children,
  ...props
}: HTMLMotionProps<"div">) {
  return (
    <motion.div
      variants={glassMaterialize}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className={cn("glass-panel rounded-[16px]", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
