import { MotionConfig, motion } from 'motion/react';

import { Button, buttonVariants } from '@/components/ui/button';
import { buttonPress } from '@/lib/motion';

export function Hero() {
  return (
    <MotionConfig reducedMotion="user">
      <section id="top" className="bg-background px-4 py-20 sm:px-6 md:py-24 lg:px-8">
        <div className="mx-auto max-w-[800px]">
          <h1 className="type-display text-foreground">Alex Morgan</h1>
          <p className="type-subheading mt-4 max-w-xl text-muted-foreground">
            Freelance photographer capturing the unseen in urban landscapes.
          </p>
          <div className="hero-actions mt-8 flex flex-col gap-4 sm:flex-row">
            <motion.button
              className={buttonVariants({ variant: 'default', size: 'lg' })}
              variants={buttonPress}
              whileTap="pressed"
              onClick={() =>
                document.getElementById('work')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              View work
            </motion.button>
            <Button
              variant="outline"
              size="lg"
              onClick={() =>
                document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              Get in touch
            </Button>
          </div>
          <p className="type-caption mt-6 text-muted-foreground">
            Based in Berlin, available worldwide
          </p>
        </div>
      </section>
    </MotionConfig>
  );
}
