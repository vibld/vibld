import { motion } from 'motion/react';
import { Card, CardContent } from '@/components/ui/card';
import { clipReveal } from '@/lib/motion';

interface CaseStudyCardProps {
  title: string;
  details: string;
}

export default function CaseStudyCard({ title, details }: CaseStudyCardProps) {
  return (
    <Card className="overflow-hidden">
      <motion.div
        variants={clipReveal}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        className="aspect-[16/9] w-full bg-gradient-to-br from-primary to-accent"
      />
      <CardContent className="flex flex-col gap-4 p-6">
        <h3 className="font-display text-2xl font-bold text-primary">{title}</h3>
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{details}</p>
      </CardContent>
    </Card>
  );
}
