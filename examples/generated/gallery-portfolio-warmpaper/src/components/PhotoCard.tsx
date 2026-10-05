import { Camera } from 'lucide-react';
import { motion } from 'motion/react';
import { fadeUp } from '@/lib/motion';

export interface PhotoCardProps {
  title: string;
  category?: string;
  year?: string;
  className?: string;
}

export default function PhotoCard({ title, category, year, className }: PhotoCardProps) {
  return (
    <motion.figure
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      whileHover={{ y: -4 }}
      className={`group overflow-hidden rounded-md bg-card shadow-sm transition-shadow hover:shadow-md ${className || ''}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-secondary via-muted to-background">
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60">
          <Camera className="h-10 w-10" aria-hidden="true" />
        </div>
        <div className="absolute inset-0 bg-primary/0 transition-colors duration-300 group-hover:bg-primary/5" />
      </div>
      <figcaption className="flex flex-col gap-1 p-4">
        <h3 className="font-serif text-lg font-semibold leading-snug text-foreground">
          {title}
        </h3>
        {(category || year) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {category && <span>{category}</span>}
            {category && year && <span aria-hidden="true">·</span>}
            {year && <span>{year}</span>}
          </div>
        )}
      </figcaption>
    </motion.figure>
  );
}
